import * as assert from 'assert';
import * as vscode from 'vscode';
import { ClaudeSettingsStore } from '../../design/settings';
import { DesignProjectViewProvider } from '../../ui/designProjectView';

function fakeClaudeSettingsStore(initial?: { apiKey?: string }): ClaudeSettingsStore & { apiKey: string | undefined } {
	const state = { apiKey: initial?.apiKey };
	return {
		get apiKey() {
			return state.apiKey;
		},
		async getApiKey() {
			return state.apiKey;
		},
		async setApiKey(apiKey: string) {
			state.apiKey = apiKey;
		},
		async clearApiKey() {
			state.apiKey = undefined;
		},
		getModel() {
			return 'claude-sonnet-5';
		},
		async setModel() {
			/* not exercised by these tests */
		}
	};
}

function fakeWebviewView(): {
	webviewView: vscode.WebviewView;
	postedMessages: unknown[];
	sendFromWebview: (message: unknown) => void;
} {
	let messageHandler: ((message: unknown) => void) | undefined;
	const postedMessages: unknown[] = [];

	const webview = {
		cspSource: 'vscode-webview:',
		options: {},
		html: '',
		onDidReceiveMessage(handler: (message: unknown) => void) {
			messageHandler = handler;
			return { dispose() {} };
		},
		async postMessage(message: unknown) {
			postedMessages.push(message);
			return true;
		}
	};

	const webviewView = { webview } as unknown as vscode.WebviewView;
	return {
		webviewView,
		postedMessages,
		sendFromWebview: (message: unknown) => messageHandler?.(message)
	};
}

function submitMessage(overrides: Partial<{ name: string; stack: string; keyComponents: string; description: string }> = {}) {
	return {
		type: 'submit',
		name: 'Auth Service',
		stack: 'typescript',
		keyComponents: 'loginService, tokenStore',
		description: 'Handles user login.',
		...overrides
	};
}

suite('DesignProjectViewProvider', () => {
	test('rejects a submission missing a name without touching rootDir/settings', async () => {
		let resolveRootDirCalled = false;
		const provider = new DesignProjectViewProvider({
			settings: fakeClaudeSettingsStore({ apiKey: 'sk-ant-existing' }),
			resolveRootDir: () => {
				resolveRootDirCalled = true;
				return '/repo';
			},
			resolveDbPath: () => undefined
		});
		const { webviewView, postedMessages, sendFromWebview } = fakeWebviewView();
		provider.resolveWebviewView(webviewView);

		sendFromWebview(submitMessage({ name: '   ' }));
		await flushMicrotasks();

		assert.strictEqual(resolveRootDirCalled, false);
		assert.deepStrictEqual(postedMessages, [{ type: 'result', ok: false, message: 'A name and a description are required.' }]);
	});

	test('rejects a submission missing a description', async () => {
		const provider = new DesignProjectViewProvider({
			settings: fakeClaudeSettingsStore({ apiKey: 'sk-ant-existing' }),
			resolveRootDir: () => '/repo',
			resolveDbPath: () => undefined
		});
		const { webviewView, postedMessages, sendFromWebview } = fakeWebviewView();
		provider.resolveWebviewView(webviewView);

		sendFromWebview(submitMessage({ description: '  ' }));
		await flushMicrotasks();

		assert.deepStrictEqual(postedMessages, [{ type: 'result', ok: false, message: 'A name and a description are required.' }]);
	});

	test('reports an error when no workspace folder is open', async () => {
		const provider = new DesignProjectViewProvider({
			settings: fakeClaudeSettingsStore({ apiKey: 'sk-ant-existing' }),
			resolveRootDir: () => undefined,
			resolveDbPath: () => undefined
		});
		const { webviewView, postedMessages, sendFromWebview } = fakeWebviewView();
		provider.resolveWebviewView(webviewView);

		sendFromWebview(submitMessage());
		await flushMicrotasks();

		assert.deepStrictEqual(postedMessages, [
			{ type: 'result', ok: false, message: 'Open a folder or workspace before designing a project.' }
		]);
	});

	test('reports an error and does not record usage when no API key is configured', async () => {
		let onSubmitCalled = false;
		const provider = new DesignProjectViewProvider({
			settings: fakeClaudeSettingsStore(),
			resolveRootDir: () => '/repo',
			resolveDbPath: () => undefined,
			onSubmit: () => {
				onSubmitCalled = true;
			}
		});
		const { webviewView, postedMessages, sendFromWebview } = fakeWebviewView();
		provider.resolveWebviewView(webviewView);

		sendFromWebview(submitMessage());
		await flushMicrotasks();

		assert.strictEqual(onSubmitCalled, false);
		assert.deepStrictEqual(postedMessages, [
			{ type: 'result', ok: false, message: 'An Anthropic API key is required to design a project.' }
		]);
	});

	test('ignores messages other than "submit"', async () => {
		const provider = new DesignProjectViewProvider({
			settings: fakeClaudeSettingsStore({ apiKey: 'sk-ant-existing' }),
			resolveRootDir: () => '/repo',
			resolveDbPath: () => undefined
		});
		const { webviewView, postedMessages, sendFromWebview } = fakeWebviewView();
		provider.resolveWebviewView(webviewView);

		sendFromWebview({ type: 'ready' });
		await flushMicrotasks();

		assert.deepStrictEqual(postedMessages, []);
	});
});

function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
