import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * A node in the scan tree.
 *
 * To keep memory bounded when scanning huge folders (millions of files),
 * the absolute `path` is stored ONLY on directory nodes. A file's path is
 * derived from its parent directory on demand via `nodePath()`. Directory
 * nodes also keep a back-reference `parent` (used for incremental size
 * propagation) which is never serialized.
 */
export interface FileNode {
    name: string;
    /** Absolute path. Present for directories; undefined for file leaves. */
    path?: string;
    /**
     * For files: the final byte size.
     * For directories: a running aggregate of all descendant file sizes,
     * updated incrementally as files finish scanning (so a partial view is
     * always available).
     */
    size: number;
    isDirectory: boolean;
    children?: FileNode[];
    parent?: FileNode;
}

/** A flat, serializable entry for one child of a directory (used by the UI). */
export interface TopLevelEntry {
    name: string;
    path: string;
    size: number;
    isDirectory: boolean;
}

export interface TypeStat {
    ext: string;
    size: number;
    count: number;
}

export interface LargestFile {
    path: string;
    name: string;
    ext: string;
    size: number;
}

export interface ScanProgress {
    fileCount: number;
    dirCount: number;
    totalBytes: number;
    currentPath: string;
    /** Live snapshot of the root's immediate children, sorted by size desc. */
    topLevel: TopLevelEntry[];
    /** Total immediate children of the root (may exceed `topLevel.length`). */
    totalChildren: number;
    /** Live snapshot of per-extension totals, sorted by size desc (capped). */
    typeStats: TypeStat[];
    /** Live snapshot of the current top-N largest files. */
    largestFiles: LargestFile[];
}

export interface ScanResult {
    root: FileNode;
    fileCount: number;
    dirCount: number;
    totalBytes: number;
    largestFiles: LargestFile[];
    typeStats: TypeStat[];
}

/**
 * Handle used to pause/resume an in-progress scan. The scanner fills it in
 * synchronously via the `onControl` callback passed to `scanDirectory`.
 */
export interface ScanControl {
    paused: boolean;
    cancelled: boolean;
    pause(): void;
    resume(): void;
    cancel(): void;
}

const MAX_CONCURRENCY = 64;
const PROGRESS_INTERVAL_MS = 150;
const TOP_N = 1000;
const TOP_LEVEL_SNAPSHOT_LIMIT = 200;
const PROGRESS_TYPES_LIMIT = 500;

/**
 * Minimal min-heap ordered by `compare` (defaults to numeric `size`) used to
 * keep only the N largest items without allocating an array of every item.
 */
class MinHeap<T> {
    private readonly a: T[] = [];
    private readonly cmp: (x: T, y: T) => number;

    constructor(cmp?: (x: T, y: T) => number) {
        this.cmp = cmp || ((x: any, y: any) => x.size - y.size);
    }

    size(): number { return this.a.length; }
    peek(): T { return this.a[0]; }

    push(x: T): void {
        const a = this.a;
        a.push(x);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (this.cmp(a[p], a[i]) <= 0) { break; }
            const t = a[p]; a[p] = a[i]; a[i] = t;
            i = p;
        }
    }

    replaceRoot(x: T): void {
        const a = this.a;
        a[0] = x;
        let i = 0;
        const n = a.length;
        for (;;) {
            const l = i * 2 + 1;
            const r = i * 2 + 2;
            let smallest = i;
            if (l < n && this.cmp(a[l], a[smallest]) < 0) { smallest = l; }
            if (r < n && this.cmp(a[r], a[smallest]) < 0) { smallest = r; }
            if (smallest === i) { break; }
            const t = a[i]; a[i] = a[smallest]; a[smallest] = t;
            i = smallest;
        }
    }

    toSortedDesc(): T[] {
        return this.a.slice().sort((x, y) => this.cmp(y, x));
    }
}

/** Resolve the absolute path of any node (directories store it, files derive it). */
export function nodePath(node: FileNode): string {
    if (node.path) { return node.path; }
    const p = node.parent;
    if (p && p.path) { return path.join(p.path, node.name); }
    return node.name;
}

/** Flat, sorted list of a directory's immediate children for the UI.
 *  When `limit` is supplied, only the top `limit` entries are kept, using a
 *  bounded heap rather than a full sort (important for huge directories). */
