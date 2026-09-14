import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPythonPipeline } from '../../pipelines/python';
import { GraphEdge, GraphNode } from '../../pipelines/model';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('Python pipeline: end to end', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-py-pipeline-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('produces file, symbol, and external-module nodes with import/export/contains edges', async () => {
		writeFile(tmpDir, 'math_utils.py', 'def add(a, b):\n    return a + b\n');
		writeFile(
			tmpDir,
			'main.py',
			['from math_utils import add', 'import os', '', 'def run():', '    return add(1, 2)'].join('\n')
		);

		const graph = await runPythonPipeline(tmpDir);

		const nodeByName = (kind: GraphNode['kind'], name: string) =>
			graph.nodes.find((n) => n.kind === kind && n.name === name);

		const mathFile = nodeByName('file', 'math_utils.py');
		const mainFile = nodeByName('file', 'main.py');
		const addFn = nodeByName('function', 'add');
		const runFn = nodeByName('function', 'run');
		const externalOs = graph.nodes.find((n) => n.kind === 'externalModule' && n.name === 'os');

		assert.ok(mathFile, 'expected a file node for math_utils.py');
		assert.ok(mainFile, 'expected a file node for main.py');
		assert.ok(addFn, 'expected a function node for add');
		assert.ok(runFn, 'expected a function node for run');
		assert.ok(externalOs, 'expected an externalModule node for "os"');

		assert.strictEqual(addFn?.exported, true);
		assert.strictEqual(runFn?.exported, true);

		const hasEdge = (predicate: (edge: GraphEdge) => boolean) => graph.edges.some(predicate);

		assert.ok(
			hasEdge((e) => e.kind === 'contains' && e.source === mathFile!.id && e.target === addFn!.id),
			'expected math_utils.py to contain add()'
		);
		assert.ok(
			hasEdge((e) => e.kind === 'exports' && e.source === mathFile!.id && e.target === addFn!.id),
			'expected math_utils.py to export add()'
		);
		assert.ok(
			hasEdge((e) => e.kind === 'imports' && e.source === mainFile!.id && e.target === mathFile!.id),
			'expected main.py to import math_utils.py by resolved file node'
		);
		assert.ok(
			hasEdge((e) => e.kind === 'imports' && e.source === mainFile!.id && e.target === externalOs!.id),
			'expected main.py to import the external "os" module'
		);
	});

	test('resolves relative package imports to sibling file nodes', async () => {
		writeFile(tmpDir, 'pkg/__init__.py', '');
		writeFile(tmpDir, 'pkg/helpers.py', 'def helper():\n    pass\n');
		writeFile(tmpDir, 'pkg/main.py', 'from .helpers import helper\n');

		const graph = await runPythonPipeline(tmpDir);

		const helpersFile = graph.nodes.find((n) => n.kind === 'file' && n.name === 'helpers.py');
		const mainFile = graph.nodes.find((n) => n.kind === 'file' && n.name === 'main.py');

		assert.ok(helpersFile);
		assert.ok(mainFile);
		assert.ok(
			graph.edges.some(
				(e) => e.kind === 'imports' && e.source === mainFile!.id && e.target === helpersFile!.id
			),
			'expected pkg/main.py to import pkg/helpers.py by resolved file node'
		);
	});

	test('returns an empty graph when there are no Python files', async () => {
		const graph = await runPythonPipeline(tmpDir);
		assert.deepStrictEqual(graph, { nodes: [], edges: [] });
	});
});
