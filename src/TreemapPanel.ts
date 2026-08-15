import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { scanDirectory, FileNode, ScanResult, ScanControl, topLevelEntries } from './FileScanner';

const TOP_LEVEL_DISPLAY_LIMIT = 2000;

export class TreemapPanel {
    public static currentPanel: TreemapPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentPath: string;
    private _scannedTree: FileNode | null = null;
    private _scanResult: ScanResult | null = null;
    private _scanControl: ScanControl | null = null;
    private _scanToken = 0;
    private readonly _workspaceRoot: string;
    private readonly _extensionUri: vscode.Uri;

    private constructor(panel: vscode.WebviewPanel, workspaceRoot: string, extensionUri: vscode.Uri, startPath: string) {
        this._panel = panel;
        this._workspaceRoot = workspaceRoot;
        this._extensionUri = extensionUri;
        this._currentPath = startPath;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            msg => this._handleMessage(msg),
            null,
            this._disposables
        );

        this._panel.webview.html = this._getHtml();
        void this._scanAndSend(startPath);
        // NOTE: no FileSystemWatcher here. Watching `**/*` on a large tree
        // (e.g. the user profile) fires constantly and triggered endless
        // automatic re-scans. Refresh is now manual (toolbar button).
    }

    /**
     * Resolve the target path from a context-menu URI:
     * - File: show its parent directory
     * - Folder: show that folder
     * - No URI: show workspace root
     */
    private static async _resolveTargetPath(uri: vscode.Uri | undefined, workspaceRoot: string): Promise<string> {
        if (!uri) {
            return workspaceRoot;
        }
        const fsPath = uri.fsPath;
        try {
            const stats = await fsp.stat(fsPath);
            if (stats.isFile()) {
                return path.dirname(fsPath);
            }
            // It's a directory
            return fsPath;
        } catch {
            return workspaceRoot;
        }
    }

    public static async createOrShow(context: vscode.ExtensionContext, uri?: vscode.Uri): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const targetPath = await TreemapPanel._resolveTargetPath(uri, workspaceRoot);

        if (TreemapPanel.currentPanel) {
            TreemapPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            TreemapPanel.currentPanel._sendLevel(targetPath);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'workspaceSizeTreemap',
            'Disk Size Treemap',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'webview')
                ]
            }
        );

        // iconPath added in VS Code 1.94; use cast for older @types/vscode compatibility
        (panel as any).iconPath = vscode.Uri.joinPath(context.extensionUri, 'image', 'icon.png');

        TreemapPanel.currentPanel = new TreemapPanel(panel, workspaceRoot, context.extensionUri, targetPath);
    }

    /**
     * Scan a single folder and stream progress to the webview.
     *
     * Only the requested folder is scanned (NOT the whole workspace root),
     * which is what previously made scanning a folder like C:\Users appear
     * to hang. Results are pushed to the webview as they are computed.
     */
    private async _scanAndSend(rootPath: string): Promise<void> {
        this._currentPath = rootPath;
        if (this._scanControl) {
            this._scanControl.cancel();
            this._scanControl = null;
        }
        const token = ++this._scanToken;
        this._panel.webview.postMessage({ type: 'start', path: rootPath });

        const result = await scanDirectory(rootPath, (p) => {
            if (token !== this._scanToken) { return; }
            this._panel.webview.postMessage({
                type: 'progress',
                fileCount: p.fileCount,
                dirCount: p.dirCount,
                totalBytes: p.totalBytes,
                // Keep the displayed path stable at the folder being scanned;
                // the transient per-directory position must not change the UI.
                currentPath: rootPath,
                topLevel: p.topLevel,
                  totalChildren: p.totalChildren,
                typeStats: p.typeStats,
                largestFiles: p.largestFiles
            });
        }, (c) => {
            // Called synchronously at scan start; remember the handle so the
            // webview can pause/resume this scan.
            if (token === this._scanToken) {
                this._scanControl = c;
            }
        });

        // A newer scan superseded this one; drop the stale result.
        if (token !== this._scanToken) { return; }

        this._scanControl = null;
        this._scannedTree = result.root;
        this._scanResult = result;

        this._panel.webview.postMessage({
            type: 'result',
            currentPath: rootPath,
            topLevel: topLevelEntries(result.root, TOP_LEVEL_DISPLAY_LIMIT),
              totalChildren: result.root.children ? result.root.children.length : 0,
            typeStats: result.typeStats,
            largestFiles: result.largestFiles,
            fileCount: result.fileCount,
            dirCount: result.dirCount,
            totalBytes: result.totalBytes
        });
    }

    /**
     * Show a directory's immediate children. Prefers the in-memory tree so
     * drill-down is instant (no filesystem work); falls back to a fresh scan
     * when the path is not part of the cached tree.
     */
    private _sendLevel(targetPath: string): void {
        this._currentPath = targetPath;

        const tree = this._scannedTree;
        if (!tree) {
            void this._scanAndSend(targetPath);
            return;
        }

        const node = this._findSubtree(tree, targetPath);
        if (!node) {
            // Path outside the scanned tree (e.g. `goUp` above the root).
            void this._scanAndSend(targetPath);
            return;
        }

        this._panel.webview.postMessage({
            type: 'level',
            currentPath: targetPath,
            topLevel: topLevelEntries(node, TOP_LEVEL_DISPLAY_LIMIT),
              totalChildren: node.children ? node.children.length : 0
        });
    }

    /** Find the directory node at targetPath within the tree by walking the
     *  relative path down from `root` instead of DFS-ing the whole tree. */
    private _findSubtree(root: FileNode, targetPath: string): FileNode | null {
        const rootPath = root.path ? path.normalize(root.path) : '';
        const target = path.normalize(targetPath);
        if (!rootPath) { return null; }
        const rel = path.relative(rootPath, target);
        if (rel === '') { return root; }
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) { return null; }

        let cur: FileNode = root;
        const segments = rel.split(path.sep);
        for (const seg of segments) {
            const children = cur.children || [];
            let next: FileNode | undefined;
            for (let i = 0; i < children.length; i++) {
                if (children[i].name === seg) {
                    next = children[i];
                    break;
                }
            }
            if (!next) { return null; }
            cur = next;
        }
        return cur;
    }

    private _handleMessage(msg: { command: string; path?: string }): void {
        switch (msg.command) {
            case 'drillDown':
                if (msg.path) {
                    this._sendLevel(msg.path);
                }
                break;
            case 'revealInExplorer':
                if (msg.path) {
                    vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(msg.path));
                }
                break;
            case 'openFile':
                if (msg.path) {
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.path));
                }
                break;
            case 'goUp':
                if (this._currentPath) {
                    const parent = path.dirname(this._currentPath);
                    if (parent !== this._currentPath) {
                        this._sendLevel(parent);
                    }
                }
                break;
            case 'rescan':
                // Manual refresh: re-scan the folder currently being shown.
                void this._scanAndSend(this._currentPath);
                break;
            case 'pause':
                if (this._scanControl) {
                    this._scanControl.pause();
                    this._panel.webview.postMessage({ type: 'pauseState', paused: true });
                }
                break;
            case 'resume':
                if (this._scanControl) {
                    this._scanControl.resume();
                    this._panel.webview.postMessage({ type: 'pauseState', paused: false });
                }
                break;
        }
    }

    private _getHtml(): string {
        const extPath = path.join(__dirname, '..', 'webview');
        let css = '';
        let js = '';
        try {
            css = fs.readFileSync(path.join(extPath, 'style.css'), 'utf-8');
            js = fs.readFileSync(path.join(extPath, 'treemap.js'), 'utf-8');
        } catch {
            // fallback: webview files may not be available during development
        }

        const codiconUri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'codicons', 'codicon.css')
        );
        const d3Uri = this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'webview', 'd3', 'd3.min.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${this._panel.webview.cspSource} 'unsafe-inline'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; font-src ${this._panel.webview.cspSource};">
    <title>Disk Size Treemap</title>
    <link rel="stylesheet" href="${codiconUri}" />
    <style>${css}</style>
