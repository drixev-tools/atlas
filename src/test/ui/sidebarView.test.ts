import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ANALYZE_WORKSPACE_COMMAND, analyzeWorkspace } from '../../ui/analyzeWorkspace';
import { CALCULATE_IMPACT_COMMAND } from '../../ui/impact';
import { OPEN_ARCHITECTURE_COMMAND } from '../../ui/architecture';
import { SHOW_ENTRY_POINT_FLOW_COMMAND } from '../../ui/entryPointFlow';
import { SHOW_IDENTIFIED_ARCHITECTURE_COMMAND } from '../../ui/identifiedArchitecture';
import { StoredNode } from '../../core/store';
import {
	ProjectGraphTreeProvider,
	REFRESH_SIDEBAR_COMMAND,
	SELECT_SIDEBAR_NODE_COMMAND,
	selectProjectGraphNode
} from '../../ui/sidebarView';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('Sidebar Panel', () => {
	test('activation registers the sidebar refresh and select-node commands', async () => {
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes(REFRESH_SIDEBAR_COMMAND));
		assert.ok(commands.includes(SELECT_SIDEBAR_NODE_COMMAND));
	});

	suite('ProjectGraphTreeProvider', () => {
		let tmpDir: string;
		let dbPath: string;

		setup(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-sidebar-'));
			dbPath = path.join(tmpDir, 'project-graph.db');
		});

		teardown(() => {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		});

		test('lists the Analyze/Explore/Impact shortcuts at the root, ahead of the file tree', async () => {
			writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
			await analyzeWorkspace({ rootDir: tmpDir, dbPath });

			const provider = new ProjectGraphTreeProvider({ rootDir: tmpDir, dbPath });
			try {
				await provider.refresh();
				const children = provider.getChildren();

				const shortcuts = children.slice(0, 5);
				assert.deepStrictEqual(
					shortcuts.map((element) => (element as { kind: string }).kind),
					['shortcut', 'shortcut', 'shortcut', 'shortcut', 'shortcut']
				);
				assert.deepStrictEqual(
					shortcuts.map((element) => provider.getTreeItem(element).command?.command),
					[
						ANALYZE_WORKSPACE_COMMAND,
						OPEN_ARCHITECTURE_COMMAND,
						CALCULATE_IMPACT_COMMAND,
						SHOW_ENTRY_POINT_FLOW_COMMAND,
						SHOW_IDENTIFIED_ARCHITECTURE_COMMAND
					]
				);

				const fileEntries = children.slice(5);
				assert.ok(fileEntries.length > 0, 'expected at least one file/folder entry after the shortcuts');
			} finally {
				provider.dispose();
			}
		});

		test('renders a file node as collapsible when it contains symbols, with a resourceUri pointing at its file', async () => {
			const mathPath = writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
			await analyzeWorkspace({ rootDir: tmpDir, dbPath });

			const provider = new ProjectGraphTreeProvider({ rootDir: tmpDir, dbPath });
			try {
				await provider.refresh();
				const [, , , , , fileElement] = provider.getChildren();
				const item = provider.getTreeItem(fileElement);

				assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
				assert.strictEqual((item.resourceUri as vscode.Uri).fsPath, vscode.Uri.file(mathPath).fsPath);
				assert.strictEqual(item.command?.command, SELECT_SIDEBAR_NODE_COMMAND);

				const symbolChildren = provider.getChildren(fileElement);
				assert.strictEqual(symbolChildren.length, 1);
				assert.strictEqual(provider.getTreeItem(symbolChildren[0]).label, 'add');
			} finally {
				provider.dispose();
			}
		});

		test('refresh() re-reads the database file instead of a stale in-memory snapshot', async () => {
			const provider = new ProjectGraphTreeProvider({ rootDir: tmpDir, dbPath });
			try {
				await provider.refresh();
				assert.deepStrictEqual(provider.getChildren().length, 5, 'only the 5 shortcuts before anything is analyzed');

				writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
				await analyzeWorkspace({ rootDir: tmpDir, dbPath });
				await provider.refresh();

				assert.ok(provider.getChildren().length > 3, 'expected the file tree to appear after refresh()');
			} finally {
				provider.dispose();
			}
		});
	});

	suite('selectProjectGraphNode', () => {
		let tmpDir: string;

		setup(() => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-sidebar-select-'));
		});

		teardown(async () => {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			// Windows can briefly hold the just-closed editor's file handle after
			// `closeAllEditors` resolves; `maxRetries` absorbs that race instead of
			// failing the whole suite on an EPERM/EBUSY from `rmSync`.
			fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		});

		test('opens the node\'s file in the editor, revealing its source range', async () => {
			const filePath = writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
			const node: StoredNode = {
				id: 'symbol:add',
				kind: 'function',
				name: 'add',
				filePath,
				range: { startLine: 1, startColumn: 8, endLine: 3, endColumn: 2 },
				status: 'observed_only'
			};

			await selectProjectGraphNode(node);

			const editor = vscode.window.activeTextEditor;
			assert.ok(editor, 'expected a text editor to open');
			assert.strictEqual(editor?.document.uri.fsPath, vscode.Uri.file(filePath).fsPath);
			assert.strictEqual(editor?.selection.start.line, 0);
			assert.strictEqual(editor?.selection.start.character, 7);
		});

		test('does not throw and leaves the editor untouched for a node with no filePath', async () => {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			const node: StoredNode = { id: 'symbol:value', kind: 'variable', name: 'value', status: 'observed_only' };

			await assert.doesNotReject(selectProjectGraphNode(node));

			assert.strictEqual(vscode.window.activeTextEditor, undefined);
		});
	});
});
