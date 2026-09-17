import * as path from 'path';
import * as vscode from 'vscode';
import {
	AnthropicClaudeArchitectureIdentificationClient,
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
	ActiveFileFlowPanel,
	ANALYZE_WORKSPACE_COMMAND,
	analyzeWorkspace,
	applyArchitectureIdentification,
	applySequenceDiagramNarration,
	buildEmptyImpactViewState,
	buildFallbackExplanation,
	buildFallbackSequenceDiagramViewState,
	buildImpactViewState,
	CalculateImpactResult,
	CALCULATE_IMPACT_COMMAND,
	calculateImpact,
	DESIGN_PROJECT_COMMAND,
	FOCUS_DESIGN_PROJECT_VIEW_COMMAND,
	GraphPanel,
	identifiedArchitectureEntities,
	IdentifiedArchitecturePanel,
	ImpactPanel,
	loadSequenceContext,
	OPEN_ARCHITECTURE_COMMAND,
	ProjectGraphTreeProvider,
	registerDesignProjectView,
	registerSettingsView,
	registerSidebar,
	resolveCachedIdentifiedArchitecture,
	SequenceDiagramPanel,
	SHOW_ACTIVE_FILE_FLOW_COMMAND,
	SHOW_IDENTIFIED_ARCHITECTURE_COMMAND,
	SHOW_SEQUENCE_DIAGRAM_COMMAND,
	SidebarTreeNode,
	toArchitectureIdentificationEntities,
	toImpactSummaryInput,
	toSequenceDiagramNarrationInput
} from './ui';

export {
	ANALYZE_WORKSPACE_COMMAND,
	CALCULATE_IMPACT_COMMAND,
	DESIGN_PROJECT_COMMAND,
	OPEN_ARCHITECTURE_COMMAND,
	SHOW_ACTIVE_FILE_FLOW_COMMAND,
	SHOW_IDENTIFIED_ARCHITECTURE_COMMAND,
	SHOW_SEQUENCE_DIAGRAM_COMMAND
};

/**
 * Reused across "Calculate Impact" invocations so its short git-status cache
 * (see `GitStatusProvider`) is actually effective instead of starting cold
 * every time the command runs.
 */
let gitStatusProvider: GitStatusProvider | undefined;

/**
 * Sidebar Panel's Tree View provider, refreshed after anything that changes
 * the Project Graph (the Analyze Workspace command, a Design Project
 * submission) so the tree doesn't go stale. `undefined` until `activate()`
 * registers it.
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
		vscode.commands.registerCommand(SHOW_ACTIVE_FILE_FLOW_COMMAND, () => runShowActiveFileFlowCommand(context)),
		vscode.commands.registerCommand(SHOW_IDENTIFIED_ARCHITECTURE_COMMAND, () => runShowIdentifiedArchitectureCommand(context)),
		vscode.commands.registerCommand(DESIGN_PROJECT_COMMAND, () => vscode.commands.executeCommand(FOCUS_DESIGN_PROJECT_VIEW_COMMAND))
	);

	sidebarTreeProvider = registerSidebar(context, {
		rootDir: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		dbPath: resolveGraphDbPath(context)
	});

	registerSettingsView(context, new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets)));

	registerDesignProjectView(context, {
		settings: new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets)),
		resolveRootDir: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		resolveDbPath: () => resolveGraphDbPath(context),
		onSubmit: () => recordUsage(context, 'designProject'),
		onDesigned: () => sidebarTreeProvider?.refresh()
	});
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
 * (`../ui/graphPanel`), which now opens on its layered-architecture view
 * (`../ui/architectureLayers`) rather than the file-focused symbol view;
 * drilling into a file there opens its import flow in the Active File Flow
 * view (`../ui/activeFileFlowPanel`) instead of the old file-focused symbol
 * view. Reveals and refreshes the existing panel if one is already open,
 * otherwise creates it. `claudeSettings` lets the architecture view upgrade
 * its folder-name group labels to Claude-generated ones in the background.
 */
async function openArchitecture(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'openArchitecture');

	const store = await ProjectGraphStore.open({ filePath: resolveGraphDbPath(context) });
	const claudeSettings = new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets));
	GraphPanel.createOrShow(context.extensionUri, store, claudeSettings, (filePath) => {
		void openActiveFileFlowForFile(context, filePath);
	});
}

/**
 * Opens ../ui/activeFileFlowPanel for a specific file path — how a file
 * card's click in the architecture view (`GraphPanel`'s
 * `architecture:openFileFlow`) reaches this panel. Opens its own
 * `ProjectGraphStore`, like `runShowActiveFileFlowCommand` does, since
 * `ActiveFileFlowPanel` closes whatever store it's given on dispose and must
 * not share the architecture view's.
 */
