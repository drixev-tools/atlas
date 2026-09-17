import * as assert from 'assert';
import { StoredEdge, StoredGraph, StoredNode } from '../../core/store';
import { buildActiveFileFlow } from '../../core/activeFileFlow';

function file(id: string): StoredNode {
	return { id, kind: 'file', name: id, filePath: id, status: 'observed_only' };
}

function func(id: string): StoredNode {
	return { id, kind: 'function', name: id, status: 'observed_only' };
}

function edge(id: string, kind: StoredEdge['kind'], source: string, target: string): StoredEdge {
	return { id, kind, source, target, status: 'observed_only' };
}

suite('buildActiveFileFlow', () => {
	test('returns undefined when the active file id is not a file node', () => {
		const graph: StoredGraph = { nodes: [func('a')], edges: [] };
		assert.strictEqual(buildActiveFileFlow(graph, 'a'), undefined);
	});

	test('returns undefined when the active file id is not in the graph at all', () => {
		const graph: StoredGraph = { nodes: [file('a')], edges: [] };
		assert.strictEqual(buildActiveFileFlow(graph, 'missing'), undefined);
	});

	test('a file with no importers and no imports is its own root, alone in the flow', () => {
		const graph: StoredGraph = { nodes: [file('a')], edges: [] };
		const flow = buildActiveFileFlow(graph, 'a');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id), ['a']);
		assert.deepStrictEqual(flow?.edges, []);
		assert.deepStrictEqual([...(flow?.highlightedIds ?? [])], ['a']);
		assert.deepStrictEqual([...(flow?.rootIds ?? [])], ['a']);
	});

	test('walks the importer chain back to its root, highlighting every file along the way', () => {
		const graph: StoredGraph = {
			nodes: [file('root'), file('mid'), file('active')],
			edges: [edge('e1', 'imports', 'root', 'mid'), edge('e2', 'imports', 'mid', 'active')]
		};
		const flow = buildActiveFileFlow(graph, 'active');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['active', 'mid', 'root']);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id).sort(), ['e1', 'e2']);
		assert.deepStrictEqual([...(flow?.highlightedIds ?? [])].sort(), ['active', 'mid', 'root']);
		assert.deepStrictEqual([...(flow?.rootIds ?? [])], ['root']);
	});

	test('includes multiple independent importer chains, each with its own root', () => {
		const graph: StoredGraph = {
			nodes: [file('rootA'), file('rootB'), file('active')],
			edges: [edge('e1', 'imports', 'rootA', 'active'), edge('e2', 'imports', 'rootB', 'active')]
		};
		const flow = buildActiveFileFlow(graph, 'active');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['active', 'rootA', 'rootB']);
		assert.deepStrictEqual([...(flow?.rootIds ?? [])].sort(), ['rootA', 'rootB']);
	});

	test('an importer cycle terminates traversal instead of looping forever', () => {
		const graph: StoredGraph = {
			nodes: [file('a'), file('b'), file('active')],
			edges: [
				edge('e1', 'imports', 'a', 'b'),
				edge('e2', 'imports', 'b', 'active'),
				edge('e3', 'imports', 'active', 'a')
			]
		};
		const flow = buildActiveFileFlow(graph, 'active');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['a', 'active', 'b']);
		assert.deepStrictEqual([...(flow?.rootIds ?? [])], []);
	});

	test("notifies the active file's own direct imports without highlighting them or following them further", () => {
		const graph: StoredGraph = {
			nodes: [file('active'), file('dep'), file('depOfDep')],
			edges: [edge('e1', 'imports', 'active', 'dep'), edge('e2', 'imports', 'dep', 'depOfDep')]
		};
		const flow = buildActiveFileFlow(graph, 'active');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['active', 'dep']);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id), ['e1']);
		assert.strictEqual(flow?.highlightedIds.has('dep'), false);
	});

	test('ignores imports edges that resolve to a non-file node (e.g. an imported symbol)', () => {
		const graph: StoredGraph = {
			nodes: [file('importer'), file('active'), func('symbol')],
			edges: [edge('e1', 'imports', 'importer', 'active'), edge('e2', 'imports', 'importer', 'symbol')]
		};
		const flow = buildActiveFileFlow(graph, 'active');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['active', 'importer']);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id), ['e1']);
	});

	test('ignores non-imports edges entirely', () => {
		const graph: StoredGraph = {
			nodes: [file('a'), file('active')],
			edges: [edge('e1', 'calls', 'a', 'active'), edge('e2', 'extends', 'active', 'a')]
		};
		const flow = buildActiveFileFlow(graph, 'active');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id), ['active']);
		assert.deepStrictEqual(flow?.edges, []);
	});
});
