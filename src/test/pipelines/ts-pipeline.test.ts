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

	test('produces calls, extends, implements, and instantiates edges across files', () => {
		writeFile(
			tmpDir,
			'shapes.ts',
			[
				'export interface Shape {}',
				'export class Base {',
				'  describe(): void {}',
				'}',
				'export class Circle extends Base implements Shape {',
				'  describe(): void { super.describe(); }',
				'}'
			].join('\n')
		);
		writeFile(
			tmpDir,
			'index.ts',
			["import { Circle } from './shapes';", '', 'export function run(): void {', '  new Circle().describe();', '}'].join('\n')
		);

		const graph = runTsPipeline(tmpDir);
		const nodeByName = (kind: GraphNode['kind'], name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name);
		const hasEdge = (predicate: (edge: GraphEdge) => boolean) => graph.edges.some(predicate);

		const circleClass = nodeByName('class', 'Circle');
		const baseClass = nodeByName('class', 'Base');
		const shapeInterface = nodeByName('interface', 'Shape');
		const runFn = nodeByName('function', 'run');
		const circleDescribe = graph.nodes.find(
			(n) => n.kind === 'method' && n.name === 'describe' && hasEdge((e) => e.kind === 'contains' && e.source === circleClass?.id && e.target === n.id)
		);

		assert.ok(circleClass && baseClass && shapeInterface && runFn && circleDescribe);

		assert.ok(hasEdge((e) => e.kind === 'extends' && e.source === circleClass!.id && e.target === baseClass!.id));
		assert.ok(hasEdge((e) => e.kind === 'implements' && e.source === circleClass!.id && e.target === shapeInterface!.id));
		assert.ok(hasEdge((e) => e.kind === 'instantiates' && e.source === runFn!.id && e.target === circleClass!.id));
		assert.ok(hasEdge((e) => e.kind === 'calls' && e.source === runFn!.id && e.target === circleDescribe!.id));
	});

	test('produces a symbol-level imports edge to the imported declaration, in addition to the file-level edge', () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		writeFile(tmpDir, 'index.ts', "import { add as sum } from './math';\nexport function run(): number { return sum(1, 2); }\n");

		const graph = runTsPipeline(tmpDir);
		const indexFile = graph.nodes.find((n) => n.kind === 'file' && n.name === 'index.ts');
		const addFn = graph.nodes.find((n) => n.kind === 'function' && n.name === 'add');

		assert.ok(indexFile && addFn);
		assert.ok(graph.edges.some((e) => e.kind === 'imports' && e.source === indexFile!.id && e.target === addFn!.id));
	});

	test('discards a call resolved into an external module instead of pointing it at an external node', () => {
		writeFile(tmpDir, 'index.ts', ["import * as path from 'path';", 'export function run(): string {', '  return path.join("a", "b");', '}'].join('\n'));

		const graph = runTsPipeline(tmpDir);

		assert.strictEqual(graph.edges.filter((e) => e.kind === 'calls').length, 0);
	});
});
