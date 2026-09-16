// A Webview Panel showing a concise Claude-generated explanation of the
// structural impact ./impact already computes (falling back to
// `buildFallbackExplanation`'s non-AI summary when no Anthropic API key is
// configured, see ../design/settings) plus a simple diagram of
// changed/impacted files and related tests. Mirrors ./graphPanel's singleton
// create-or-reveal lifecycle, but keeps its own plain-HTML webview like
// ./settingsView instead of the React Flow bundle — there is no graph
// layout here, just three lists.
import * as vscode from 'vscode';
import { ImpactViewState } from './impact';
import { FOCUS_SETTINGS_VIEW_COMMAND } from './settingsView';

const VIEW_TYPE = 'agentGraph.impactView';
const VIEW_TITLE = 'Project Graph: Impact';

type WebviewToHostMessage = { type: 'ready' } | { type: 'openAiSettings' } | { type: 'openFile'; filePath: string };

/**
 * Single Webview Panel for the workspace's most recent "Calculate Impact"
 * result. Re-running the command updates the existing panel (`update`)
 * instead of opening a second one, like `GraphPanel.createOrShow`.
 */
export class ImpactPanel implements vscode.Disposable {
	private static current: ImpactPanel | undefined;

	private readonly disposables: vscode.Disposable[] = [];
	private disposed = false;

	private constructor(private readonly panel: vscode.WebviewPanel, private state: ImpactViewState) {
		this.panel.webview.html = renderHtml(this.panel.webview);
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage(
			(message: WebviewToHostMessage) => this.handleMessage(message),
			null,
			this.disposables
		);
	}

	/** Opens the impact view, or reveals and refreshes the existing one if it's already open. */
	static createOrShow(state: ImpactViewState): ImpactPanel {
		const column = vscode.window.activeTextEditor?.viewColumn;

		if (ImpactPanel.current) {
			ImpactPanel.current.panel.reveal(column);
			ImpactPanel.current.update(state);
			return ImpactPanel.current;
		}

		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, VIEW_TITLE, column ?? vscode.ViewColumn.Beside, {
			enableScripts: true,
			retainContextWhenHidden: true
		});

		ImpactPanel.current = new ImpactPanel(panel, state);
		return ImpactPanel.current;
	}

	get webview(): vscode.Webview {
		return this.panel.webview;
	}

	update(state: ImpactViewState): void {
		this.state = state;
		this.postState();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		ImpactPanel.current = undefined;
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
		this.panel.dispose();
	}

	private handleMessage(message: WebviewToHostMessage): void {
		switch (message?.type) {
			case 'ready':
				this.postState();
				return;
			case 'openAiSettings':
				void vscode.commands.executeCommand(FOCUS_SETTINGS_VIEW_COMMAND);
				return;
			case 'openFile':
				void vscode.workspace.openTextDocument(message.filePath).then((document) => vscode.window.showTextDocument(document));
				return;
		}
	}

	private postState(): void {
		void this.panel.webview.postMessage({ type: 'state', ...this.state });
	}
}

function getNonce(): string {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let i = 0; i < 32; i++) {
		nonce += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return nonce;
}

