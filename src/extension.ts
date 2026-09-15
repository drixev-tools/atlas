import * as path from 'path';
import * as vscode from 'vscode';
import { AnthropicClaudeDesignClient, AuthenticationError, resolveClaudeSettings, SecretStorageApiKeyStore, VsCodeClaudeSettingsStore } from './design';
import { GitStatusProvider } from './core/gitStatus';
import { MementoUsageMetricsStore, UsageMetricEvent } from './core/metrics';
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
	FOCUS_SETTINGS_VIEW_COMMAND,
	GraphPanel,
	OPEN_ARCHITECTURE_COMMAND,
	ProjectGraphTreeProvider,
	registerSettingsView,
	registerSidebar
} from './ui';

export { ANALYZE_WORKSPACE_COMMAND, CALCULATE_IMPACT_COMMAND, DESIGN_PROJECT_COMMAND, OPEN_ARCHITECTURE_COMMAND };

/**
 * Reused across "Calculate Impact" invocations so its short git-status cache
 * (see `GitStatusProvider`) is actually effective instead of starting cold
 * every time the command runs.
 */
let gitStatusProvider: GitStatusProvider | undefined;

/**
 * Sidebar Panel's Tree View provider (Fase 1.1, Epic A), refreshed after any
 * command that changes the Project Graph (Analyze Workspace, Design Project)
 * so the tree doesn't go stale. `undefined` until `activate()` registers it.
 */
let sidebarTreeProvider: ProjectGraphTreeProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
	console.log('Agent Graph extension activated');

	context.subscriptions.push(
		vscode.commands.registerCommand(ANALYZE_WORKSPACE_COMMAND, () => runAnalyzeWorkspaceCommand(context)),
		vscode.commands.registerCommand(OPEN_ARCHITECTURE_COMMAND, () => openArchitecture(context)),
		vscode.commands.registerCommand(CALCULATE_IMPACT_COMMAND, () => runCalculateImpactCommand(context)),
		vscode.commands.registerCommand(DESIGN_PROJECT_COMMAND, () => runDesignProjectCommand(context))
	);

	sidebarTreeProvider = registerSidebar(context, {
		rootDir: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		dbPath: resolveGraphDbPath(context)
	});

	registerSettingsView(context, new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets)));
}

export function deactivate(): void {
	gitStatusProvider = undefined;
	sidebarTreeProvider = undefined;
}

/**
 * "Project Graph: Analyze Workspace" — the full-rebuild entry point: runs
 * both extraction pipelines over the first workspace folder and replaces the
 * Project Graph store with their combined output, reporting progress and
 * completion/failure to the user. See `analyzeWorkspace` for the underlying,
 * `vscode`-free orchestration this wraps.
 */
async function runAnalyzeWorkspaceCommand(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'analyzeWorkspace');

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
				await sidebarTreeProvider?.refresh();
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
 * "Project Graph: Open Architecture" — opens the React Flow graph panel
 * (`../ui/graphPanel`), rebuilt in Fase 1.2, Epic F after the Cytoscape.js
 * viewer it replaces (Epic 6) was retired in Epic D. Reveals and refreshes
 * the existing panel if one is already open, otherwise creates it; either
 * way it (re)focuses on the active editor's file and that file's direct
 * relations, per `GraphPanel`'s own `graph:update` handling.
 */
async function openArchitecture(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'openArchitecture');

	const store = await ProjectGraphStore.open({ filePath: resolveGraphDbPath(context) });
	GraphPanel.createOrShow(context.extensionUri, store);
}

/**
 * "Project Graph: Calculate Impact" — computes the structural impact of the
 * workspace's uncommitted git changes (or, on a clean working tree, of the
 * active editor's file): their transitive consumers plus the tests related to
 * either. See `calculateImpact` for the underlying, `vscode`-free
 * orchestration this wraps.
 */
async function runCalculateImpactCommand(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'calculateImpact');

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

const OPEN_AI_SETTINGS_ACTION = 'Open AI Settings';

/**
 * "Project Graph: Design Project" — collects intent for a new project or
 * feature (structured fields plus free text, see `collectProjectIntent`),
 * resolves the Anthropic API key and Claude model from the shared
 * `ClaudeSettingsStore` (Fase 1.2, Epic G; ../design/settings), and asks
 * Claude to turn that intent into a Proposed Graph. If no API key is
 * configured yet, this points the user at the AI Settings sidebar view
 * (../ui/settingsView) instead of prompting inline — that view is now the
 * only place the key is entered. See `designProject` for the underlying,
 * `vscode`-free orchestration this wraps once intent and settings are in
 * hand.
 */
async function runDesignProjectCommand(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'designProject');

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Project Graph: open a folder or workspace before designing a project.');
		return;
	}

	const intent = await collectProjectIntent();
	if (!intent) {
		return;
	}

	const claudeSettings = new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets));
	const settings = await resolveClaudeSettings(claudeSettings);
	if (!settings) {
		await promptToOpenAiSettings('an Anthropic API key is required to design a project');
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
					claudeClient: new AnthropicClaudeDesignClient(settings.apiKey, settings.model),
					onProgress: (message) => progress.report({ message })
				});
				await sidebarTreeProvider?.refresh();
				await presentDesignProjectResult(result);
			} catch (error) {
				if (error instanceof AuthenticationError) {
					await claudeSettings.clearApiKey();
					await promptToOpenAiSettings('Anthropic rejected the stored API key — it has been cleared');
					return;
				}
				void vscode.window.showErrorMessage(
					`Project Graph: designing the project failed — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);
}

/** Directs the user to the AI Settings sidebar view (../ui/settingsView) to configure/re-configure the Anthropic API key, e.g. after `promptToOpenAiSettings`'s callers find none stored or a stored one gets rejected. */
async function promptToOpenAiSettings(reason: string): Promise<void> {
	const choice = await vscode.window.showErrorMessage(
		`Project Graph: ${reason} — configure it in the AI Settings sidebar view.`,
		OPEN_AI_SETTINGS_ACTION
	);
	if (choice === OPEN_AI_SETTINGS_ACTION) {
		await vscode.commands.executeCommand(FOCUS_SETTINGS_VIEW_COMMAND);
	}
}

async function presentDesignProjectResult(result: DesignProjectResult): Promise<void> {
	const choice = await vscode.window.showInformationMessage(
		`Project Graph: proposed architecture ready — ${result.nodeCount} node(s), ${result.edgeCount} edge(s), ` +
			`${result.matchedNodeCount} already in the code. Open the graph to review it.`,
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

/**
 * Bumps a local, offline usage counter (Epic 11) in `context.globalState` —
 * VS Code's own per-install `Memento` storage, never transmitted anywhere by
 * this extension. Fire-and-forget: a command's usage count is never allowed
 * to hold up or fail the command itself.
 */
function recordUsage(context: vscode.ExtensionContext, event: UsageMetricEvent): void {
	void new MementoUsageMetricsStore(context.globalState).record(event);
}
