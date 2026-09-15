import * as path from 'path';
import * as vscode from 'vscode';
import { AnthropicClaudeDesignClient, AuthenticationError, ensureAnthropicApiKey, SecretStorageApiKeyStore } from './design';
import { GitStatusProvider } from './core/gitStatus';
import { ProjectGraphStore } from './core/store';
import {
	ANALYZE_WORKSPACE_COMMAND,
	analyzeWorkspace,
	CalculateImpactResult,
	CALCULATE_IMPACT_COMMAND,
	calculateImpact,
	collectProjectIntent,
	DesignProjectResult,
	designProject,
	DESIGN_PROJECT_COMMAND,
	GraphPanel
} from './ui';

export const OPEN_ARCHITECTURE_COMMAND = 'agentGraph.openArchitecture';
export { ANALYZE_WORKSPACE_COMMAND, CALCULATE_IMPACT_COMMAND, DESIGN_PROJECT_COMMAND };

const ANALYZE_NOW_ACTION = 'Analyze Workspace';

/**
 * Reused across "Calculate Impact" invocations so its short git-status cache
 * (see `GitStatusProvider`) is actually effective instead of starting cold
 * every time the command runs.
 */
let gitStatusProvider: GitStatusProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
	console.log('Agent Graph extension activated');

	context.subscriptions.push(
		vscode.commands.registerCommand(ANALYZE_WORKSPACE_COMMAND, () => runAnalyzeWorkspaceCommand(context)),
		vscode.commands.registerCommand(OPEN_ARCHITECTURE_COMMAND, () => openArchitecture(context)),
		vscode.commands.registerCommand(CALCULATE_IMPACT_COMMAND, () => runCalculateImpactCommand(context)),
		vscode.commands.registerCommand(DESIGN_PROJECT_COMMAND, () => runDesignProjectCommand(context))
	);
}

export function deactivate(): void {
	gitStatusProvider = undefined;
}

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
 * "Project Graph: Calculate Impact" — computes the structural impact of the
 * workspace's uncommitted git changes (or, on a clean working tree, of the
 * active editor's file): their transitive consumers plus the tests related to
 * either. See `calculateImpact` for the underlying, `vscode`-free
 * orchestration this wraps.
 */
async function runCalculateImpactCommand(context: vscode.ExtensionContext): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Project Graph: open a folder or workspace before calculating impact.');
		return;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Project Graph: Calculating impact',
			cancellable: false
		},
		async (progress) => {
			try {
				const result = await calculateImpact({
					rootDir: folder.uri.fsPath,
					dbPath: resolveGraphDbPath(context),
					activeFilePath: vscode.window.activeTextEditor?.document.uri.fsPath,
					gitStatus: (gitStatusProvider ??= new GitStatusProvider()),
					onProgress: (message) => progress.report({ message })
				});
				await presentImpactResult(result);
			} catch (error) {
				void vscode.window.showErrorMessage(
					`Project Graph: impact calculation failed — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);
}

async function presentImpactResult(result: CalculateImpactResult): Promise<void> {
	if (result.source === 'none') {
		void vscode.window.showInformationMessage(
			'Project Graph: no uncommitted git changes and no active file in the Project Graph — nothing to calculate impact for.'
		);
		return;
	}

	const sourceLabel = result.source === 'git' ? 'uncommitted changes' : 'the active file';
	void vscode.window.showInformationMessage(
		`Project Graph: impact of ${sourceLabel} (${result.targets.length} file(s)) — ${result.impactedFiles.length} file(s) affected, ${result.relatedTests.length} related test(s).`
	);

	if (result.impactedFiles.length === 0 && result.relatedTests.length === 0) {
		return;
	}

	const items: Array<vscode.QuickPickItem & { filePath: string }> = [
		...result.targets.map((filePath) => impactQuickPickItem(filePath, '$(edit)', 'changed')),
		...result.impactedFiles.map((filePath) => impactQuickPickItem(filePath, '$(arrow-right)', 'impacted')),
		...result.relatedTests.map((filePath) => impactQuickPickItem(filePath, '$(beaker)', 'related test'))
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: 'Project Graph: Impact',
		placeHolder: 'Select a file to open'
	});
	if (picked) {
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(picked.filePath));
	}
}

function impactQuickPickItem(filePath: string, icon: string, description: string): vscode.QuickPickItem & { filePath: string } {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const label = folder ? path.relative(folder.uri.fsPath, filePath) : filePath;
	return { label: `${icon} ${label}`, description, filePath };
}

const OPEN_ARCHITECTURE_ACTION = 'Open Architecture';

/**
 * "Project Graph: Design Project" — collects intent for a new project or
 * feature (structured fields plus free text, see `collectProjectIntent`),
 * resolves the user's Anthropic API key from SecretStorage (prompting for it
 * the first time), and asks Claude to turn that intent into a Proposed
 * Graph. See `designProject` for the underlying, `vscode`-free orchestration
 * this wraps once intent and API key are in hand.
 */
async function runDesignProjectCommand(context: vscode.ExtensionContext): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Project Graph: open a folder or workspace before designing a project.');
		return;
	}

	const intent = await collectProjectIntent();
	if (!intent) {
		return;
	}

	const apiKeys = new SecretStorageApiKeyStore(context.secrets);
	const apiKey = await ensureAnthropicApiKey(apiKeys);
	if (!apiKey) {
		void vscode.window.showErrorMessage('Project Graph: an Anthropic API key is required to design a project.');
		return;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Project Graph: Designing project',
			cancellable: false
		},
		async (progress) => {
			try {
				const result = await designProject({
					rootDir: folder.uri.fsPath,
					dbPath: resolveGraphDbPath(context),
					intent,
					claudeClient: new AnthropicClaudeDesignClient(apiKey),
					onProgress: (message) => progress.report({ message })
				});
				await presentDesignProjectResult(result);
			} catch (error) {
				if (error instanceof AuthenticationError) {
					await apiKeys.delete();
					void vscode.window.showErrorMessage(
						'Project Graph: Anthropic rejected the stored API key — it has been cleared, run "Design Project" again to enter a new one.'
					);
					return;
				}
				void vscode.window.showErrorMessage(
					`Project Graph: designing the project failed — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);
}

async function presentDesignProjectResult(result: DesignProjectResult): Promise<void> {
	const choice = await vscode.window.showInformationMessage(
		`Project Graph: proposed architecture ready — ${result.nodeCount} node(s), ${result.edgeCount} edge(s). Open the graph to review it.`,
		OPEN_ARCHITECTURE_ACTION
	);
	if (choice === OPEN_ARCHITECTURE_ACTION) {
		await vscode.commands.executeCommand(OPEN_ARCHITECTURE_COMMAND);
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
