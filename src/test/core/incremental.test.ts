import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyFileGraph, knownProjectFiles, removeFileGraph } from '../../core/incremental';
import { populateProjectGraph } from '../../core/populate';
import { ProjectGraphStore } from '../../core/store';
import { runPythonPipeline } from '../../pipelines/python';
import { runTsPipeline } from '../../pipelines/ts';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return path.resolve(filePath);
}

suite('incremental: TS/JS single-file updates', () => {
	let tmpDir: string;
	let store: ProjectGraphStore;
	let mathPath: string;
	let indexPath: string;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-incremental-ts-'));
		store = await ProjectGraphStore.open();

		mathPath = writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		indexPath = writeFile(
			tmpDir,
			'index.ts',
			["import { add } from './math';", '', 'export function run(): number {', '  return add(1, 2);', '}'].join('\n')
		);

		populateProjectGraph(store, [runTsPipeline(tmpDir)]);
	});

	teardown(() => {
		store.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('knownProjectFiles lists every currently stored file node path', () => {
		const files = knownProjectFiles(store).map((f) => path.resolve(f));
		assert.strictEqual(files.length, 2);
		assert.ok(files.includes(mathPath));
		assert.ok(files.includes(indexPath));
	});

	test('re-parsing a changed file adds its new symbols without touching other files', () => {
		writeFile(
			tmpDir,
			'math.ts',
			[
				'export function add(a: number, b: number): number { return a + b; }',
				'export function subtract(a: number, b: number): number { return a - b; }'
			].join('\n')
		);

		const knownFiles = knownProjectFiles(store);
		const graph = runTsPipeline(tmpDir, { files: [mathPath], knownFiles });
		applyFileGraph(store, mathPath, graph);

		const subtractNode = store.listNodes({ kind: 'function' }).find((n) => n.name === 'subtract');
		assert.ok(subtractNode, 'expected the newly added subtract() to be stored');

		const runNode = store.listNodes({ kind: 'function' }).find((n) => n.name === 'run');
		assert.ok(runNode, 'expected index.ts, which was not re-parsed, to be untouched');

		const importEdge = store
			.listEdges({ kind: 'imports' })
			.find((e) => e.source === `file:${indexPath}` && e.target === `file:${mathPath}`);
		assert.ok(importEdge, "expected index.ts's import of math.ts to still resolve to math.ts's file node");
	});

	test('re-parsing a changed file removes symbols no longer present', () => {
		writeFile(tmpDir, 'math.ts', 'export function subtract(a: number, b: number): number { return a - b; }\n');

		const knownFiles = knownProjectFiles(store);
		const graph = runTsPipeline(tmpDir, { files: [mathPath], knownFiles });
		applyFileGraph(store, mathPath, graph);

		assert.strictEqual(store.listNodes({ kind: 'function' }).find((n) => n.name === 'add'), undefined);
		assert.ok(store.listNodes({ kind: 'function' }).find((n) => n.name === 'subtract'));

		const mathFileNode = store.getNode(`file:${mathPath}`);
		assert.ok(mathFileNode, "expected math.ts's own file node to survive the update");
	});

	test('deleting a file removes its nodes and cascades to edges other files held pointing at it', () => {
		assert.ok(store.getNode(`file:${mathPath}`));
		const importEdgeId = store
			.listEdges({ kind: 'imports' })
			.find((e) => e.source === `file:${indexPath}` && e.target === `file:${mathPath}`)?.id;
		assert.ok(importEdgeId);

		removeFileGraph(store, mathPath);

		assert.strictEqual(store.getNode(`file:${mathPath}`), undefined);
		assert.strictEqual(store.listNodes({ kind: 'function' }).find((n) => n.name === 'add'), undefined);
		assert.strictEqual(store.getEdge(importEdgeId!), undefined, 'expected the dangling import edge to cascade-delete');
		assert.ok(store.getNode(`file:${indexPath}`), "expected index.ts's own file node to be untouched by math.ts's deletion");
	});

	test('re-parsing the caller alone still resolves a calls edge into an un-reparsed sibling file', () => {
		const knownFiles = knownProjectFiles(store);
		const graph = runTsPipeline(tmpDir, { files: [indexPath], knownFiles });
		applyFileGraph(store, indexPath, graph);

		const runFn = store.listNodes({ kind: 'function' }).find((n) => n.name === 'run');
		const addFn = store.listNodes({ kind: 'function' }).find((n) => n.name === 'add');
		assert.ok(runFn && addFn);

		const callEdge = store.listEdges({ kind: 'calls' }).find((e) => e.source === runFn!.id && e.target === addFn!.id);
		assert.ok(callEdge, "expected run()'s call into math.ts's add(), which was not re-parsed, to still resolve");
	});

	test('re-parsing an un-reparsed callee leaves a calls edge sourced from another file untouched', () => {
		const runFnBefore = store.listNodes({ kind: 'function' }).find((n) => n.name === 'run');
		const addFnBefore = store.listNodes({ kind: 'function' }).find((n) => n.name === 'add');
		const callEdgeBefore = store.listEdges({ kind: 'calls' }).find((e) => e.source === runFnBefore!.id && e.target === addFnBefore!.id);
		assert.ok(callEdgeBefore, 'expected the initial full scan to have produced a calls edge from run() to add()');

		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\nexport function unused(): void {}\n');
		const knownFiles = knownProjectFiles(store);
		const graph = runTsPipeline(tmpDir, { files: [mathPath], knownFiles });
		applyFileGraph(store, mathPath, graph);

		assert.ok(store.getEdge(callEdgeBefore!.id), "expected index.ts's calls edge, not sourced from math.ts, to survive math.ts's re-parse");
	});

	test('adding a new file inserts its nodes/edges and resolves imports to already-known siblings', () => {
		const utilsPath = writeFile(tmpDir, 'utils.ts', "import { add } from './math';\nexport function double(n: number): number { return add(n, n); }\n");

		const knownFiles = [...knownProjectFiles(store), utilsPath];
		const graph = runTsPipeline(tmpDir, { files: [utilsPath], knownFiles });
		applyFileGraph(store, utilsPath, graph);

		const doubleNode = store.listNodes({ kind: 'function' }).find((n) => n.name === 'double');
		assert.ok(doubleNode, 'expected the new file to contribute a function node');

		const importEdge = store
			.listEdges({ kind: 'imports' })
			.find((e) => e.source === `file:${utilsPath}` && e.target === `file:${mathPath}`);
		assert.ok(importEdge, "expected utils.ts's import of math.ts to resolve to math.ts's file node, not an external module");
	});
});

