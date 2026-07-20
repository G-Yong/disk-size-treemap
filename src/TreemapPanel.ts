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

    private constructor(panel: vscode.WebviewPanel, workspaceRoot: string) {
        this._panel = panel;
        this._currentPath = workspaceRoot;
        this._workspaceRoot = workspaceRoot;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            msg => this._handleMessage(msg),
            null,
            this._disposables
        );

        this._panel.webview.html = this._getHtml();
        this._scanFullAndSend(workspaceRoot);
    }

    public static createOrShow(context: vscode.ExtensionContext): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        if (TreemapPanel.currentPanel) {
            TreemapPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            TreemapPanel.currentPanel._scanCurrentAndSend(workspaceRoot);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'workspaceSizeTreemap',
            'Disk Size Treemap',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        TreemapPanel.currentPanel = new TreemapPanel(panel, workspaceRoot);
    }

    /** First-time scan: scan both full workspace and send current-level view. */
    private _scanFullAndSend(rootPath: string): void {
        this._currentPath = rootPath;
        this._panel.webview.postMessage({ type: 'scanning', path: rootPath });

        setTimeout(() => {
            // Scan full workspace once, cache it
            this._fullTree = scanDirectory(this._workspaceRoot);

            // For the current-level tree, we need to find the subtree at currentPath
            const currentTree = this._findSubtree(this._fullTree, rootPath) || this._fullTree;

            this._panel.webview.postMessage({
                type: 'treeData',
                tree: this._serializeTree(currentTree),
                fullTree: this._serializeTree(this._fullTree),
                currentPath: rootPath
            });
        }, 0);
    }

    /** Drill-down: scan only the requested subtree, but keep fullTree cached. */
    private _scanCurrentAndSend(rootPath: string): void {
        this._currentPath = rootPath;
        this._panel.webview.postMessage({ type: 'scanning', path: rootPath });

        setTimeout(() => {
            // Re-use cached fullTree if available; re-scan if not
            if (!this._fullTree) {
                this._fullTree = scanDirectory(this._workspaceRoot);
            }
            const currentTree = scanDirectory(rootPath);

            this._panel.webview.postMessage({
                type: 'treeData',
                tree: this._serializeTree(currentTree),
                fullTree: this._serializeTree(this._fullTree),
                currentPath: rootPath
            });
        }, 0);
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
                    this._scanCurrentAndSend(msg.path);
                }
                break;
            case 'revealInExplorer':
                if (msg.path) {
                    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
                }
                break;
            case 'goUp':
                if (this._currentPath) {
                    const parent = path.dirname(this._currentPath);
                    if (parent !== this._currentPath) {
                        this._scanCurrentAndSend(parent);
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

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src https://d3js.org 'unsafe-inline'; style-src 'unsafe-inline';">
    <title>Disk Size Treemap</title>
    <style>${css}</style>
</head>
<body>
    <div id="toolbar">
        <div class="view-tabs">
            <button class="tab active" data-view="structure">📁 File Structure</button>
            <button class="tab" data-view="types">🎨 File Types</button>
            <button class="tab" data-view="largest">📊 Largest Files</button>
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
    <script src="https://d3js.org/d3.v7.min.js"></script>
    <script>${js}</script>
</body>
</html>`;
    }

    public dispose(): void {
        TreemapPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const d = this._disposables.pop();
            if (d) { d.dispose(); }
        }
    }
}
