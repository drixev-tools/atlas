import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectGraphStore } from './core/store';
import { ANALYZE_WORKSPACE_COMMAND, analyzeWorkspace, GraphPanel } from './ui';

export const OPEN_ARCHITECTURE_COMMAND = 'agentGraph.openArchitecture';
export { ANALYZE_WORKSPACE_COMMAND };

const ANALYZE_NOW_ACTION = 'Analyze Workspace';

export function activate(context: vscode.ExtensionContext): void {
	console.log('Agent Graph extension activated');

	context.subscriptions.push(
		vscode.commands.registerCommand(ANALYZE_WORKSPACE_COMMAND, () => runAnalyzeWorkspaceCommand(context)),
		vscode.commands.registerCommand(OPEN_ARCHITECTURE_COMMAND, () => openArchitecture(context))
	);
}

export function deactivate(): void {}

/**
 * "Project Graph: Analyze Workspace" — the full-rebuild entry point: runs
 * both extraction pipelines over the first workspace folder and replaces the
 * Project Graph store with their combined output, reporting progress and
 * completion/failure to the user. See `analyzeWorkspace` for the underlying,
 * `vscode`-free orchestration this wraps.
 */
async function runAnalyzeWorkspaceCommand(context: vscode.ExtensionContext): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Project Graph: open a folder or workspace before analyzing it.');
		return;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Project Graph: Analyzing workspace',
			cancellable: false
		},
		async (progress) => {
			try {
				const result = await analyzeWorkspace({
					rootDir: folder.uri.fsPath,
					dbPath: resolveGraphDbPath(context),
					onProgress: (message) => progress.report({ message })
				});
				void vscode.window.showInformationMessage(
					`Project Graph: analyzed workspace — ${result.nodeCount} nodes, ${result.edgeCount} edges.`
				);
			} catch (error) {
				void vscode.window.showErrorMessage(
					`Project Graph: workspace analysis failed — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);
}

/**
 * "Project Graph: Open Architecture" — opens the Cytoscape.js graph viewer
 * (Epic 6) over whatever is currently in the Project Graph store. The
 * webview already renders an empty-state message pointing at "Analyze
 * Workspace" (see `GraphPanel`), so this only needs to add a one-time,
 * non-blocking prompt offering to run that command for a workspace that
 * hasn't been analyzed yet.
 */
async function openArchitecture(context: vscode.ExtensionContext): Promise<void> {
	const store = await ProjectGraphStore.open({ filePath: resolveGraphDbPath(context) });
	const isEmpty = store.getGraph().nodes.length === 0;
	GraphPanel.createOrShow(context.extensionUri, store);

	if (isEmpty) {
		void promptToAnalyzeWorkspace(context);
	}
}

async function promptToAnalyzeWorkspace(context: vscode.ExtensionContext): Promise<void> {
	const choice = await vscode.window.showInformationMessage(
		'Project Graph: this workspace has not been analyzed yet. Run "Analyze Workspace" to build the graph.',
		ANALYZE_NOW_ACTION
	);
	if (choice === ANALYZE_NOW_ACTION) {
		await vscode.commands.executeCommand(ANALYZE_WORKSPACE_COMMAND);
		await openArchitecture(context);
	}
}

/**
 * Where the Project Graph Core's SQLite file lives for the current
 * workspace: VS Code's per-workspace storage location, so the graph persists
 * across sessions without writing anything into the project folder itself.
 * Falls back to global storage, then to an in-memory-only store, when no
 * workspace is open.
 */
function resolveGraphDbPath(context: vscode.ExtensionContext): string | undefined {
	const storageUri = context.storageUri ?? context.globalStorageUri;
	return storageUri ? path.join(storageUri.fsPath, 'project-graph.db') : undefined;
}
