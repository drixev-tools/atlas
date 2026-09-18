// The sequence diagram view's panel lifecycle and postMessage bridge
// (contract in ./webview/sequenceDiagramProtocol) — mirrors
// ./activeFileFlowPanel's singleton create-or-reveal shape, loading the same
// bundled React Flow script (./webview/main.tsx picks the root component via
// `data-view`). Unlike that panel, this one owns no `AtlasStore`: the
// whole diagram is precomputed once per "Show Sequence Diagram" invocation
// (../sequenceDiagram's view state), so opening a lifeline's file only needs
// the `filePath`/`range` already carried on that state.
import * as vscode from 'vscode';
import { MermaidSequenceLifeline, MermaidSequenceStep, sequenceToMermaidDiagram, toMermaidMarkdown } from '../core/diagramMermaid';
import { ExportDestination, pickExportDestination, writeMarkdownExport, writePdfExportFromJpeg, writePngExport, writeSvgExport } from './diagramExport';
import { SequenceDiagramViewState } from './sequenceDiagram';
import { FOCUS_SETTINGS_VIEW_COMMAND } from './settingsView';
import { SequenceDiagramWebviewToHostMessage } from './webview/sequenceDiagramProtocol';

const VIEW_TYPE = 'atlas.sequenceDiagramView';
const WEBVIEW_SCRIPT_PATH = ['dist', 'ui', 'webview', 'main.js'];
const WEBVIEW_STYLE_PATH = ['dist', 'ui', 'webview', 'main.css'];

export class SequenceDiagramPanel implements vscode.Disposable {
	private static current: SequenceDiagramPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	/** The save destination/format for an in-flight `sequenceDiagram:exportRequest`, awaiting the webview's `sequenceDiagram:exportCaptured` reply. */
	private pendingExport: ExportDestination | undefined;

	private constructor(private readonly panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri, private state: SequenceDiagramViewState) {
		this.panel.webview.html = this.renderHtml();
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(message: SequenceDiagramWebviewToHostMessage) => this.handleMessage(message),
			null,
			this.disposables
		);
	}

	/** Opens the sequence diagram view for `state`, or reveals and refreshes the existing one if it's already open. */
	static createOrShow(extensionUri: vscode.Uri, state: SequenceDiagramViewState): SequenceDiagramPanel {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (SequenceDiagramPanel.current) {
			SequenceDiagramPanel.current.panel.reveal(column);
			SequenceDiagramPanel.current.update(state);
			return SequenceDiagramPanel.current;
		}

		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, viewTitle(state), column ?? vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'ui', 'webview')]
		});

		SequenceDiagramPanel.current = new SequenceDiagramPanel(panel, extensionUri, state);
		return SequenceDiagramPanel.current;
	}

	get webview(): vscode.Webview {
		return this.panel.webview;
	}

	update(state: SequenceDiagramViewState): void {
		this.state = state;
		this.panel.title = viewTitle(state);
		this.postState();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		SequenceDiagramPanel.current = undefined;
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.panel.dispose();
	}

	private handleMessage(message: SequenceDiagramWebviewToHostMessage): void {
		switch (message?.type) {
			case 'sequenceDiagram:ready':
				this.postState();
				return;
			case 'sequenceDiagram:openAiSettings':
				void vscode.commands.executeCommand(FOCUS_SETTINGS_VIEW_COMMAND);
				return;
			case 'sequenceDiagram:openLifeline':
				void this.openLifeline(message.lifelineId);
				return;
			case 'sequenceDiagram:exportRequest':
				void this.handleExportRequest();
				return;
			case 'sequenceDiagram:exportCaptured':
				void this.handleExportCaptured(message.format, message.payload, message.width, message.height);
				return;
			case 'sequenceDiagram:exportCaptureFailed':
				this.pendingExport = undefined;
				void vscode.window.showErrorMessage('Atlas: exporting the current view failed.');
				return;
		}
	}

	private async openLifeline(lifelineId: string): Promise<void> {
		const lifeline = this.state.lifelines.find((candidate) => candidate.id === lifelineId);
		if (!lifeline?.filePath) {
			return;
		}
		const document = await vscode.workspace.openTextDocument(lifeline.filePath);
		const selection = lifeline.range
			? new vscode.Range(lifeline.range.startLine - 1, lifeline.range.startColumn - 1, lifeline.range.endLine - 1, lifeline.range.endColumn - 1)
			: undefined;
		await vscode.window.showTextDocument(document, { preview: true, selection });
	}

	private async handleExportRequest(): Promise<void> {
		const destination = await pickExportDestination(`sequence-${this.state.targetName}`);
		if (!destination) {
			return;
		}

		if (destination.format === 'markdown') {
			await writeMarkdownExport(destination.uri, this.buildExportMarkdown());
			return;
		}

		this.pendingExport = destination;
		void this.panel.webview.postMessage({ type: 'sequenceDiagram:exportCapture', format: destination.format });
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

	private buildExportMarkdown(): string {
		const lifelines: MermaidSequenceLifeline[] = this.state.lifelines.map((lifeline) => ({ id: lifeline.id, label: lifeline.label }));
		const participantsById = new Map(this.state.participants.map((participant) => [participant.id, participant] as const));
		const steps: MermaidSequenceStep[] = this.state.steps.map((step) => ({
			order: step.order,
			fromLifelineId: participantsById.get(step.fromParticipantId)?.lifelineId ?? step.fromParticipantId,
			toLifelineId: participantsById.get(step.toParticipantId)?.lifelineId ?? step.toParticipantId,
			label: step.label
		}));
		return toMermaidMarkdown(`Sequence — ${this.state.targetName}`, sequenceToMermaidDiagram(lifelines, steps));
	}

	private postState(): void {
		void this.panel.webview.postMessage({ type: 'sequenceDiagram:state', ...this.state });
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
	<title>${viewTitle(this.state)}</title>
</head>
<body>
	<div id="root" data-view="sequenceDiagram"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function viewTitle(state: SequenceDiagramViewState): string {
	return `Sequence: ${state.targetName}`;
}

function getNonce(): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return nonce;
}
