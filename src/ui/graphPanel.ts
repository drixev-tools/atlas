// The Project Graph's visual panel. Owns only the panel lifecycle and the
// postMessage bridge (contract in `./webview/protocol`); the actual
// node/edge data comes from `ProjectGraphStore`, collapsed to the workflow-
// relevant hierarchy by `filterGraphForWorkflow` for the symbol-level view,
// and to the folder/module-aggregated architecture view's data by
// `./architectureLayers` (which this panel also asks, on demand, for a
// group's file-level drill-down). Rendering/navigation across all of that —
// hierarchical layout, focus, progressive expansion, level switching —
// happens entirely in the webview script (`./webview/App.tsx`).
import * as vscode from 'vscode';
import { buildDiagramModel } from '../core/diagramModel';
import { diagramModelToMermaidFlowchart, toMermaidMarkdown } from '../core/diagramMermaid';
import { ProjectGraphStore, StoredGraph } from '../core/store';
import { AnthropicClaudeLayerNamingClient, AuthenticationError, ClaudeSettingsStore, resolveClaudeSettings } from '../design';
import {
	ArchitectureLayerGroup,
	buildArchitectureFileLevelData,
	buildArchitectureFlatFileData,
	buildArchitectureLayerData,
	applyLayerNamingResults,
	resolveCachedLayerLabels,
	toLayerNamingTargets
} from './architectureLayers';
import { ExportDestination, pickExportDestination, writeMarkdownExport, writePdfExportFromJpeg, writePngExport, writeSvgExport } from './diagramExport';
import { filterGraphForWorkflow } from './graphFilter';
import { findInitialFocusNodeId } from './graphFocus';
import { visibleGraph } from './graphExpansion';
import { ArchitectureLayerLabel, GraphExportView, HostToWebviewMessage, WebviewToHostMessage } from './webview/protocol';

const VIEW_TYPE = 'agentGraph.graphView';
const VIEW_TITLE = 'Project Graph';

/** Paths, relative to the extension root, of the esbuild-bundled webview script and stylesheet (see esbuild.js). esbuild emits `main.css` alongside `main.js` automatically because `main.tsx` imports CSS. */
const WEBVIEW_SCRIPT_PATH = ['dist', 'ui', 'webview', 'main.js'];
const WEBVIEW_STYLE_PATH = ['dist', 'ui', 'webview', 'main.css'];

/**
 * Single React Flow webview panel for the workspace's Project Graph.
 */
export class GraphPanel implements vscode.Disposable {
	private static current: GraphPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	/** The architecture view's current leaf groups, keyed by group id, so `architecture:requestFiles` can look one up without recomputing the whole layer aggregation. Repopulated by every `postGraph()`. */
	private groupsById = new Map<string, ArchitectureLayerGroup>();

