import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { populateAtlas } from '../../core/populate';
import { AtlasStore } from '../../core/store';
import { runTsPipeline } from '../../pipelines/ts';
import { runPythonPipeline } from '../../pipelines/python';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('populateAtlas: both pipelines', () => {
	let tsDir: string;
	let pyDir: string;
	let store: AtlasStore;

	setup(async () => {
		tsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-populate-ts-'));
		pyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-populate-py-'));
		store = await AtlasStore.open();
	});

	teardown(() => {
		store.close();
		fs.rmSync(tsDir, { recursive: true, force: true });
		fs.rmSync(pyDir, { recursive: true, force: true });
	});

	test('stores nodes and edges from the TS/JS and Python pipelines side by side, tagged observed_only', async () => {
		writeFile(tsDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		writeFile(pyDir, 'math_utils.py', 'def add(a, b):\n    return a + b\n');

		const tsGraph = runTsPipeline(tsDir);
		const pythonGraph = await runPythonPipeline(pyDir);

		populateAtlas(store, [tsGraph, pythonGraph]);

		const tsAdd = store.listNodes({ kind: 'function' }).find((n) => n.name === 'add' && n.filePath?.endsWith('math.ts'));
		const pyAdd = store.listNodes({ kind: 'function' }).find((n) => n.name === 'add' && n.filePath?.endsWith('math_utils.py'));

		assert.ok(tsAdd, 'expected the TS pipeline function node to be stored');
		assert.ok(pyAdd, 'expected the Python pipeline function node to be stored');
		assert.strictEqual(tsAdd?.status, 'observed_only');
		assert.strictEqual(pyAdd?.status, 'observed_only');

		const combined = store.getGraph();
		assert.strictEqual(combined.nodes.length, tsGraph.nodes.length + pythonGraph.nodes.length);
		assert.strictEqual(combined.edges.length, tsGraph.edges.length + pythonGraph.edges.length);
	});

	test('a second populate call replaces the previous contents instead of accumulating duplicates', async () => {
		writeFile(tsDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		const tsGraph = runTsPipeline(tsDir);

		populateAtlas(store, [tsGraph]);
		populateAtlas(store, [tsGraph]);

		assert.strictEqual(store.getGraph().nodes.length, tsGraph.nodes.length);
	});

	test('honors an explicit status override', async () => {
		writeFile(tsDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		const tsGraph = runTsPipeline(tsDir);

		populateAtlas(store, [tsGraph], { status: 'proposed_only' });

		for (const node of store.getGraph().nodes) {
			assert.strictEqual(node.status, 'proposed_only');
		}
	});
});
