import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { analyzeWorkspace } from '../../ui/analyzeWorkspace';
import { ProjectGraphStore } from '../../core/store';
import { ActiveFileFlowPanel } from '../../ui/activeFileFlowPanel';
import { ActiveFileFlowHostToWebviewMessage } from '../../ui/webview/activeFileFlowProtocol';

function extensionUri(): vscode.Uri {
	const extension = vscode.extensions.getExtension('atlas.atlas');
	assert.ok(extension, 'atlas extension must be present');
	return extension.extensionUri;
}

async function waitForMessage(
	messages: ActiveFileFlowHostToWebviewMessage[],
	predicate: (message: ActiveFileFlowHostToWebviewMessage) => boolean,
	timeoutMs = 8000
): Promise<ActiveFileFlowHostToWebviewMessage> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = messages.find(predicate);
		if (found) {
			return found;
		}
		if (Date.now() >= deadline) {
			throw new Error(`timed out waiting for message; saw: ${JSON.stringify(messages.map((m) => m.type))}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

suite('ActiveFileFlowPanel (real webview round trip)', () => {
	test('posts a flow with real ancestors/descendants once the actual webview reports ready', async function () {
		this.timeout(20000);

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-activefileflow-'));
		const dbPath = path.join(tmpDir, 'project-graph.db');
		const mathPath = path.join(tmpDir, 'math.ts');
		const indexPath = path.join(tmpDir, 'index.ts');
		fs.writeFileSync(mathPath, 'export function add(a: number, b: number): number { return a + b; }\n');
		fs.writeFileSync(indexPath, "import { add } from './math';\nconsole.log(add(1, 2));\n");

		try {
			await analyzeWorkspace({ rootDir: tmpDir, dbPath });

			const store = await ProjectGraphStore.open({ filePath: dbPath });
			const panel = ActiveFileFlowPanel.createOrShow(extensionUri(), store, mathPath);
			try {
				const messages: ActiveFileFlowHostToWebviewMessage[] = [];
				const realPostMessage = panel.webview.postMessage.bind(panel.webview);
				(panel.webview as unknown as { postMessage: typeof panel.webview.postMessage }).postMessage = (message) => {
					messages.push(message as ActiveFileFlowHostToWebviewMessage);
					return realPostMessage(message);
				};

				const update = (await waitForMessage(messages, (m) => m.type === 'activeFileFlow:update')) as Extract<
					ActiveFileFlowHostToWebviewMessage,
					{ type: 'activeFileFlow:update' }
				>;

				const normalize = (filePath: string): string => path.resolve(filePath);
				assert.deepStrictEqual(
					update.flow.nodes.map((n) => normalize(n.filePath as string)).sort(),
					[indexPath, mathPath].map(normalize).sort()
				);
				assert.ok(update.flow.highlightedIds.includes(update.flow.activeFileId));
			} finally {
				panel.dispose();
			}
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test('traces a multi-hop ancestor chain (grandparent -> parent -> active file) plus the active file\'s own child import', async function () {
		this.timeout(20000);

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-activefileflow-chain-'));
		const dbPath = path.join(tmpDir, 'project-graph.db');
		const schemaPath = path.join(tmpDir, 'schema.ts');
		const mailerPath = path.join(tmpDir, 'mailer.ts');
		const sendRoutePath = path.join(tmpDir, 'send.route.ts');
		const mainPath = path.join(tmpDir, 'main.ts');
		fs.writeFileSync(schemaPath, 'export interface MailSchema { to: string; }\n');
		fs.writeFileSync(mailerPath, "import { MailSchema } from './schema';\nexport function sendMail(m: MailSchema): void {}\n");
		fs.writeFileSync(sendRoutePath, "import { sendMail } from './mailer';\nexport function handle(): void { sendMail({ to: 'a' }); }\n");
		fs.writeFileSync(mainPath, "import { handle } from './send.route';\nhandle();\n");

		try {
			await analyzeWorkspace({ rootDir: tmpDir, dbPath });

			const store = await ProjectGraphStore.open({ filePath: dbPath });
			const panel = ActiveFileFlowPanel.createOrShow(extensionUri(), store, mailerPath);
			try {
				const messages: ActiveFileFlowHostToWebviewMessage[] = [];
				const realPostMessage = panel.webview.postMessage.bind(panel.webview);
				(panel.webview as unknown as { postMessage: typeof panel.webview.postMessage }).postMessage = (message) => {
					messages.push(message as ActiveFileFlowHostToWebviewMessage);
					return realPostMessage(message);
				};

				const update = (await waitForMessage(messages, (m) => m.type === 'activeFileFlow:update')) as Extract<
					ActiveFileFlowHostToWebviewMessage,
					{ type: 'activeFileFlow:update' }
				>;

				const normalize = (filePath: string): string => path.resolve(filePath);
				assert.deepStrictEqual(
					update.flow.nodes.map((n) => normalize(n.filePath as string)).sort(),
					[schemaPath, mailerPath, sendRoutePath, mainPath].map(normalize).sort()
				);

				const byPath = new Map(update.flow.nodes.map((n) => [normalize(n.filePath as string), n.id]));
				const highlighted = new Set(update.flow.highlightedIds);
				assert.ok(highlighted.has(byPath.get(normalize(mainPath))!), 'grandparent should be highlighted');
				assert.ok(highlighted.has(byPath.get(normalize(sendRoutePath))!), 'parent should be highlighted');
				assert.ok(highlighted.has(byPath.get(normalize(mailerPath))!), 'active file should be highlighted');
				assert.ok(!highlighted.has(byPath.get(normalize(schemaPath))!), 'child import should be shown but not highlighted');
			} finally {
				panel.dispose();
			}
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
