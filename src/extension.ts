import * as vscode from 'vscode';
import { TreemapPanel } from './TreemapPanel';

export function activate(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('disk-size-treemap.show', (uri?: vscode.Uri) => {
        return TreemapPanel.createOrShow(context, uri);
    });

    context.subscriptions.push(disposable);
}

export function deactivate(): void {}