function renderHtml(webview: vscode.Webview): string {
	const nonce = getNonce();
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<title>${VIEW_TITLE}</title>
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			padding: 16px 20px;
		}
		h2 {
			margin-top: 0;
		}
		#summary {
			opacity: 0.85;
			margin-bottom: 12px;
		}
		#aiBadge {
			display: inline-block;
			font-size: 11px;
			text-transform: uppercase;
			padding: 2px 6px;
			border-radius: 3px;
			margin-bottom: 12px;
			background: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
		}
		#fallbackNotice {
			font-size: 12px;
			margin: 0 0 12px;
		}
		#fallbackNotice button {
			font: inherit;
			color: var(--vscode-textLink-foreground);
			background: none;
			border: none;
			padding: 0;
			cursor: pointer;
			text-decoration: underline;
		}
		#explanation {
			white-space: pre-wrap;
			line-height: 1.5;
			margin-bottom: 24px;
		}
		#diagram {
			display: flex;
			align-items: flex-start;
			gap: 8px;
			flex-wrap: wrap;
		}
		.diagram-column {
			flex: 1;
			min-width: 180px;
		}
		.diagram-column h3 {
			font-size: 11px;
			text-transform: uppercase;
			opacity: 0.8;
			margin: 0 0 6px;
		}
		.diagram-arrow {
			align-self: center;
			opacity: 0.6;
			font-size: 20px;
			padding: 0 4px;
		}
		.diagram-item {
			display: block;
			width: 100%;
			text-align: left;
			font: inherit;
			font-size: 12px;
			color: var(--vscode-foreground);
			background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
			border: 1px solid var(--vscode-widget-border, transparent);
			border-radius: 3px;
			padding: 4px 6px;
			margin-bottom: 4px;
			cursor: pointer;
			overflow-wrap: anywhere;
		}
		.diagram-item:hover {
			background: var(--vscode-list-hoverBackground);
		}
		.diagram-empty {
			font-size: 12px;
			opacity: 0.6;
		}
	</style>
</head>
<body>
	<h2>Impact</h2>
	<div id="summary">Loading...</div>
	<div id="aiBadge" style="display: none;">AI-generated</div>
	<p id="fallbackNotice" style="display: none;"></p>
	<div id="explanation"></div>
	<div id="diagram"></div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		const summaryEl = document.getElementById('summary');
		const aiBadgeEl = document.getElementById('aiBadge');
		const fallbackNoticeEl = document.getElementById('fallbackNotice');
		const explanationEl = document.getElementById('explanation');
		const diagramEl = document.getElementById('diagram');

		function diagramColumn(title, items) {
			const column = document.createElement('div');
			column.className = 'diagram-column';

			const heading = document.createElement('h3');
			heading.textContent = title;
			column.appendChild(heading);

			if (items.length === 0) {
				const empty = document.createElement('div');
				empty.className = 'diagram-empty';
				empty.textContent = 'None';
				column.appendChild(empty);
				return column;
			}

			for (const filePath of items) {
				const item = document.createElement('button');
				item.className = 'diagram-item';
				item.textContent = filePath;
				item.title = filePath;
				item.addEventListener('click', () => vscode.postMessage({ type: 'openFile', filePath }));
				column.appendChild(item);
			}
			return column;
		}

		function diagramArrow() {
			const arrow = document.createElement('div');
			arrow.className = 'diagram-arrow';
			arrow.textContent = String.fromCharCode(8594);
			return arrow;
		}

		window.addEventListener('message', (event) => {
			const state = event.data;
			if (state.type !== 'state') {
				return;
			}

			if (state.source === 'none') {
				summaryEl.textContent = 'Nothing to calculate impact for.';
			} else {
				const sourceLabel = state.source === 'git' ? 'uncommitted changes' : 'the active file';
				summaryEl.textContent = 'Impact of ' + sourceLabel + ' (' + state.targets.length + ' file(s)) - ' +
					state.impactedFiles.length + ' file(s) affected, ' + state.relatedTests.length + ' related test(s).';
			}

			aiBadgeEl.style.display = state.aiGenerated ? 'inline-block' : 'none';
			if (state.aiGenerated || state.source === 'none') {
				fallbackNoticeEl.style.display = 'none';
			} else {
				fallbackNoticeEl.style.display = 'block';
				fallbackNoticeEl.textContent = '';
				fallbackNoticeEl.appendChild(document.createTextNode('No Anthropic API key configured, showing a non-AI summary. '));
				const link = document.createElement('button');
				link.textContent = 'Open AI Settings';
				link.addEventListener('click', () => vscode.postMessage({ type: 'openAiSettings' }));
				fallbackNoticeEl.appendChild(link);
			}

			explanationEl.textContent = state.explanation;

			diagramEl.innerHTML = '';
			diagramEl.appendChild(diagramColumn('Changed', state.targets));
			diagramEl.appendChild(diagramArrow());
			diagramEl.appendChild(diagramColumn('Impacted', state.impactedFiles));
			diagramEl.appendChild(diagramArrow());
			diagramEl.appendChild(diagramColumn('Related tests', state.relatedTests));
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}
