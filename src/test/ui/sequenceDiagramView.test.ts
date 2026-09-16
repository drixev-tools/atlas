import * as assert from 'assert';
import * as vscode from 'vscode';
import { SequenceDiagramPanel } from '../../ui/sequenceDiagramView';
import { SequenceDiagramViewState } from '../../ui/sequenceDiagram';

const EXTENSION_URI = vscode.Uri.file(__dirname);

function sampleState(overrides: Partial<SequenceDiagramViewState> = {}): SequenceDiagramViewState {
	return {
		targetId: 'fn:add',
		targetName: 'add',
		targetKind: 'function',
		targetLifelineId: 'file:/repo/math.ts',
		filePath: '/repo/math.ts',
		summary: 'add is called by run.',
		aiGenerated: false,
		truncated: false,
		lifelines: [
			{ id: 'file:/repo/math.ts', label: 'math.ts', kind: 'file', filePath: '/repo/math.ts' },
			{ id: 'file:/repo/app.ts', label: 'app.ts', kind: 'file', filePath: '/repo/app.ts' }
		],
		participants: [
			{ id: 'fn:add', name: 'add', kind: 'function', filePath: '/repo/math.ts', lifelineId: 'file:/repo/math.ts' },
			{ id: 'fn:run', name: 'run', kind: 'function', filePath: '/repo/app.ts', lifelineId: 'file:/repo/app.ts' }
		],
		steps: [{ id: 'calls:run:add', order: 0, fromParticipantId: 'fn:run', toParticipantId: 'fn:add', label: 'calls add' }],
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

	test('opens a "Sequence: <target>" tab with a CSP nonce matching its inline script, rendering the React Flow webview root', async () => {
		const panel = SequenceDiagramPanel.createOrShow(EXTENSION_URI, sampleState());
		try {
			const html = panel.webview.html;
			const nonceMatch = html.match(/nonce="([A-Za-z0-9]{32})"/);
			assert.ok(nonceMatch, 'expected a 32-char nonce in the rendered HTML');
			const [, nonce] = nonceMatch;
			assert.ok(html.includes(`script-src 'nonce-${nonce}'`), 'CSP must allow the exact nonce used by the script tag');
			assert.ok(html.includes('data-view="sequenceDiagram"'), 'expected the webview root to select the sequence diagram React app');

			const tab = await findTabByLabel('Sequence: add');
			assert.ok(tab, 'expected an open tab titled "Sequence: add"');
		} finally {
			panel.dispose();
		}
	});

	test('reopening for a different node reveals and refreshes the same panel, retitled, instead of creating a second one', async () => {
		const panel = SequenceDiagramPanel.createOrShow(EXTENSION_URI, sampleState());
		try {
			await findTabByLabel('Sequence: add');

			const again = SequenceDiagramPanel.createOrShow(EXTENSION_URI, sampleState({ targetName: 'subtract' }));
			assert.strictEqual(again, panel);

			await findTabByLabel('Sequence: subtract');
			const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((t) => t.label.startsWith('Sequence: '));
			assert.strictEqual(tabs.length, 1, 'expected only one Sequence Diagram tab even after reopening for another node');
		} finally {
			panel.dispose();
		}
	});
});
