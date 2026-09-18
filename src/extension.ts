import * as path from 'path';
import * as vscode from 'vscode';
import {
	AnthropicClaudeArchitectureIdentificationClient,
	AnthropicClaudeSequenceDiagramClient,
	AuthenticationError,
	resolveClaudeSettings,
	SecretStorageApiKeyStore,
	VsCodeClaudeSettingsStore
} from './design';
import { MementoUsageMetricsStore, UsageMetricEvent } from './core/metrics';
import { AtlasStore } from './core/store';
import {
	ActiveFileFlowPanel,
	ANALYZE_WORKSPACE_COMMAND,
	analyzeWorkspace,
	applyArchitectureIdentification,
	applySequenceDiagramNarration,
	buildFallbackSequenceDiagramViewState,
	GraphPanel,
	identifiedArchitectureEntities,
	IdentifiedArchitecturePanel,
	loadActiveFileSequenceContext,
	loadSequenceFunctionCandidates,
	OPEN_ARCHITECTURE_COMMAND,
	AtlasTreeProvider,
	registerSettingsView,
	registerSidebar,
	resolveCachedIdentifiedArchitecture,
	SequenceDiagramPanel,
	SHOW_ACTIVE_FILE_FLOW_COMMAND,
	SHOW_IDENTIFIED_ARCHITECTURE_COMMAND,
	SHOW_SEQUENCE_DIAGRAM_COMMAND,
	toArchitectureIdentificationEntities,
	toSequenceDiagramNarrationInput
} from './ui';

export {
	ANALYZE_WORKSPACE_COMMAND,
	OPEN_ARCHITECTURE_COMMAND,
	SHOW_ACTIVE_FILE_FLOW_COMMAND,
	SHOW_IDENTIFIED_ARCHITECTURE_COMMAND,
	SHOW_SEQUENCE_DIAGRAM_COMMAND
};

/**
 * Sidebar Panel's Tree View provider, refreshed after anything that changes
 * the Atlas graph (currently just the Analyze Workspace command) so the
 * tree doesn't go stale. `undefined` until `activate()` registers it.
 */
let sidebarTreeProvider: AtlasTreeProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
	console.log('Atlas extension activated');

	context.subscriptions.push(
		vscode.commands.registerCommand(ANALYZE_WORKSPACE_COMMAND, () => runAnalyzeWorkspaceCommand(context)),
		vscode.commands.registerCommand(OPEN_ARCHITECTURE_COMMAND, () => openArchitecture(context)),
		vscode.commands.registerCommand(SHOW_SEQUENCE_DIAGRAM_COMMAND, () => runShowSequenceDiagramCommand(context)),
		vscode.commands.registerCommand(SHOW_ACTIVE_FILE_FLOW_COMMAND, () => runShowActiveFileFlowCommand(context)),
		vscode.commands.registerCommand(SHOW_IDENTIFIED_ARCHITECTURE_COMMAND, () => runShowIdentifiedArchitectureCommand(context))
	);

	sidebarTreeProvider = registerSidebar(context, {
		rootDir: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
		dbPath: resolveGraphDbPath(context)
	});

	registerSettingsView(context, new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets)));
}

export function deactivate(): void {
	sidebarTreeProvider = undefined;
}

/**
 * "Atlas: Analyze Workspace" — the full-rebuild entry point: runs
 * both extraction pipelines over the first workspace folder and replaces the
 * Atlas store with their combined output, reporting progress and
 * completion/failure to the user. See `analyzeWorkspace` for the underlying,
 * `vscode`-free orchestration this wraps.
 */