suite('incremental: Python single-file updates', () => {
	let tmpDir: string;
	let store: ProjectGraphStore;
	let mathPath: string;
	let mainPath: string;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-incremental-py-'));
		store = await ProjectGraphStore.open();

		mathPath = writeFile(tmpDir, 'math_utils.py', 'def add(a, b):\n    return a + b\n');
		mainPath = writeFile(tmpDir, 'main.py', ['from math_utils import add', '', 'def run():', '    return add(1, 2)'].join('\n'));

		populateProjectGraph(store, [await runPythonPipeline(tmpDir)]);
	});

	teardown(() => {
		store.close();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('re-parsing a changed file adds its new symbols and keeps cross-file imports resolved', async () => {
		writeFile(tmpDir, 'math_utils.py', 'def add(a, b):\n    return a + b\n\n\ndef subtract(a, b):\n    return a - b\n');

		const knownFiles = knownProjectFiles(store);
		const graph = await runPythonPipeline(tmpDir, { files: [mathPath], knownFiles });
		applyFileGraph(store, mathPath, graph);

		assert.ok(store.listNodes({ kind: 'function' }).find((n) => n.name === 'subtract'));
		const importEdge = store
			.listEdges({ kind: 'imports' })
			.find((e) => e.source === `file:${mainPath}` && e.target === `file:${mathPath}`);
		assert.ok(importEdge, "expected main.py's import of math_utils.py to still resolve to its file node");
	});

	test('deleting a file removes its nodes and cascades to edges other files held pointing at it', () => {
		removeFileGraph(store, mathPath);

		assert.strictEqual(store.getNode(`file:${mathPath}`), undefined);
		assert.strictEqual(
			store.listEdges({ kind: 'imports' }).find((e) => e.source === `file:${mainPath}` && e.target === `file:${mathPath}`),
			undefined
		);
		assert.ok(store.getNode(`file:${mainPath}`), "expected main.py's own file node to be untouched by math_utils.py's deletion");
	});
});
