import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { scanDirectory, FileNode } from './FileScanner';

export class TreemapPanel {
    public static currentPanel: TreemapPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _currentPath: string;
    private _fullTree: FileNode | null = null;
    private _workspaceRoot: string;
    private readonly _extensionUri: vscode.Uri;
    private _refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;

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
        void this._scanFullAndSend(startPath);

        // Watch for file system changes and invalidate the cache.
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceRoot, '**/*')
        );
        const onFsChange = () => {
            // Immediately mark cache stale so any in-flight navigation
            // that finishes later will re-scan rather than use old data.
            this._fullTree = null;

            // Debounce: only trigger a visible refresh after changes settle.
            if (this._refreshDebounceTimer !== undefined) {
                clearTimeout(this._refreshDebounceTimer);
            }
            this._refreshDebounceTimer = setTimeout(() => {
                this._refreshDebounceTimer = undefined;
                if (this._panel.visible) {
                    void this._scanFullAndSend(this._currentPath);
                }
                // If not visible, cache is already null — next reveal will re-scan.
            }, 1500);
        };
        watcher.onDidCreate(onFsChange, null, this._disposables);
        watcher.onDidDelete(onFsChange, null, this._disposables);
        watcher.onDidChange(onFsChange, null, this._disposables);
        this._disposables.push(watcher);
    }

    /**
     * Resolve the target path from a context-menu URI:
     * - File: show its parent directory
     * - Folder: show that folder
     * - No URI: show workspace root
     */
    private static _resolveTargetPath(uri: vscode.Uri | undefined, workspaceRoot: string): string {
        if (!uri) {
            return workspaceRoot;
        }
        const fsPath = uri.fsPath;
        try {
            const stats = fs.statSync(fsPath);
            if (stats.isFile()) {
                return path.dirname(fsPath);
            }
            // It's a directory
            return fsPath;
        } catch {
            return workspaceRoot;
        }
    }

    public static createOrShow(context: vscode.ExtensionContext, uri?: vscode.Uri): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const targetPath = TreemapPanel._resolveTargetPath(uri, workspaceRoot);

        if (TreemapPanel.currentPanel) {
            TreemapPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            void TreemapPanel.currentPanel._scanCurrentAndSend(targetPath);
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

    /** First-time scan: scan both full workspace and send current-level view. */
    private async _scanFullAndSend(rootPath: string): Promise<void> {
        this._currentPath = rootPath;
        this._panel.webview.postMessage({ type: 'scanning', path: rootPath });

        // Scan the full workspace once, cache it. The async scanner yields to
        // the event loop, so the 'scanning' message renders before results.
        this._fullTree = await scanDirectory(this._workspaceRoot);

        // For the current-level tree, find the subtree at currentPath.
        const currentTree = this._findSubtree(this._fullTree, rootPath) || this._fullTree;

        this._panel.webview.postMessage({
            type: 'treeData',
            tree: this._serializeTree(currentTree),
            fullTree: this._serializeTree(this._fullTree),
            currentPath: rootPath
        });
    }

    /** Drill-down: reuse the cached fullTree subtree; only re-scan if not cached. */
    private async _scanCurrentAndSend(rootPath: string): Promise<void> {
        this._currentPath = rootPath;

        if (!this._fullTree) {
            this._panel.webview.postMessage({ type: 'scanning', path: rootPath });
            this._fullTree = await scanDirectory(this._workspaceRoot);
        }

        // Prefer the cached subtree — no filesystem work needed for drill-down.
        let currentTree = this._findSubtree(this._fullTree, rootPath);
        if (!currentTree) {
            // Path outside the cached tree (rare): scan it directly.
            this._panel.webview.postMessage({ type: 'scanning', path: rootPath });
            currentTree = await scanDirectory(rootPath);
        }

        this._panel.webview.postMessage({
            type: 'treeData',
            tree: this._serializeTree(currentTree),
            fullTree: this._serializeTree(this._fullTree),
            currentPath: rootPath
        });
    }

    /** Find the node at targetPath within the tree. */
    private _findSubtree(node: FileNode, targetPath: string): FileNode | null {
        const normalized = path.normalize(targetPath);
        if (path.normalize(node.path) === normalized) { return node; }
        if (node.children) {
            for (const child of node.children) {
                const found = this._findSubtree(child, targetPath);
                if (found) { return found; }
            }
        }
        return null;
    }

    private _serializeTree(node: FileNode): any {
        const obj: any = {
            name: node.name,
            path: node.path,
            size: node.size,
            isDirectory: node.isDirectory
        };
        if (node.children && node.children.length > 0) {
            obj.children = node.children.map(c => this._serializeTree(c));
        }
        return obj;
    }

    private _handleMessage(msg: { command: string; path?: string }): void {
        switch (msg.command) {
            case 'drillDown':
                if (msg.path) {
                    void this._scanCurrentAndSend(msg.path);
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
                        void this._scanCurrentAndSend(parent);
                    }
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
        if (this._refreshDebounceTimer !== undefined) {
            clearTimeout(this._refreshDebounceTimer);
        }
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
