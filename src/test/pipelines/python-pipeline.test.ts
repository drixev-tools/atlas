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
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-py-pipeline-'));
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

	test('produces calls and extends edges, resolving self.method() to the enclosing class', async () => {
		writeFile(
			tmpDir,
			'shapes.py',
			[
				'class Base:',
				'    def describe(self):',
				'        pass',
				'',
				'class Circle(Base):',
				'    def describe(self):',
				'        self.render()',
				'',
				'    def render(self):',
				'        pass',
				'',
				'def run():',
				'    setup()',
				'',
				'def setup():',
				'    pass'
			].join('\n')
		);

		const graph = await runPythonPipeline(tmpDir);
		const nodeByName = (kind: GraphNode['kind'], name: string) => graph.nodes.find((n) => n.kind === kind && n.name === name);
		const hasEdge = (predicate: (edge: GraphEdge) => boolean) => graph.edges.some(predicate);

		const baseClass = nodeByName('class', 'Base');
		const circleClass = nodeByName('class', 'Circle');
		const runFn = nodeByName('function', 'run');
		const setupFn = nodeByName('function', 'setup');
		const circleDescribe = graph.nodes.find(
			(n) => n.kind === 'method' && n.name === 'describe' && hasEdge((e) => e.kind === 'contains' && e.source === circleClass?.id && e.target === n.id)
		);
		const circleRender = graph.nodes.find(
			(n) => n.kind === 'method' && n.name === 'render' && hasEdge((e) => e.kind === 'contains' && e.source === circleClass?.id && e.target === n.id)
		);

		assert.ok(baseClass && circleClass && runFn && setupFn && circleDescribe && circleRender);

		assert.ok(hasEdge((e) => e.kind === 'extends' && e.source === circleClass!.id && e.target === baseClass!.id));
		assert.ok(hasEdge((e) => e.kind === 'calls' && e.source === circleDescribe!.id && e.target === circleRender!.id));
		assert.ok(hasEdge((e) => e.kind === 'calls' && e.source === runFn!.id && e.target === setupFn!.id));
	});

	test('resolves a call to a function imported from a sibling file', async () => {
		writeFile(tmpDir, 'math_utils.py', 'def add(a, b):\n    return a + b\n');
		writeFile(
			tmpDir,
			'main.py',
			['from math_utils import add', '', 'def run():', '    return add(1, 2)'].join('\n')
		);

		const graph = await runPythonPipeline(tmpDir);
		const addFn = graph.nodes.find((n) => n.kind === 'function' && n.name === 'add');
		const runFn = graph.nodes.find((n) => n.kind === 'function' && n.name === 'run');

		assert.ok(addFn && runFn);
		assert.ok(graph.edges.some((e) => e.kind === 'calls' && e.source === runFn!.id && e.target === addFn!.id));
	});

	test('discards calls and base classes it cannot resolve instead of guessing', async () => {
		writeFile(
			tmpDir,
			'main.py',
			[
				'import unittest',
				'',
				'class Widget(unittest.TestCase):',
				'    def run(self, thing):',
				'        thing.do_something()',
				'        unknown_name()'
			].join('\n')
		);

		const graph = await runPythonPipeline(tmpDir);

		assert.strictEqual(graph.edges.filter((e) => e.kind === 'calls').length, 0);
		assert.strictEqual(graph.edges.filter((e) => e.kind === 'extends').length, 0);
	});
});