async function runAnalyzeWorkspaceCommand(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'analyzeWorkspace');

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Atlas: open a folder or workspace before analyzing it.');
		return;
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Atlas: Analyzing workspace',
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
					`Atlas: analyzed workspace — ${result.nodeCount} nodes, ${result.edgeCount} edges.`
				);
			} catch (error) {
				void vscode.window.showErrorMessage(
					`Atlas: workspace analysis failed — ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	);
}

/**
 * "Atlas: Open Architecture" — opens the React Flow graph panel
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

	const store = await AtlasStore.open({ filePath: resolveGraphDbPath(context) });
	const claudeSettings = new VsCodeClaudeSettingsStore(new SecretStorageApiKeyStore(context.secrets));
	GraphPanel.createOrShow(context.extensionUri, store, claudeSettings, (filePath) => {
		void openActiveFileFlowForFile(context, filePath);
	});
}

/**
 * Opens ../ui/activeFileFlowPanel for a specific file path — how a file
 * card's click in the architecture view (`GraphPanel`'s
 * `architecture:openFileFlow`) reaches this panel. Opens its own
 * `AtlasStore`, like `runShowActiveFileFlowCommand` does, since
 * `ActiveFileFlowPanel` closes whatever store it's given on dispose and must
 * not share the architecture view's.
 */
async function openActiveFileFlowForFile(context: vscode.ExtensionContext, filePath: string): Promise<void> {
	const store = await AtlasStore.open({ filePath: resolveGraphDbPath(context) });
	ActiveFileFlowPanel.createOrShow(context.extensionUri, store, filePath);
}

/**
 * "Show Sequence Diagram" — like "Show Active File Flow", it acts on
 * whatever file is open in the active editor rather than a tree selection.
 * Since a file usually declares more than one function, it first asks via a
 * Quick Pick which one to trace, then builds that function's combined
 * ancestry-plus-call-chain diagram (../ui/sequenceDiagram's
 * `loadActiveFileSequenceContext`) — the active file's own import ancestry
 * (every chain of files that leads to it) followed by the chosen function's
 * outgoing calls — valid on its own, no API key required. When a key is
 * configured, Claude only relabels its steps and writes a summary, falling
 * back to the non-AI diagram on a missing key or a failed call instead of
 * blocking the view.
 */
async function runShowSequenceDiagramCommand(context: vscode.ExtensionContext): Promise<void> {
	const activeEditor = vscode.window.activeTextEditor;
	const activeFilePath = activeEditor?.document.uri.scheme === 'file' ? activeEditor.document.uri.fsPath : undefined;
	if (!activeFilePath) {
		void vscode.window.showErrorMessage('Atlas: open a file before showing its sequence diagram.');
		return;
	}

	const dbPath = resolveGraphDbPath(context);
	const resolved = await loadSequenceFunctionCandidates(dbPath, activeFilePath);
	if (!resolved || resolved.candidates.length === 0) {
		void vscode.window.showErrorMessage(
			'Atlas: no functions found in this file — analyze the workspace first, or open a file that declares one.'
		);
		return;
	}

	const picked = await vscode.window.showQuickPick(
		resolved.candidates.map((candidate) => ({
			label: candidate.containerName ? `${candidate.containerName}.${candidate.name}` : candidate.name,
			description: candidate.line !== undefined ? `line ${candidate.line}` : undefined,
			candidate
		})),
		{ placeHolder: 'Select a function to trace in the sequence diagram' }
	);
	if (!picked) {
		return;
	}

	recordUsage(context, 'showSequenceDiagram');

	const sequenceContext = await loadActiveFileSequenceContext(dbPath, resolved.activeFileId, picked.candidate.id);
	if (!sequenceContext) {
		void vscode.window.showErrorMessage(`Atlas: "${picked.candidate.name}" is no longer in the graph.`);
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
				`Atlas: Claude narration failed, showing the non-AI sequence diagram instead — ${
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

	const store = await AtlasStore.open({ filePath: resolveGraphDbPath(context) });
	const activeEditor = vscode.window.activeTextEditor;
	const activeFilePath = activeEditor?.document.uri.scheme === 'file' ? activeEditor.document.uri.fsPath : undefined;
	ActiveFileFlowPanel.createOrShow(context.extensionUri, store, activeFilePath);
}

/**
 * "Show Identified Architecture" — asks Claude to name the project's real
 * architecture pattern from an aggregated summary of the Atlas graph
 * (../ui/identifiedArchitecture), a second diagram entirely from "Open
 * Architecture", always AI-generated (there's no non-AI fallback content, so
 * a missing key or a failed call falls back to whatever's cached rather than
 * to a lesser diagram). A cached result renders instantly; Claude is only
 * called when nothing's cached yet or the module set has changed since.
 */
async function runShowIdentifiedArchitectureCommand(context: vscode.ExtensionContext): Promise<void> {
	recordUsage(context, 'showIdentifiedArchitecture');

	const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const store = await AtlasStore.open({ filePath: resolveGraphDbPath(context) });
	const graph = store.getGraph();
	const { groups, entityNodes, edges } = identifiedArchitectureEntities(store, graph, rootDir);
	const entities = toArchitectureIdentificationEntities(graph, groups, edges);

	if (entities.length === 0) {
		store.close();
		void vscode.window.showInformationMessage(
			'Atlas: nothing to identify an architecture from yet. Run "Atlas: Analyze Workspace" first.'
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
				`Atlas: identifying the architecture failed — ${error instanceof Error ? error.message : String(error)}`
			);
			panel.update(cached.model, cached.model ? 'ready' : 'empty');
		}
	} finally {
		store.close();
	}
}

/**
 * Where the Atlas Core's SQLite file lives for the current
 * workspace: VS Code's per-workspace storage location, so the graph persists
 * across sessions without writing anything into the project folder itself.
 * Falls back to global storage, then to an in-memory-only store, when no
 * workspace is open.
 */
function resolveGraphDbPath(context: vscode.ExtensionContext): string | undefined {
	const storageUri = context.storageUri ?? context.globalStorageUri;
	return storageUri ? path.join(storageUri.fsPath, 'atlas.db') : undefined;
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