async function openActiveFileFlowForFile(context: vscode.ExtensionContext, filePath: string): Promise<void> {
	const store = await ProjectGraphStore.open({ filePath: resolveGraphDbPath(context) });
	ActiveFileFlowPanel.createOrShow(context.extensionUri, store, filePath);
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
 * contribution). Builds the node's real `calls`-edge chain from the Project
 * Graph (../ui/sequenceDiagram's `loadSequenceContext`) into a diagram that's
 * valid on its own — no API key required — then, when one is configured,
 * asks Claude only to relabel its steps and write a summary, mirroring how
 * `runCalculateImpactCommand` falls back to a non-AI explanation on a missing
 * key or a failed call instead of blocking the view.
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

	const panel = SequenceDiagramPanel.createOrShow(context.extensionUri, buildFallbackSequenceDiagramViewState(sequenceContext));

	const claudeSettings = new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets));
	const settings = await resolveClaudeSettings(claudeSettings);
	if (!settings) {
		return;
	}

	try {
		const narration = await new AnthropicClaudeSequenceDiagramClient(settings.apiKey, settings.model).narrateSequence(
			toSequenceDiagramNarrationInput(sequenceContext)
		);
		panel.update(applySequenceDiagramNarration(sequenceContext, narration));
	} catch (error) {
		if (error instanceof AuthenticationError) {
			await claudeSettings.clearApiKey();
		} else {
			void vscode.window.showWarningMessage(
				`Project Graph: Claude narration failed, showing the non-AI sequence diagram instead — ${
					error instanceof Error ? error.message : String(error)
				}`
			);
		}
	}
}

/**
 * "Show Active File Flow" — opens ../ui/activeFileFlowPanel for whatever file
 * is open in the active editor (if any) when the command runs. Unlike the old
 * entry-point picker, there's no selection step: once open, the panel tracks
 * `vscode.window.onDidChangeActiveTextEditor` itself and keeps retracing the
 * flow as the user switches files.
 */
async function runShowActiveFileFlowCommand(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'showActiveFileFlow');

	const store = await ProjectGraphStore.open({ filePath: resolveGraphDbPath(context) });
	const activeEditor = vscode.window.activeTextEditor;
	const activeFilePath = activeEditor?.document.uri.scheme === 'file' ? activeEditor.document.uri.fsPath : undefined;
	ActiveFileFlowPanel.createOrShow(context.extensionUri, store, activeFilePath);
}

/**
 * "Show Identified Architecture" — asks Claude to name the project's real
 * architecture pattern from an aggregated summary of the Project Graph
 * (../ui/identifiedArchitecture), a second diagram entirely from "Open
 * Architecture", always AI-generated (there's no non-AI fallback content, so
 * a missing key or a failed call falls back to whatever's cached rather than
 * to a lesser diagram). A cached result renders instantly; Claude is only
 * called when nothing's cached yet or the module set has changed since.
 */
async function runShowIdentifiedArchitectureCommand(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'showIdentifiedArchitecture');

	const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const store = await ProjectGraphStore.open({ filePath: resolveGraphDbPath(context) });
	const graph = store.getGraph();
	const { groups, entityNodes, edges } = identifiedArchitectureEntities(store, graph, rootDir);
	const entities = toArchitectureIdentificationEntities(graph, groups, edges);

	if (entities.length === 0) {
		store.close();
		void vscode.window.showInformationMessage(
			'Project Graph: nothing to identify an architecture from yet. Run "Project Graph: Analyze Workspace" first.'
		);
		return;
	}

	const cached = resolveCachedIdentifiedArchitecture(store, entityNodes, edges, entities);

	const claudeSettings = new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets));
	const settings = await resolveClaudeSettings(claudeSettings);

	if (cached.model && !cached.stale) {
		store.close();
		IdentifiedArchitecturePanel.createOrShow(context.extensionUri, cached.model, 'ready');
		return;
	}

	if (!settings) {
		store.close();
		IdentifiedArchitecturePanel.createOrShow(context.extensionUri, cached.model, 'needsApiKey');
		return;
	}

	const panel = IdentifiedArchitecturePanel.createOrShow(context.extensionUri, cached.model, 'loading');

	try {
		const identification = await new AnthropicClaudeArchitectureIdentificationClient(settings.apiKey, settings.model).identifyArchitecture(
			entities
		);
		const result = applyArchitectureIdentification(store, entityNodes, edges, entities, identification);
		panel.update(result, 'ready');
	} catch (error) {
		if (error instanceof AuthenticationError) {
			await claudeSettings.clearApiKey();
			panel.update(cached.model, cached.model ? 'ready' : 'needsApiKey');
		} else {
			void vscode.window.showWarningMessage(
				`Project Graph: identifying the architecture failed — ${error instanceof Error ? error.message : String(error)}`
			);
			panel.update(cached.model, cached.model ? 'ready' : 'empty');
		}
	} finally {
		store.close();
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
