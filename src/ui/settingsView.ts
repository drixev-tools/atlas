// Webview View registered alongside the Tree View sidebar (./sidebarView) in
// the same Activity Bar container, for managing the Anthropic API key and
// which Claude model to use via `ClaudeSettingsStore` (../design/settings).
// This view only ever reads/writes through that store, never SecretStorage
// directly.
import * as vscode from 'vscode';
import { CLAUDE_MODEL_OPTIONS, ClaudeSettingsStore } from '../design/settings';

export const SETTINGS_VIEW_ID = 'agentGraph.settings';
export const FOCUS_SETTINGS_VIEW_COMMAND = `${SETTINGS_VIEW_ID}.focus`;

type WebviewToExtensionMessage =
	| { type: 'ready' }
	| { type: 'saveApiKey'; apiKey: string }
	| { type: 'clearApiKey' }
	| { type: 'setModel'; model: string };

interface SettingsState {
	type: 'state';
	hasApiKey: boolean;
	model: string;
	models: readonly { id: string; label: string }[];
}

/**
 * Backs the `agentGraph.settings` Webview View. Holds the last-resolved
 * `vscode.WebviewView` only to push state to it (`postState`); all reads and
 * writes go through `settings` (`ClaudeSettingsStore`), so this class owns no
 * storage of its own.
 */
export class SettingsViewProvider implements vscode.WebviewViewProvider {
	private view: vscode.WebviewView | undefined;

	constructor(private readonly settings: ClaudeSettingsStore) {}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = renderHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => void this.handleMessage(message));
		void this.postState();
	}

	private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
				await this.postState();
				return;
			case 'saveApiKey': {
				const apiKey = message.apiKey.trim();
				if (!apiKey) {
					return;
				}
				await this.settings.setApiKey(apiKey);
				await this.postState();
				void vscode.window.showInformationMessage('Project Graph: Anthropic API key saved.');
				return;
			}
			case 'clearApiKey':
				await this.settings.clearApiKey();
				await this.postState();
				return;
			case 'setModel':
				await this.settings.setModel(message.model);
				await this.postState();
				return;
		}
	}

	private async postState(): Promise<void> {
		if (!this.view) {
			return;
		}
		const state: SettingsState = {
			type: 'state',
			hasApiKey: Boolean(await this.settings.getApiKey()),
			model: this.settings.getModel(),
			models: CLAUDE_MODEL_OPTIONS
		};
		void this.view.webview.postMessage(state);
	}
}

export function registerSettingsView(context: vscode.ExtensionContext, settings: ClaudeSettingsStore): SettingsViewProvider {
	const provider = new SettingsViewProvider(settings);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(SETTINGS_VIEW_ID, provider));
	return provider;
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
	<style>
		body {
			font-family: var(--vscode-font-family);
			color: var(--vscode-foreground);
			padding: 0 8px 8px;
		}
		h3 {
			font-size: 11px;
			text-transform: uppercase;
			opacity: 0.8;
			margin: 16px 0 4px;
		}
		p.description {
			font-size: 12px;
			opacity: 0.8;
			margin: 0 0 8px;
		}
		input, select, button {
			width: 100%;
			box-sizing: border-box;
			font-family: inherit;
			font-size: 12px;
			padding: 4px;
			margin-bottom: 6px;
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border, transparent);
		}
		button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			cursor: pointer;
		}
		button:hover {
			background: var(--vscode-button-hoverBackground);
		}
		button.secondary {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
		}
		#apiKeyStatus {
			font-size: 12px;
			margin-bottom: 6px;
		}
	</style>
</head>
<body>
	<h3>Anthropic API Key</h3>
	<p class="description">Stored securely via VS Code SecretStorage, never in a workspace file.</p>
	<div id="apiKeyStatus">Checking...</div>
	<input id="apiKeyInput" type="password" placeholder="sk-ant-..." autocomplete="off" />
	<button id="saveApiKeyButton">Save API Key</button>
	<button id="clearApiKeyButton" class="secondary">Clear API Key</button>

	<h3>Claude Model</h3>
	<p class="description">Used by AI-powered features (Sequence Diagram, Identified Architecture).</p>
	<select id="modelSelect"></select>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		const apiKeyStatus = document.getElementById('apiKeyStatus');
		const apiKeyInput = document.getElementById('apiKeyInput');
		const saveApiKeyButton = document.getElementById('saveApiKeyButton');
		const clearApiKeyButton = document.getElementById('clearApiKeyButton');
		const modelSelect = document.getElementById('modelSelect');

		saveApiKeyButton.addEventListener('click', () => {
			const apiKey = apiKeyInput.value.trim();
			if (!apiKey) {
				return;
			}
			vscode.postMessage({ type: 'saveApiKey', apiKey });
			apiKeyInput.value = '';
		});

		clearApiKeyButton.addEventListener('click', () => {
			vscode.postMessage({ type: 'clearApiKey' });
		});

		modelSelect.addEventListener('change', () => {
			vscode.postMessage({ type: 'setModel', model: modelSelect.value });
		});

		window.addEventListener('message', (event) => {
			const message = event.data;
			if (message.type !== 'state') {
				return;
			}
			apiKeyStatus.textContent = message.hasApiKey ? 'API key configured.' : 'No API key configured yet.';
			clearApiKeyButton.style.display = message.hasApiKey ? 'block' : 'none';

			modelSelect.innerHTML = '';
			for (const option of message.models) {
				const optionElement = document.createElement('option');
				optionElement.value = option.id;
				optionElement.textContent = option.label;
				optionElement.selected = option.id === message.model;
				modelSelect.appendChild(optionElement);
			}
		});

		vscode.postMessage({ type: 'ready' });
	</script>
</body>
</html>`;
}
