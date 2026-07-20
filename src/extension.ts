import * as vscode from 'vscode';
import { TreemapPanel } from './TreemapPanel';

export function activate(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('disk-size-treemap.show', () => {
        TreemapPanel.createOrShow(context);
    });

    context.subscriptions.push(disposable);
}

export function deactivate(): void {}
