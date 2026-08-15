import * as fsp from 'fs/promises';
import type { Dirent } from 'fs';
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
    pause(): void;
    resume(): void;
}

const MAX_CONCURRENCY = 64;
const PROGRESS_INTERVAL_MS = 150;
const TOP_N = 1000;
const TOP_LEVEL_SNAPSHOT_LIMIT = 200;
const PROGRESS_TYPES_LIMIT = 500;

/**
 * Minimal min-heap (ordered by `size`) used to keep only the N largest files
 * without allocating an array of every file in the tree.
 */
class MinHeap {
    private readonly a: LargestFile[] = [];

    size(): number { return this.a.length; }
    peek(): LargestFile { return this.a[0]; }

    push(x: LargestFile): void {
        const a = this.a;
        a.push(x);
        let i = a.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (a[p].size <= a[i].size) { break; }
            const t = a[p]; a[p] = a[i]; a[i] = t;
            i = p;
        }
    }

    replaceRoot(x: LargestFile): void {
        const a = this.a;
        a[0] = x;
        let i = 0;
        const n = a.length;
        for (;;) {
            const l = i * 2 + 1;
            const r = i * 2 + 2;
            let smallest = i;
            if (l < n && a[l].size < a[smallest].size) { smallest = l; }
            if (r < n && a[r].size < a[smallest].size) { smallest = r; }
            if (smallest === i) { break; }
            const t = a[i]; a[i] = a[smallest]; a[smallest] = t;
            i = smallest;
        }
    }

    toSortedDesc(): LargestFile[] {
        return this.a.slice().sort((x, y) => y.size - x.size);
    }
}

/** Resolve the absolute path of any node (directories store it, files derive it). */
export function nodePath(node: FileNode): string {
    if (node.path) { return node.path; }
    const p = node.parent;
    if (p && p.path) { return path.join(p.path, node.name); }
    return node.name;
}

/** Flat, sorted list of a directory's immediate children for the UI. */
export function topLevelEntries(node: FileNode, limit?: number): TopLevelEntry[] {
    const out: TopLevelEntry[] = [];
    const children = node.children || [];
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
    return typeof limit === 'number' ? out.slice(0, limit) : out;
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
    // Pause-aware, bounded-concurrency scheduler (see original notes re: EMFILE).
    // Set up first so the caller receives the control handle synchronously.
    let active = 0;
    const queue: Array<() => void> = [];
    const control: ScanControl = {
        paused: false,
        pause() { control.paused = true; },
        resume() { control.paused = false; pump(); }
    };

    function pump(): void {
        while (!control.paused && active < MAX_CONCURRENCY && queue.length > 0) {
            const resolve = queue.shift()!;
            active++;
            resolve();
        }
    }

    function acquire(): Promise<void> {
        return new Promise<void>(resolve => {
            queue.push(resolve);
            pump();
        });
    }

    function release(): void {
        active--;
        pump();
    }

    if (onControl) { onControl(control); }

    let isDir = false;
    try {
        isDir = (await fsp.stat(rootPath)).isDirectory();
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
        let size = 0;
        try { size = (await fsp.stat(rootPath)).size; } catch { /* size stays 0 */ }
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

    const root: FileNode = {
        name: path.basename(rootPath) || rootPath,
        path: rootPath,
        size: 0,
        isDirectory: true,
        children: []
    };

    let fileCount = 0;
    let dirCount = 1; // the root itself
    let totalBytes = 0;
    let pending = 0;
    let finished = false;
    let currentPath = rootPath;
    let lastEmit = 0;

    const typeMap = new Map<string, { size: number; count: number }>();
    const heap = new MinHeap();

    function snapshotTopLevel(): TopLevelEntry[] {
        return topLevelEntries(root, TOP_LEVEL_SNAPSHOT_LIMIT);
    }

    function snapshotTypeStats(limit?: number): TypeStat[] {
        const arr: TypeStat[] = [];
        typeMap.forEach((v, ext) => arr.push({ ext, size: v.size, count: v.count }));
        arr.sort((a, b) => b.size - a.size);
        return typeof limit === 'number' ? arr.slice(0, limit) : arr;
    }

    function emitProgress(): void {
        if (!onProgress) { return; }
        onProgress({
            fileCount,
            dirCount,
            totalBytes,
            currentPath,
            topLevel: snapshotTopLevel(),
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

    function settle(): void {
        pending--;
        maybeEmit();
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

    let resolveDone!: (r: ScanResult) => void;
    const done = new Promise<ScanResult>(resolve => { resolveDone = resolve; });

    async function scanNode(node: FileNode): Promise<void> {
        if (node.isDirectory && node.path) {
            currentPath = node.path;
        }

        if (!node.isDirectory) {
            const fullPath = nodePath(node);
            let size = 0;
            await acquire();
            try {
                size = (await fsp.stat(fullPath)).size;
            } catch {
                // Permission denied / broken link / deleted mid-scan — size 0.
            } finally {
                release();
            }
            node.size = size;
            recordFile(node, size);
            settle();
            return;
        }

        let entries: Dirent[];
        await acquire();
        try {
            entries = await fsp.readdir(node.path!, { withFileTypes: true });
        } catch {
            release();
            settle();
            return; // permission denied, etc.
        }
        release();

        node.children = [];
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
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

            pending++;
            // Fire-and-forget; `settle()` (inside scanNode) decrements `pending`.
            void scanNode(child);
        }

        settle(); // this directory itself is done scheduling its children
    }

    pending = 1;
    void scanNode(root);

    return done;
}

export function formatSize(bytes: number): string {
    if (bytes === 0) { return '0 B'; }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, i);
    return i === 0 ? `${bytes} B` : `${val.toFixed(1)} ${units[i]}`;
}
