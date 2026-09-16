import * as assert from 'assert';
import * as vscode from 'vscode';
import { ImpactPanel } from '../../ui/impactView';
import { ImpactViewState } from '../../ui/impact';

function sampleState(overrides: Partial<ImpactViewState> = {}): ImpactViewState {
	return {
		source: 'git',
		targets: ['/repo/math.ts'],
		impactedFiles: ['/repo/app.ts'],
		relatedTests: ['/repo/math.test.ts'],
		explanation: 'Changing math.ts affects app.ts.',
		aiGenerated: true,
		...overrides
	};
}

/**
 * `vscode.window.tabGroups` mirrors the renderer's tab layout over an async
 * IPC round-trip, so it can briefly lag behind a webview panel that was just
 * created in this same tick — same tradeoff `graphPanel.test.ts` works around.
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

suite('ImpactPanel', () => {
	teardown(async () => {
		for (const tab of vscode.window.tabGroups.all.flatMap((group) => group.tabs)) {
			if (tab.label === 'Project Graph: Impact') {
				await vscode.window.tabGroups.close(tab);
			}
		}
	});

	test('opens a "Project Graph: Impact" tab with a CSP nonce matching its inline script', async () => {
		const panel = ImpactPanel.createOrShow(sampleState());
		try {
			const html = panel.webview.html;
			const nonceMatch = html.match(/nonce="([A-Za-z0-9]{32})"/);
			assert.ok(nonceMatch, 'expected a 32-char nonce in the rendered HTML');
			const [, nonce] = nonceMatch;
			assert.ok(html.includes(`script-src 'nonce-${nonce}'`), 'CSP must allow the exact nonce used by the script tag');

			const tab = await findTabByLabel('Project Graph: Impact');
			assert.ok(tab, 'expected an open tab titled "Project Graph: Impact"');
		} finally {
			panel.dispose();
		}
	});

	test('reopening while already open reveals and refreshes the same panel instead of creating a second one', async () => {
		const panel = ImpactPanel.createOrShow(sampleState());
		try {
			await findTabByLabel('Project Graph: Impact');

			const again = ImpactPanel.createOrShow(sampleState({ aiGenerated: false }));
			assert.strictEqual(again, panel);

			await findTabByLabel('Project Graph: Impact');
			const tabs = vscode.window.tabGroups.all
				.flatMap((group) => group.tabs)
				.filter((t) => t.label === 'Project Graph: Impact');
			assert.strictEqual(tabs.length, 1, 'expected only one "Project Graph: Impact" tab even after reopening');
		} finally {
			panel.dispose();
		}
	});
});