</head>
<body>
    <div id="toolbar">
        <div class="view-tabs">
            <button class="tab active" data-view="structure"><i class="codicon codicon-folder"></i> File Structure</button>
            <button class="tab" data-view="types"><i class="codicon codicon-symbol-color"></i> File Types</button>
            <button class="tab" data-view="largest"><i class="codicon codicon-graph"></i> Largest Files</button>
        </div>
        <div class="toolbar-options">
            <button id="pause-btn" title="Pause or resume scanning" disabled><i class="codicon codicon-debug-pause"></i> Pause</button>
            <button id="refresh-btn" title="Rescan the current folder"><i class="codicon codicon-refresh"></i> Refresh</button>
            <label id="largest-controls" class="hidden">
                <select id="type-filter">
                    <option value="">All Types</option>
                </select>
                Top
                <input type="number" id="topn-input" value="50" min="1" max="1000" />
                files
            </label>
        </div>
    </div>
    <div id="status"></div>
    <div id="breadcrumb"></div>
    <div id="treemap"></div>
    <div id="table-view" class="hidden"></div>
    <div id="tooltip" class="tooltip hidden"></div>
    <script src="${d3Uri}"></script>
    <script>${js}</script>
</body>
</html>`;
    }

    public dispose(): void {
        TreemapPanel.currentPanel = undefined;
        if (this._scanControl) {
            this._scanControl.cancel();
            this._scanControl = null;
        }
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
