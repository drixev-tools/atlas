import * as path from 'path';
import * as vscode from 'vscode';
import {
	AnthropicClaudeDesignClient,
	AnthropicClaudeImpactClient,
	AnthropicClaudeSequenceDiagramClient,
	AuthenticationError,
	resolveClaudeSettings,
	SecretStorageApiKeyStore,
	VsCodeClaudeSettingsStore
} from './design';
import { GitStatusProvider } from './core/gitStatus';
import { MementoUsageMetricsStore, UsageMetricEvent } from './core/metrics';
import { ProjectGraphStore, StoredNode } from './core/store';
import {
	ANALYZE_WORKSPACE_COMMAND,
	analyzeWorkspace,
	buildEmptyImpactViewState,
	buildErrorSequenceDiagramViewState,
	buildFallbackExplanation,
	buildImpactViewState,
	buildNoApiKeySequenceDiagramViewState,
	buildSequenceDiagramViewState,
	CalculateImpactResult,
	CALCULATE_IMPACT_COMMAND,
	calculateImpact,
	collectProjectIntent,
	DesignProjectResult,
	designProject,
	DESIGN_PROJECT_COMMAND,
	FOCUS_SETTINGS_VIEW_COMMAND,
	GraphPanel,
	ImpactPanel,
	loadSequenceContext,
	OPEN_ARCHITECTURE_COMMAND,
	ProjectGraphTreeProvider,
	registerSettingsView,
	registerSidebar,
	SequenceDiagramPanel,
	SHOW_SEQUENCE_DIAGRAM_COMMAND,
	SidebarTreeNode,
	toImpactSummaryInput,
	toSequenceDiagramContextInput
} from './ui';

export { ANALYZE_WORKSPACE_COMMAND, CALCULATE_IMPACT_COMMAND, DESIGN_PROJECT_COMMAND, OPEN_ARCHITECTURE_COMMAND, SHOW_SEQUENCE_DIAGRAM_COMMAND };

/**
 * Reused across "Calculate Impact" invocations so its short git-status cache
 * (see `GitStatusProvider`) is actually effective instead of starting cold
 * every time the command runs.
 */
let gitStatusProvider: GitStatusProvider | undefined;

/**
 * Sidebar Panel's Tree View provider, refreshed after any command that
 * changes the Project Graph (Analyze Workspace, Design Project)
 * so the tree doesn't go stale. `undefined` until `activate()` registers it.
 */
let sidebarTreeProvider: ProjectGraphTreeProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
	console.log('Agent Graph extension activated');

	context.subscriptions.push(
		vscode.commands.registerCommand(ANALYZE_WORKSPACE_COMMAND, () => runAnalyzeWorkspaceCommand(context)),
		vscode.commands.registerCommand(OPEN_ARCHITECTURE_COMMAND, () => openArchitecture(context)),
		vscode.commands.registerCommand(CALCULATE_IMPACT_COMMAND, () => runCalculateImpactCommand(context)),
		vscode.commands.registerCommand(SHOW_SEQUENCE_DIAGRAM_COMMAND, (element: SidebarTreeNode | undefined) =>
			runShowSequenceDiagramCommand(context, element)
		),
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
 * (`../ui/graphPanel`). Reveals and refreshes the existing panel if one is
 * already open, otherwise creates it; either
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
 * orchestration this wraps; `presentImpactResult` turns that into the
 * persistent Impact view (../ui/impactView).
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
				await presentImpactResult(context, result);
			} catch (error) {
				void vscode.window.showErrorMessage(
					`Project Graph: impact calculation failed — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);
}

/**
 * Opens/refreshes the persistent Impact view — including, since there's
 * nothing structural to show, the empty-target case (`buildEmptyImpactViewState`)
 * rather than a one-off notification, so re-running the command always lands
 * in the same place. For a real target set, generates the explanation via
 * Claude when an Anthropic API key is configured (../design/settings) and
 * falls back to `buildFallbackExplanation`'s non-AI summary otherwise —
 * including when Claude itself fails, e.g. a stored key Anthropic now rejects
 * (`AuthenticationError`, cleared here like `runDesignProjectCommand` does),
 * so the view is never left without an explanation. A non-auth failure (e.g.
 * network/rate-limit) also surfaces a warning toast, since the fallback
 * summary alone wouldn't otherwise tell the user AI generation was attempted
 * and failed.
 */
async function presentImpactResult(context: vscode.ExtensionContext, result: CalculateImpactResult): Promise<void> {
	if (result.source === 'none') {
		ImpactPanel.createOrShow(buildEmptyImpactViewState());
		return;
	}
	const impactResult = result as CalculateImpactResult & { source: 'git' | 'activeFile' };

	const claudeSettings = new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets));
	const settings = await resolveClaudeSettings(claudeSettings);

	let explanation: string;
	let aiGenerated = false;
	if (settings) {
		try {
			explanation = await new AnthropicClaudeImpactClient(settings.apiKey, settings.model).explainImpact(
				toImpactSummaryInput(impactResult)
			);
			aiGenerated = true;
		} catch (error) {
			if (error instanceof AuthenticationError) {
				await claudeSettings.clearApiKey();
			} else {
				void vscode.window.showWarningMessage(
					`Project Graph: Claude explanation failed, showing a non-AI summary instead — ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
			explanation = buildFallbackExplanation(impactResult);
		}
	} else {
		explanation = buildFallbackExplanation(impactResult);
	}

	ImpactPanel.createOrShow(buildImpactViewState(impactResult, explanation, aiGenerated));
}