export function topLevelEntries(node: FileNode, limit?: number): TopLevelEntry[] {
    const children = node.children || [];
    if (typeof limit === 'number') {
        if (limit <= 0) { return []; }
        const heap = new MinHeap<TopLevelEntry>((x, y) => x.size - y.size);
        for (let i = 0; i < children.length; i++) {
            const c = children[i];
            const entry: TopLevelEntry = {
                name: c.name,
                path: nodePath(c),
                size: c.size,
                isDirectory: c.isDirectory
            };
            if (heap.size() < limit) {
                heap.push(entry);
            } else if (entry.size > heap.peek().size) {
                heap.replaceRoot(entry);
            }
        }
        return heap.toSortedDesc();
    }

    const out: TopLevelEntry[] = [];
    for (let i = 0; i < children.length; i++) {
        const c = children[i];
        out.push({
            name: c.name,
            path: nodePath(c),
            size: c.size,
            isDirectory: c.isDirectory
        });
    }
    out.sort((a, b) => b.size - a.size);
    return out;
}

function extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '(no extension)';
}

export async function scanDirectory(
    rootPath: string,
    onProgress?: (p: ScanProgress) => void,
    onControl?: (c: ScanControl) => void
): Promise<ScanResult> {
    // Bounded-concurrency worker pool (see original notes re: EMFILE).
    // The queue uses an explicit head index so enqueue/dequeue are O(1) even
    // when a directory has hundreds of thousands of direct children.
    let workers = 0;
    let pending = 0;
    let finished = false;
    let scanStarted = false;
    let queueHead = 0;
    const queue: FileNode[] = [];
    let root!: FileNode;
    let resolveDone!: (r: ScanResult) => void;

    const done = new Promise<ScanResult>(resolve => { resolveDone = resolve; });

    const control: ScanControl = {
        paused: false,
        cancelled: false,
        pause() { control.paused = true; },
        resume() { control.paused = false; pump(); },
        cancel() {
            if (control.cancelled) { return; }
            control.cancelled = true;
            // Queued nodes are already counted in `pending`; drop them so the
            // returned promise can resolve once in-flight work settles.
            pending -= queue.length - queueHead;
            queue.length = 0;
            queueHead = 0;
            if (scanStarted) { finishIfDone(); }
        }
    };

    function pump(): void {
        while (!control.paused && !control.cancelled && workers < MAX_CONCURRENCY && queueHead < queue.length) {
            workers++;
            void worker();
        }
    }

    if (onControl) { onControl(control); }

    let isDir = false;
    let rootStat!: Awaited<ReturnType<typeof fsp.stat>>;
    try {
        rootStat = await fsp.stat(rootPath);
        isDir = rootStat.isDirectory();
    } catch {
        return {
            root: { name: path.basename(rootPath), path: rootPath, size: 0, isDirectory: false },
            fileCount: 0,
            dirCount: 0,
            totalBytes: 0,
            largestFiles: [],
            typeStats: []
        };
    }

    // A single file (rare — the UI normally resolves to a directory).
    if (!isDir) {
        const size = rootStat.size;
        const name = path.basename(rootPath);
        const ext = extOf(name);
        const file: LargestFile = { path: rootPath, name, ext, size };
        return {
            root: { name, path: rootPath, size, isDirectory: false },
            fileCount: 1,
            dirCount: 0,
            totalBytes: size,
            largestFiles: [file],
            typeStats: [{ ext, size, count: 1 }]
        };
    }

    root = {
        name: path.basename(rootPath) || rootPath,
        path: rootPath,
        size: 0,
        isDirectory: true,
        children: []
    };

    let fileCount = 0;
    let dirCount = 1; // the root itself
    let totalBytes = 0;
    let currentPath = rootPath;
    let lastEmit = 0;

    const typeMap = new Map<string, { size: number; count: number }>();
    const heap = new MinHeap<LargestFile>((x, y) => x.size - y.size);

    function snapshotTopLevel(): TopLevelEntry[] {
        return topLevelEntries(root, TOP_LEVEL_SNAPSHOT_LIMIT);
    }

    function snapshotTypeStats(limit?: number): TypeStat[] {
        if (typeof limit === 'number') {
            const typeHeap = new MinHeap<TypeStat>((x, y) => x.size - y.size);
            typeMap.forEach((v, ext) => {
                const item: TypeStat = { ext, size: v.size, count: v.count };
                if (typeHeap.size() < limit) {
                    typeHeap.push(item);
                } else if (item.size > typeHeap.peek().size) {
                    typeHeap.replaceRoot(item);
                }
            });
            return typeHeap.toSortedDesc();
        }
        const arr: TypeStat[] = [];
        typeMap.forEach((v, ext) => arr.push({ ext, size: v.size, count: v.count }));
        arr.sort((a, b) => b.size - a.size);
        return arr;
    }

    function emitProgress(): void {
        if (!onProgress) { return; }
        onProgress({
            fileCount,
            dirCount,
            totalBytes,
            currentPath,
            topLevel: snapshotTopLevel(),
            totalChildren: root.children ? root.children.length : 0,
            typeStats: snapshotTypeStats(PROGRESS_TYPES_LIMIT),
            largestFiles: heap.toSortedDesc()
        });
    }

    function maybeEmit(): void {
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
            lastEmit = now;
            emitProgress();
        }
    }

    function recordFile(node: FileNode, size: number): void {
        fileCount++;
        totalBytes += size;

        const ext = extOf(node.name);
        let t = typeMap.get(ext);
        if (!t) {
            t = { size: 0, count: 0 };
            typeMap.set(ext, t);
        }
        t.size += size;
        t.count++;

        if (heap.size() < TOP_N) {
            heap.push({ path: nodePath(node), name: node.name, ext, size });
        } else if (size > heap.peek().size) {
            heap.replaceRoot({ path: nodePath(node), name: node.name, ext, size });
        }

        // Incrementally push this file's size up every ancestor so directory
        // sizes are live throughout the scan (not only at the very end).
        for (let p = node.parent; p; p = p.parent) {
            p.size += size;
        }
    }

    function finishIfDone(): void {
        if (pending === 0 && !finished) {
            finished = true;
            emitProgress(); // final, complete snapshot
            resolveDone({
                root,
                fileCount,
                dirCount,
                totalBytes,
                largestFiles: heap.toSortedDesc(),
                typeStats: snapshotTypeStats()
            });
        }
    }

    function settleNode(): void {
        pending--;
        maybeEmit();
        finishIfDone();
    }

    function enqueue(node: FileNode): void {
        pending++;
        queue.push(node);
    }

    function dequeue(): FileNode | undefined {
        // Compact periodically so a long-running scan never retains millions
        // of already-processed queue slots.
        if (queueHead > 1024) {
            queue.splice(0, queueHead);
            queueHead = 0;
        }
        if (queueHead >= queue.length) {
            queue.length = 0;
            queueHead = 0;
            return undefined;
        }
        return queue[queueHead++];
    }

    async function processNode(node: FileNode): Promise<void> {
        if (control.cancelled) {
            settleNode();
            return;
        }

        if (node.isDirectory && node.path) {
            currentPath = node.path;
        }

        if (!node.isDirectory) {
            const fullPath = nodePath(node);
            let size = 0;
            try {
                size = (await fsp.stat(fullPath)).size;
            } catch {
                // Permission denied / broken link / deleted mid-scan — size 0.
            }
            if (control.cancelled) {
                settleNode();
                return;
            }
            node.size = size;
            recordFile(node, size);
            settleNode();
            return;
        }

        node.children = [];
        try {
            const dir = await fsp.opendir(node.path!, { bufferSize: 64 });
            for await (const entry of dir) {
                if (control.cancelled) { break; }
                const child: FileNode = {
                    name: entry.name,
                    size: 0,
                    isDirectory: entry.isDirectory(),
                    parent: node
                };
                if (child.isDirectory) {
                    child.path = path.join(node.path!, entry.name);
                    dirCount++;
                }
                node.children.push(child);
                enqueue(child);
                if (((queue.length - queueHead) & 63) === 0) { pump(); }
            }
        } catch {
            // Permission denied, broken link, etc. — leave an empty directory.
            node.children = [];
        }

        if (control.cancelled) {
            settleNode();
            return;
        }

        settleNode();
        pump();
    }

    async function worker(): Promise<void> {
        try {
            while (!control.paused && !control.cancelled) {
                const node = dequeue();
                if (!node) { break; }
                await processNode(node);
            }
        } finally {
            workers--;
            pump();
        }
    }

    if (control.cancelled) {
        // Cancelled synchronously from onControl, before scanning started.
        finished = true;
        resolveDone({
            root,
            fileCount: 0,
            dirCount: 1,
            totalBytes: 0,
            largestFiles: [],
            typeStats: []
        });
        return done;
    }

    scanStarted = true;
    enqueue(root);
    pump();

    return done;
}

export function formatSize(bytes: number): string {
    if (bytes === 0) { return '0 B'; }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, i);
    return i === 0 ? `${bytes} B` : `${val.toFixed(1)} ${units[i]}`;
}
