// The entry-point flow view's panel lifecycle and postMessage bridge
// (contract in ./webview/entryPointFlowProtocol) — mirrors ./graphPanel's
// singleton create-or-reveal shape, but as its own `WebviewPanel` (a
// different diagram entirely from the Project Graph/Architecture view, not
// another mode of it) loading the same bundled React Flow script
// (./webview/main.tsx picks the root component via `data-view`). Node/edge
// data comes from ../core/entryPointFlow via ./entryPointFlow; rendering,
// entry-point switching, and progressive expansion happen entirely in the
// webview (./webview/EntryPointFlowApp.tsx).
import * as vscode from 'vscode';
import { buildDiagramModel } from '../core/diagramModel';
import { diagramModelToMermaidFlowchart, toMermaidMarkdown } from '../core/diagramMermaid';
import { EntryPointFlow } from '../core/entryPointFlow';
import { ProjectGraphStore } from '../core/store';
import { ExportDestination, pickExportDestination, writeMarkdownExport, writePdfExportFromJpeg, writePngExport, writeSvgExport } from './diagramExport';
import { buildEntryPointFlowViewData } from './entryPointFlow';
import { visibleEntryPointFlow } from './entryPointFlowExpansion';
import { EntryPointFlowHostToWebviewMessage, EntryPointFlowPayload, EntryPointFlowWebviewToHostMessage } from './webview/entryPointFlowProtocol';

const VIEW_TYPE = 'agentGraph.entryPointFlowView';
const VIEW_TITLE = 'Entry Point Flow';

const WEBVIEW_SCRIPT_PATH = ['dist', 'ui', 'webview', 'main.js'];
const WEBVIEW_STYLE_PATH = ['dist', 'ui', 'webview', 'main.css'];

export class EntryPointFlowPanel implements vscode.Disposable {
	private static current: EntryPointFlowPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	/** The save destination/format for an in-flight `entryPointFlow:exportRequest`, awaiting the webview's `entryPointFlow:exportCaptured` reply. */
	private pendingExport: ExportDestination | undefined;

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly extensionUri: vscode.Uri,
		private store: ProjectGraphStore,
		private selectedEntryPointId: string
	) {
		this.panel.webview.html = this.renderHtml();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(message: EntryPointFlowWebviewToHostMessage) => this.handleMessage(message),
			null,
			this.disposables
		);
	}

	/**
	 * Opens the flow view for `entryPointId`, or reveals and refreshes the
	 * existing one (switched to `entryPointId`) if one is already open. Takes
	 * ownership of `store` (closes it on dispose/replacement), like
	 * `GraphPanel.createOrShow`.
	 */
	static createOrShow(extensionUri: vscode.Uri, store: ProjectGraphStore, entryPointId: string): EntryPointFlowPanel {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (EntryPointFlowPanel.current) {
			EntryPointFlowPanel.current.panel.reveal(column);
			EntryPointFlowPanel.current.replaceStore(store, entryPointId);
			return EntryPointFlowPanel.current;
		}

		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, VIEW_TITLE, column ?? vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'ui', 'webview')]
		});

		EntryPointFlowPanel.current = new EntryPointFlowPanel(panel, extensionUri, store, entryPointId);
		return EntryPointFlowPanel.current;
	}

	get webview(): vscode.Webview {
		return this.panel.webview;
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		EntryPointFlowPanel.current = undefined;
		this.store.close();
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.panel.dispose();
	}

	private replaceStore(store: ProjectGraphStore, entryPointId: string): void {
		if (store !== this.store) {
			this.store.close();
		}
		this.store = store;
		this.selectedEntryPointId = entryPointId;
		void this.postFlow();
	}

	private handleMessage(message: EntryPointFlowWebviewToHostMessage): void {
		if (message?.type === 'entryPointFlow:ready') {
			void this.postFlow();
		} else if (message?.type === 'entryPointFlow:selectEntryPoint') {
			this.selectedEntryPointId = message.nodeId;
			void this.postFlow();
		} else if (message?.type === 'entryPointFlow:openNode') {
			void this.openNode(message.nodeId);
		} else if (message?.type === 'entryPointFlow:exportRequest') {
			void this.handleExportRequest(message.expandedNodeIds);
		} else if (message?.type === 'entryPointFlow:exportCaptured') {
			void this.handleExportCaptured(message.format, message.payload, message.width, message.height);
		} else if (message?.type === 'entryPointFlow:exportCaptureFailed') {
			this.pendingExport = undefined;
			void vscode.window.showErrorMessage('Project Graph: exporting the current view failed.');
		}
	}

	private async postFlow(): Promise<void> {
		const graph = this.store.getGraph();
		const data = buildEntryPointFlowViewData(this.store, graph, this.selectedEntryPointId);

		const message: EntryPointFlowHostToWebviewMessage = data
			? { type: 'entryPointFlow:update', entryPoints: data.entryPoints, selectedEntryPointId: data.selectedEntryPointId, flow: serializeFlow(data.flow) }
			: { type: 'entryPointFlow:empty', entryPoints: [] };
		void this.panel.webview.postMessage(message);
	}

	private async openNode(nodeId: string): Promise<void> {
		const node = this.store.getNode(nodeId);
		if (!node?.filePath) {
			return;
		}
		const document = await vscode.workspace.openTextDocument(node.filePath);
		const selection = node.range
			? new vscode.Range(node.range.startLine - 1, node.range.startColumn - 1, node.range.endLine - 1, node.range.endColumn - 1)
			: undefined;
		await vscode.window.showTextDocument(document, { preview: true, selection });
	}

	private async handleExportRequest(expandedNodeIds: readonly string[]): Promise<void> {
		const destination = await pickExportDestination('entry-point-flow');
		if (!destination) {
			return;
		}

		if (destination.format === 'markdown') {
			const markdown = this.buildExportMarkdown(expandedNodeIds);
			if (markdown) {
				await writeMarkdownExport(destination.uri, markdown);
			}
			return;
		}

		this.pendingExport = destination;
		const message: EntryPointFlowHostToWebviewMessage = { type: 'entryPointFlow:exportCapture', format: destination.format };
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

	private buildExportMarkdown(expandedNodeIds: readonly string[]): string | undefined {
		const graph = this.store.getGraph();
		const data = buildEntryPointFlowViewData(this.store, graph, this.selectedEntryPointId);
		if (!data) {
			return undefined;
		}

		const visible = visibleEntryPointFlow(data.flow, new Set(expandedNodeIds));
		const visibleGraph = {
			nodes: data.flow.nodes.filter((node) => visible.nodeIds.has(node.id)),
			edges: data.flow.edges.filter((edge) => visible.edgeIds.has(edge.id))
		};
		const { model } = buildDiagramModel(visibleGraph);
		const entryPointName = data.flow.nodes.find((node) => node.id === data.flow.entryPointId)?.name ?? data.flow.entryPointId;
		return toMermaidMarkdown(`Entry Point Flow — ${entryPointName}`, diagramModelToMermaidFlowchart(model));
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
	<div id="root" data-view="entryPointFlow"></div>
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

function serializeFlow(flow: EntryPointFlow): EntryPointFlowPayload {
	return {
		entryPointId: flow.entryPointId,
		nodes: flow.nodes,
		edges: flow.edges,
		depthById: Object.fromEntries(flow.depthById),
		truncatedNodeIds: [...flow.truncatedNodeIds]
	};
}
