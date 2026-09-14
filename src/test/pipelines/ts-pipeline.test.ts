import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTsPipeline } from '../../pipelines/ts';
import { GraphEdge, GraphNode } from '../../pipelines/model';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('TS pipeline: end to end', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-pipeline-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('produces file, symbol, and external-module nodes with import/export/contains edges', () => {
		writeFile(
			tmpDir,
			'math.ts',
			'export function add(a: number, b: number): number { return a + b; }\n'
		);
		writeFile(
			tmpDir,
			'index.ts',
			[
				"import { add } from './math';",
				"import * as path from 'path';",
				'',
				'export function run(): number {',
				'  return add(1, 2);',
				'}'
			].join('\n')
		);

		const graph = runTsPipeline(tmpDir);

		const nodeByName = (kind: GraphNode['kind'], name: string) =>
			graph.nodes.find((n) => n.kind === kind && n.name === name);

		const mathFile = nodeByName('file', 'math.ts');
		const indexFile = nodeByName('file', 'index.ts');
		const addFn = nodeByName('function', 'add');
		const runFn = nodeByName('function', 'run');
		const externalPath = graph.nodes.find((n) => n.kind === 'externalModule' && n.name === 'path');

		assert.ok(mathFile, 'expected a file node for math.ts');
		assert.ok(indexFile, 'expected a file node for index.ts');
		assert.ok(addFn, 'expected a function node for add');
		assert.ok(runFn, 'expected a function node for run');
		assert.ok(externalPath, 'expected an externalModule node for the "path" package');

		assert.strictEqual(addFn?.exported, true);
		assert.strictEqual(runFn?.exported, true);

		const hasEdge = (predicate: (edge: GraphEdge) => boolean) => graph.edges.some(predicate);

		assert.ok(
			hasEdge((e) => e.kind === 'contains' && e.source === mathFile!.id && e.target === addFn!.id),
			'expected math.ts to contain add()'
		);
		assert.ok(
			hasEdge((e) => e.kind === 'exports' && e.source === mathFile!.id && e.target === addFn!.id),
			'expected math.ts to export add()'
		);
		assert.ok(
			hasEdge(
				(e) => e.kind === 'imports' && e.source === indexFile!.id && e.target === mathFile!.id
			),
			'expected index.ts to import math.ts by resolved file node'
		);
		assert.ok(
			hasEdge(
				(e) => e.kind === 'imports' && e.source === indexFile!.id && e.target === externalPath!.id
			),
			'expected index.ts to import the external "path" module'
		);
	});

	test('returns an empty graph when there are no TS/JS files', () => {
		const graph = runTsPipeline(tmpDir);
		assert.deepStrictEqual(graph, { nodes: [], edges: [] });
	});
});