	/** The save destination/format for an in-flight `graph:exportRequest`, awaiting the webview's `graph:exportCaptured` reply. */
	private pendingExport: ExportDestination | undefined;

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly extensionUri: vscode.Uri,
		private store: ProjectGraphStore,
		private readonly claudeSettings: ClaudeSettingsStore | undefined,
		private readonly openActiveFileFlow: ((filePath: string) => void) | undefined
	) {
		this.panel.webview.html = this.renderHtml();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(message: WebviewToHostMessage) => this.handleMessage(message),
			null,
			this.disposables
		);
	}

	/**
	 * Opens the graph view, or reveals and refreshes the existing one if it's
	 * already open. Takes ownership of `store` (closes it on
	 * dispose/replacement). `claudeSettings`, when given, lets the
	 * architecture view upgrade its folder-name group labels to
	 * Claude-generated ones in the background; omit it (as the existing
	 * `GraphPanel` tests do) to keep the view on folder names only.
	 * `openActiveFileFlow`, when given, opens ./activeFileFlowPanel's separate
	 * panel for a file path — how a file card's click (`architecture:openFileFlow`)
	 * is fulfilled, since that panel owns its own `ProjectGraphStore` and must
	 * not share this one.
	 */
	static createOrShow(
		extensionUri: vscode.Uri,
		store: ProjectGraphStore,
		claudeSettings?: ClaudeSettingsStore,
		openActiveFileFlow?: (filePath: string) => void
	): GraphPanel {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (GraphPanel.current) {
			GraphPanel.current.panel.reveal(column);
			GraphPanel.current.replaceStore(store);
			return GraphPanel.current;
		}

		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, VIEW_TITLE, column ?? vscode.ViewColumn.One, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'ui', 'webview')]
		});

		GraphPanel.current = new GraphPanel(panel, extensionUri, store, claudeSettings, openActiveFileFlow);
		return GraphPanel.current;
	}

	/** Syncs the currently open graph panel's selection to `nodeId`, e.g. when a tree item is clicked. No-op when no panel is open. */
	static selectNode(nodeId: string): void {
		GraphPanel.current?.postSelect(nodeId);
	}

	get webview(): vscode.Webview {
		return this.panel.webview;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		GraphPanel.current = undefined;
		this.store.close();
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.panel.dispose();
	}

	private replaceStore(store: ProjectGraphStore): void {
		if (store !== this.store) {
			this.store.close();
		}
		this.store = store;
		void this.postGraph();
	}

	private handleMessage(message: WebviewToHostMessage): void {
		if (message?.type === 'graph:ready') {
			void this.postGraph();
		} else if (message?.type === 'architecture:requestFiles') {
			this.postFiles(message.groupId);
		} else if (message?.type === 'architecture:requestFlatFiles') {
			this.postFlatFiles();
		} else if (message?.type === 'architecture:openFileFlow') {
			this.handleOpenFileFlow(message.fileId);
		} else if (message?.type === 'graph:exportRequest') {
			void this.handleExportRequest(message.view);
		} else if (message?.type === 'graph:exportCaptured') {
			void this.handleExportCaptured(message.format, message.payload, message.width, message.height);
		} else if (message?.type === 'graph:exportCaptureFailed') {
			this.pendingExport = undefined;
			void vscode.window.showErrorMessage('Project Graph: exporting the current view failed.');
		}
	}

	/**
	 * Sent on webview load (`graph:ready`) and whenever the panel is re-shown
	 * with a fresh store, e.g. via the command being run again. `focusNodeId`
	 * is resolved from the *current* active editor at each of those moments
	 * (both are, in effect, "opening the view"), against the
	 * already workflow-filtered graph so it always names a node the webview
	 * actually has. The architecture view's group labels are sent with an
	 * immediate folder-name (or last-known-good cached) fallback so this
	 * never waits on Claude; `refreshLayerLabels` upgrades them afterwards,
	 * in the background, for whichever groups actually need it.
	 */
	private async postGraph(): Promise<void> {
		const graph = this.store.getGraph();
		const workflowGraph = filterGraphForWorkflow(graph);
		const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

		const layers = buildArchitectureLayerData(this.store, graph, rootDir);
		this.groupsById = new Map(layers.groups.map((group) => [group.groupId, group]));
		const { labelsByGroupId, staleGroups } = resolveCachedLayerLabels(this.store, layers.groups);

		const update: HostToWebviewMessage = {
			type: 'graph:update',
			graph: workflowGraph,
			focusNodeId: findInitialFocusNodeId(workflowGraph, vscode.window.activeTextEditor?.document.uri.fsPath),
			architecture: {
				model: layers.model,
				labelsByGroupId: mapToRecord(labelsByGroupId),
				entryPointGroupIds: layers.entryPointGroupIds
			}
		};
		void this.panel.webview.postMessage(update);

		void this.refreshLayerLabels(graph, staleGroups);
	}

	private postFiles(groupId: string): void {
		const group = this.groupsById.get(groupId);
		if (!group) {
			return;
		}
		const graph = this.store.getGraph();
		const files = buildArchitectureFileLevelData(this.store, graph, group);
		const message: HostToWebviewMessage = {
			type: 'architecture:files',
			payload: { groupId, model: files.model, entryPointFileIds: files.entryPointFileIds }
		};
		void this.panel.webview.postMessage(message);
	}

	private postFlatFiles(): void {
		const graph = this.store.getGraph();
		const files = buildArchitectureFlatFileData(this.store, graph);
		const message: HostToWebviewMessage = {
			type: 'architecture:flatFiles',
			payload: { model: files.model, entryPointFileIds: files.entryPointFileIds }
		};
		void this.panel.webview.postMessage(message);
	}

	/**
	 * Names `staleGroups` via Claude (batched into one call) and, on success,
	 * pushes a label patch to the already-open view — a no-op when there's
	 * nothing stale, no `claudeSettings` was configured for this panel, or no
	 * API key is stored yet. A rejected key is cleared, like every other
	 * Claude-backed feature (see `extension.ts`'s `presentImpactResult`); any
	 * other failure just leaves the fallback labels in place; this is a
	 * background enhancement, not something worth surfacing an error for.
	 */
	private async refreshLayerLabels(graph: StoredGraph, staleGroups: ArchitectureLayerGroup[]): Promise<void> {
		if (staleGroups.length === 0 || !this.claudeSettings) {
			return;
		}
		const settings = await resolveClaudeSettings(this.claudeSettings);
		if (!settings) {
			return;
		}

		try {
			const client = new AnthropicClaudeLayerNamingClient(settings.apiKey, settings.model);
			const results = await client.nameLayers(toLayerNamingTargets(graph, staleGroups));
			const patch = applyLayerNamingResults(this.store, staleGroups, results);
			if (patch.size > 0 && !this.disposed) {
				const message: HostToWebviewMessage = { type: 'architecture:labels', labelsByGroupId: mapToRecord(patch) };
				void this.panel.webview.postMessage(message);
			}
		} catch (error) {
			if (error instanceof AuthenticationError) {
				await this.claudeSettings.clearApiKey();
			}
		}
	}

	/** Resolves `fileId` to its file path and hands it to `openActiveFileFlow`; shows an info message instead when the file isn't in the graph. */
	private handleOpenFileFlow(fileId: string): void {
		if (!this.openActiveFileFlow) {
			return;
		}
		const file = this.store.getNode(fileId);
		if (!file?.filePath) {
			void vscode.window.showInformationMessage('Project Graph: no file to trace.');
			return;
		}
		this.openActiveFileFlow(file.filePath);
	}

	private postSelect(nodeId: string): void {
		const select: HostToWebviewMessage = { type: 'graph:select', nodeId };
		void this.panel.webview.postMessage(select);
	}

	/** Shows the save dialog for "Export" and, for `markdown`, writes it immediately from data already on hand; `svg`/`png`/`pdf` need the webview's own rendered view, so those ask it to capture (`graph:exportCapture`) and wait for `graph:exportCaptured`. */
	private async handleExportRequest(view: GraphExportView): Promise<void> {
		const destination = await pickExportDestination('project-graph');
		if (!destination) {
			return;
		}

		if (destination.format === 'markdown') {
			const markdown = this.buildExportMarkdown(view);
			if (markdown) {
				await writeMarkdownExport(destination.uri, markdown);
			}
			return;
		}

		this.pendingExport = destination;
		const message: HostToWebviewMessage = { type: 'graph:exportCapture', format: destination.format };
		void this.panel.webview.postMessage(message);
	}

	private async handleExportCaptured(format: 'svg' | 'png' | 'pdf', payload: string, width: number, height: number): Promise<void> {
		const destination = this.pendingExport;
		this.pendingExport = undefined;
		if (!destination) {
			return;
		}
		if (format === 'svg') {
			await writeSvgExport(destination.uri, payload);
		} else if (format === 'png') {
			await writePngExport(destination.uri, payload);
		} else {
			await writePdfExportFromJpeg(destination.uri, payload, width, height);
		}
	}

	/** The Mermaid flowchart Markdown for whatever `view` the webview reports as currently showing — the layers level straight from `./architectureLayers`, with `expandedGroupIds`' own member files merged in as children the same way the webview does (`./webview/App.tsx`'s merge step), the files level from that same module's whole-project flat data, the symbol level rebuilt from the same `filterGraphForWorkflow`+`visibleGraph` pipeline `postGraph` uses. */
	private buildExportMarkdown(view: GraphExportView): string | undefined {
		const graph = this.store.getGraph();

		if (view.level === 'layers') {
			const rootDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			const layers = buildArchitectureLayerData(this.store, graph, rootDir);
			let model = layers.model;
			for (const groupId of view.expandedGroupIds) {
				const group = this.groupsById.get(groupId);
				if (!group) {
					continue;
				}
				const files = buildArchitectureFileLevelData(this.store, graph, group);
				model = {
					nodes: [...model.nodes, ...files.model.nodes.map((node) => ({ ...node, parentId: groupId }))],
					edges: [...model.edges, ...files.model.edges]
				};
			}
			return toMermaidMarkdown('Project Graph — Layered Architecture', diagramModelToMermaidFlowchart(model));
		}

		if (view.level === 'files') {
			const files = buildArchitectureFlatFileData(this.store, graph);
			return toMermaidMarkdown('Project Graph — Files', diagramModelToMermaidFlowchart(files.model));
		}

		if (!view.focusNodeId) {
			return undefined;
		}
		const workflowGraph = filterGraphForWorkflow(graph);
		const visible = visibleGraph(workflowGraph, view.focusNodeId, new Set(view.expandedNodeIds));
		const { model } = buildDiagramModel(visible);
		return toMermaidMarkdown('Project Graph — Symbols', diagramModelToMermaidFlowchart(model));
	}

	private renderHtml(): string {
		const webview = this.panel.webview;
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...WEBVIEW_SCRIPT_PATH));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...WEBVIEW_STYLE_PATH));
		const nonce = getNonce();
		const csp = [
			`default-src 'none'`,
			`style-src 'unsafe-inline' ${webview.cspSource}`,
			`img-src ${webview.cspSource} data:`,
			`font-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>${VIEW_TITLE}</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function mapToRecord(map: ReadonlyMap<string, ArchitectureLayerLabel>): Record<string, ArchitectureLayerLabel> {
	return Object.fromEntries(map);
}
