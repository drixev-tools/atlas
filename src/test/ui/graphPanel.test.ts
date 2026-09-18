import * as assert from 'assert';
import * as vscode from 'vscode';
import { OPEN_ARCHITECTURE_COMMAND } from '../../extension';
import { ProjectGraphStore } from '../../core/store';
import { GraphPanel } from '../../ui/graphPanel';

function extensionUri(): vscode.Uri {
	const extension = vscode.extensions.getExtension('atlas.atlas');
	assert.ok(extension, 'atlas extension must be present');
	return extension.extensionUri;
}

/**
 * `vscode.window.tabGroups` mirrors the renderer's tab layout over an async
 * IPC round-trip, so it can briefly lag behind a webview panel that was just
 * created in this same tick. Polls instead of reading it once immediately.
 */
async function findTabByLabel(label: string, timeoutMs = 2000): Promise<vscode.Tab | undefined> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const tab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((t) => t.label === label);
		if (tab || Date.now() >= deadline) {
			return tab;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

suite('GraphPanel', () => {
	test('renders a webview wired to the bundled React Flow script and stylesheet, with a matching CSP nonce', async () => {
		const store = await ProjectGraphStore.open();
		const panel = GraphPanel.createOrShow(extensionUri(), store);
		try {
			const html = panel.webview.html;
			assert.match(html, /<div id="root"><\/div>/);

			const nonceMatch = html.match(/nonce="([A-Za-z0-9]{32})"/);
			assert.ok(nonceMatch, 'expected a 32-char nonce in the rendered HTML');
			const [, nonce] = nonceMatch;

			assert.ok(
				html.includes(`script-src 'nonce-${nonce}'`),
				'CSP must allow the exact nonce used by the script tag'
			);
			assert.match(html, new RegExp(`<script nonce="${nonce}" src="[^"]+main\\.js">`));
			assert.match(html, /<link rel="stylesheet" href="[^"]+main\.css"/);
		} finally {
			panel.dispose();
		}
	});

	test('the open-architecture command opens a "Project Graph" tab without throwing', async () => {
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(OPEN_ARCHITECTURE_COMMAND)));

		const tab = await findTabByLabel('Project Graph');
		assert.ok(tab, 'expected an open tab titled "Project Graph"');

		await vscode.window.tabGroups.close(tab);
	});

	test('reopening while already open reveals and refreshes the same panel instead of creating a second one', async () => {
		const store = await ProjectGraphStore.open();
		const panel = GraphPanel.createOrShow(extensionUri(), store);
		try {
			const again = GraphPanel.createOrShow(extensionUri(), await ProjectGraphStore.open());
			assert.strictEqual(again, panel);

			const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((t) => t.label === 'Project Graph');
			assert.strictEqual(tabs.length, 1, 'expected only one "Project Graph" tab even after reopening');
		} finally {
			panel.dispose();
		}
	});
});