/**
 * "Show Sequence Diagram" — the sidebar tree's per-node context menu action
 * (function/file nodes only, see package.json's `view/item/context`
 * contribution). Builds the node's call context from the Project Graph
 * (../ui/sequenceDiagram's `loadSequenceContext`) and asks Claude to sketch a
 * sequence diagram from it, presented in the persistent
 * ../ui/sequenceDiagramView. There is no non-AI fallback — the diagram IS the
 * AI-generated artifact — so a missing/rejected API key instead shows a
 * message directing the user to the AI Settings sidebar view, mirroring how
 * `runDesignProjectCommand` handles the same case.
 */
async function runShowSequenceDiagramCommand(context: vscode.ExtensionContext, element: SidebarTreeNode | undefined): Promise<void> {
	if (!element || element.kind !== 'node' || (element.node.kind !== 'function' && element.node.kind !== 'file')) {
		return;
	}
	const node: StoredNode = element.node;

	recordUsage(context, 'showSequenceDiagram');

	const sequenceContext = await loadSequenceContext(resolveGraphDbPath(context), node.id);
	if (!sequenceContext) {
		void vscode.window.showErrorMessage(`Project Graph: "${node.name}" is no longer in the Project Graph.`);
		return;
	}

	const claudeSettings = new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets));
	const settings = await resolveClaudeSettings(claudeSettings);
	if (!settings) {
		SequenceDiagramPanel.createOrShow(buildNoApiKeySequenceDiagramViewState(sequenceContext));
		return;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Project Graph: Generating sequence diagram for "${node.name}"`,
			cancellable: false
		},
		async () => {
			try {
				const diagram = await new AnthropicClaudeSequenceDiagramClient(settings.apiKey, settings.model).generateSequenceDiagram(
					toSequenceDiagramContextInput(sequenceContext)
				);
				SequenceDiagramPanel.createOrShow(buildSequenceDiagramViewState(sequenceContext, diagram));
			} catch (error) {
				if (error instanceof AuthenticationError) {
					await claudeSettings.clearApiKey();
					SequenceDiagramPanel.createOrShow(buildNoApiKeySequenceDiagramViewState(sequenceContext));
					return;
				}
				SequenceDiagramPanel.createOrShow(
					buildErrorSequenceDiagramViewState(
						sequenceContext,
						`Claude did not return a sequence diagram — ${error instanceof Error ? error.message : String(error)}`
					)
				);
			}
		}
	);
}

const OPEN_ARCHITECTURE_ACTION = 'Open Architecture';

const OPEN_AI_SETTINGS_ACTION = 'Open AI Settings';

/**
 * "Project Graph: Design Project" — collects intent for a new project or
 * feature (structured fields plus free text, see `collectProjectIntent`),
 * resolves the Anthropic API key and Claude model from the shared
 * `ClaudeSettingsStore` (../design/settings), and asks
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
 * Bumps a local, offline usage counter in `context.globalState` — VS Code's
 * own per-install `Memento` storage, never transmitted anywhere by
 * this extension. Fire-and-forget: a command's usage count is never allowed
 * to hold up or fail the command itself.
 */
function recordUsage(context: vscode.ExtensionContext, event: UsageMetricEvent): void {
	void new MementoUsageMetricsStore(context.globalState).record(event);
}
