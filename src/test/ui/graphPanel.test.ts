import * as assert from 'assert';
import * as vscode from 'vscode';
import { OPEN_GRAPH_VIEW_COMMAND } from '../../extension';
import { ProjectGraphStore } from '../../core/store';
import { GraphPanel } from '../../ui/graphPanel';

function extensionUri(): vscode.Uri {
	const extension = vscode.extensions.getExtension('agent-graph.agent-graph');
	assert.ok(extension, 'agent-graph extension must be present');
	return extension.extensionUri;
}

suite('GraphPanel', () => {
	test('renders a webview wired to the bundled script with a matching CSP nonce', async () => {
		const store = await ProjectGraphStore.open();
		const panel = GraphPanel.createOrShow(extensionUri(), store);
		try {
			const html = panel.webview.html;
			assert.match(html, /<div id="cy"><\/div>/);

			const nonceMatch = html.match(/nonce="([A-Za-z0-9]{32})"/);
			assert.ok(nonceMatch, 'expected a 32-char nonce in the rendered HTML');
			const [, nonce] = nonceMatch;

			assert.ok(
				html.includes(`script-src 'nonce-${nonce}'`),
				'CSP must allow the exact nonce used by the script tag'
			);
			assert.match(html, new RegExp(`<script nonce="${nonce}" src="[^"]+main\\.js">`));
		} finally {
			panel.dispose();
		}
	});

	test('the open-graph-view command opens a "Project Graph" tab without throwing', async () => {
		await assert.doesNotReject(Promise.resolve(vscode.commands.executeCommand(OPEN_GRAPH_VIEW_COMMAND)));

		const tab = vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((t) => t.label === 'Project Graph');
		assert.ok(tab, 'expected an open tab titled "Project Graph"');

		await vscode.window.tabGroups.close(tab);
	});
});
