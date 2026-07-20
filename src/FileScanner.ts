import * as fs from 'fs';
import * as path from 'path';

export interface FileNode {
    name: string;
    path: string;
    size: number;
    isDirectory: boolean;
    children?: FileNode[];
}

export function scanDirectory(rootPath: string): FileNode {
    const stats = fs.statSync(rootPath);
    const node: FileNode = {
        name: path.basename(rootPath),
        path: rootPath,
        size: 0,
        isDirectory: stats.isDirectory()
    };

    if (stats.isDirectory()) {
        node.children = [];
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(rootPath, { withFileTypes: true });
        } catch {
            return node; // permission denied, etc.
        }
        for (const entry of entries) {
            const childPath = path.join(rootPath, entry.name);
            const child = scanDirectory(childPath);
            node.size += child.size;
            node.children.push(child);
        }
    } else {
        node.size = stats.size;
    }

    return node;
}

export function formatSize(bytes: number): string {
    if (bytes === 0) { return '0 B'; }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, i);
    return i === 0 ? `${bytes} B` : `${val.toFixed(1)} ${units[i]}`;
}
