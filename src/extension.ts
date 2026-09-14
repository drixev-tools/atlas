import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectGraphStore } from './core/store';
import { GraphPanel } from './ui/graphPanel';

export const OPEN_GRAPH_VIEW_COMMAND = 'agentGraph.openGraphView';

export function activate(context: vscode.ExtensionContext): void {
	console.log('Agent Graph extension activated');

	context.subscriptions.push(
		vscode.commands.registerCommand(OPEN_GRAPH_VIEW_COMMAND, () => openGraphView(context))
	);
}

export function deactivate(): void {}

async function openGraphView(context: vscode.ExtensionContext): Promise<void> {
	const store = await ProjectGraphStore.open({ filePath: resolveGraphDbPath(context) });
	GraphPanel.createOrShow(context.extensionUri, store);
}

/**
 * Where the Project Graph Core's SQLite file lives for the current
 * workspace: VS Code's per-workspace storage location, so the graph persists
 * across sessions without writing anything into the project folder itself.
 * Falls back to global storage, then to an in-memory-only store, when no
 * workspace is open. Epic 7's "Analyze Workspace" command is expected to
 * populate this same file.
 */
function resolveGraphDbPath(context: vscode.ExtensionContext): string | undefined {
	const storageUri = context.storageUri ?? context.globalStorageUri;
	return storageUri ? path.join(storageUri.fsPath, 'project-graph.db') : undefined;
}
