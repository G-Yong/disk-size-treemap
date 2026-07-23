import * as fsp from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';

export interface FileNode {
    name: string;
    path: string;
    size: number;
    isDirectory: boolean;
    children?: FileNode[];
}

/**
 * Bounded-concurrency scheduler.
 *
 * Recursive directory walking is I/O-bound; issuing every `readdir`/`stat`
 * in parallel is far faster than doing them serially, but firing thousands
 * of file descriptors at once triggers EMFILE ("too many open files").
 * This limiter caps the number of in-flight syscalls to a safe ceiling.
 */
const MAX_CONCURRENCY = 64;
let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
    if (active < MAX_CONCURRENCY) {
        active++;
        return Promise.resolve();
    }
    return new Promise<void>(resolve => waiters.push(resolve));
}

function release(): void {
    const next = waiters.shift();
    if (next) {
        // Hand our slot directly to the next waiter (active stays balanced).
        next();
    } else {
        active--;
    }
}

async function scanNode(entryPath: string, name: string, isDirectory: boolean): Promise<FileNode> {
    const node: FileNode = { name, path: entryPath, size: 0, isDirectory };

    if (!isDirectory) {
        await acquire();
        try {
            const st = await fsp.stat(entryPath);
            node.size = st.size;
        } catch {
            // Broken symlink / permission denied / race with deletion — size stays 0.
        } finally {
            release();
        }
        return node;
    }

    let entries: Dirent[];
    await acquire();
    try {
        entries = await fsp.readdir(entryPath, { withFileTypes: true });
    } catch {
        release();
        return node; // permission denied, etc.
    }
    release();

    // Scan all children in parallel; the shared limiter keeps the fd count bounded.
    const children = await Promise.all(
        entries.map(entry =>
            // NOTE: for symlinks entry.isDirectory() is false, so a linked
            // directory is treated as a file (stat follows the link for its
            // size). This deliberately avoids infinite loops on symlink cycles.
            scanNode(path.join(entryPath, entry.name), entry.name, entry.isDirectory())
        )
    );

    node.children = children;
    let total = 0;
    for (const child of children) {
        total += child.size;
    }
    node.size = total;

    return node;
}

export async function scanDirectory(rootPath: string): Promise<FileNode> {
    let isDir = false;
    try {
        const st = await fsp.stat(rootPath);
        isDir = st.isDirectory();
    } catch {
        // Return an empty node rather than throwing so the UI can still render.
        return { name: path.basename(rootPath), path: rootPath, size: 0, isDirectory: false };
    }
    return scanNode(rootPath, path.basename(rootPath), isDir);
}

export function formatSize(bytes: number): string {
    if (bytes === 0) { return '0 B'; }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, i);
    return i === 0 ? `${bytes} B` : `${val.toFixed(1)} ${units[i]}`;
}
