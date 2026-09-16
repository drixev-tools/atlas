import * as assert from 'assert';
import * as vscode from 'vscode';
import { SequenceDiagramPanel } from '../../ui/sequenceDiagramView';
import { SequenceDiagramViewState } from '../../ui/sequenceDiagram';

function sampleState(overrides: Partial<SequenceDiagramViewState> = {}): SequenceDiagramViewState {
	return {
		status: 'ready',
		targetName: 'add',
		targetKind: 'function',
		filePath: '/repo/math.ts',
		summary: 'add is called by app.ts.',
		steps: [{ from: 'app.ts', to: 'add', action: 'calls' }],
		...overrides
	};
}

/** Same async-tab-lag workaround as impactView.test.ts's `findTabByLabel`. */
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

suite('SequenceDiagramPanel', () => {
	teardown(async () => {
		for (const tab of vscode.window.tabGroups.all.flatMap((group) => group.tabs)) {
			if (tab.label.startsWith('Sequence: ')) {
				await vscode.window.tabGroups.close(tab);
			}
		}
	});

	test('opens a "Sequence: <target>" tab with a CSP nonce matching its inline script', async () => {
		const panel = SequenceDiagramPanel.createOrShow(sampleState());
		try {
			const html = panel.webview.html;
			const nonceMatch = html.match(/nonce="([A-Za-z0-9]{32})"/);
			assert.ok(nonceMatch, 'expected a 32-char nonce in the rendered HTML');
			const [, nonce] = nonceMatch;
			assert.ok(html.includes(`script-src 'nonce-${nonce}'`), 'CSP must allow the exact nonce used by the script tag');

			const tab = await findTabByLabel('Sequence: add');
			assert.ok(tab, 'expected an open tab titled "Sequence: add"');
		} finally {
			panel.dispose();
		}
	});

	test('reopening for a different node reveals and refreshes the same panel, retitled, instead of creating a second one', async () => {
		const panel = SequenceDiagramPanel.createOrShow(sampleState());
		try {
			await findTabByLabel('Sequence: add');

			const again = SequenceDiagramPanel.createOrShow(sampleState({ targetName: 'subtract' }));
			assert.strictEqual(again, panel);

			await findTabByLabel('Sequence: subtract');
			const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((t) => t.label.startsWith('Sequence: '));
			assert.strictEqual(tabs.length, 1, 'expected only one Sequence Diagram tab even after reopening for another node');
		} finally {
			panel.dispose();
		}
	});
});
