import * as assert from 'assert';
import { StoredEdge, StoredGraph, StoredNode } from '../../core/store';
import { buildEntryPointFlow } from '../../core/entryPointFlow';

function node(id: string): StoredNode {
	return { id, kind: 'function', name: id, status: 'observed_only' };
}

function edge(id: string, kind: StoredEdge['kind'], source: string, target: string): StoredEdge {
	return { id, kind, source, target, status: 'observed_only' };
}

suite('buildEntryPointFlow', () => {
	test('returns undefined when the entry point id is not in the graph', () => {
		const graph: StoredGraph = { nodes: [node('a')], edges: [] };
		assert.strictEqual(buildEntryPointFlow(graph, 'missing'), undefined);
	});

	test('an entry point with no outgoing calls is just itself, at depth 0', () => {
		const graph: StoredGraph = { nodes: [node('a')], edges: [] };
		const flow = buildEntryPointFlow(graph, 'a');
		assert.strictEqual(flow?.nodes.map((n) => n.id).join(), 'a');
		assert.deepStrictEqual(flow?.edges, []);
		assert.deepStrictEqual([...(flow?.depthById ?? [])], [['a', 0]]);
		assert.deepStrictEqual([...(flow?.truncatedNodeIds ?? [])], []);
	});

	test('follows calls edges outward, recording each node at its shortest hop count from the entry point', () => {
		const graph: StoredGraph = {
			nodes: [node('a'), node('b'), node('c')],
			edges: [edge('e1', 'calls', 'a', 'b'), edge('e2', 'calls', 'b', 'c')]
		};
		const flow = buildEntryPointFlow(graph, 'a');
		assert.deepStrictEqual(
			[...(flow?.depthById ?? [])].sort(),
			[
				['a', 0],
				['b', 1],
				['c', 2]
			].sort()
		);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id).sort(), ['e1', 'e2']);
	});

	test('ignores non-calls edges entirely, even between nodes already in the flow', () => {
		const graph: StoredGraph = {
			nodes: [node('a'), node('b')],
			edges: [edge('e1', 'calls', 'a', 'b'), edge('e2', 'imports', 'a', 'b'), edge('e3', 'extends', 'b', 'a')]
		};
		const flow = buildEntryPointFlow(graph, 'a');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['a', 'b']);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id), ['e1']);
	});

	test('branches: one node calling several others includes every branch', () => {
		const graph: StoredGraph = {
			nodes: [node('a'), node('b'), node('c'), node('d')],
			edges: [edge('e1', 'calls', 'a', 'b'), edge('e2', 'calls', 'a', 'c'), edge('e3', 'calls', 'a', 'd')]
		};
		const flow = buildEntryPointFlow(graph, 'a');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['a', 'b', 'c', 'd']);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id).sort(), ['e1', 'e2', 'e3']);
	});

	test('convergence: two different callers of the same target keep both edges but include the target once', () => {
		const graph: StoredGraph = {
			nodes: [node('a'), node('b'), node('c'), node('shared')],
			edges: [
				edge('e1', 'calls', 'a', 'b'),
				edge('e2', 'calls', 'a', 'c'),
				edge('e3', 'calls', 'b', 'shared'),
				edge('e4', 'calls', 'c', 'shared')
			]
		};
		const flow = buildEntryPointFlow(graph, 'a');
		assert.strictEqual(flow?.nodes.filter((n) => n.id === 'shared').length, 1);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id).sort(), ['e1', 'e2', 'e3', 'e4']);
	});

	test('cycles: a back-edge to an already-visited node terminates traversal but is kept as an edge', () => {
		const graph: StoredGraph = {
			nodes: [node('a'), node('b'), node('c')],
			edges: [edge('e1', 'calls', 'a', 'b'), edge('e2', 'calls', 'b', 'c'), edge('e3', 'calls', 'c', 'a')]
		};
		const flow = buildEntryPointFlow(graph, 'a');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['a', 'b', 'c']);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id).sort(), ['e1', 'e2', 'e3']);
		assert.strictEqual(flow?.depthById.get('a'), 0);
	});

	test('a self-recursive call does not loop forever and keeps the self-edge', () => {
		const graph: StoredGraph = { nodes: [node('a')], edges: [edge('e1', 'calls', 'a', 'a')] };
		const flow = buildEntryPointFlow(graph, 'a');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id), ['a']);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id), ['e1']);
	});

	test('respects maxDepth, cutting off further nodes and flagging the boundary node as truncated', () => {
		const graph: StoredGraph = {
			nodes: [node('a'), node('b'), node('c')],
			edges: [edge('e1', 'calls', 'a', 'b'), edge('e2', 'calls', 'b', 'c')]
		};
		const flow = buildEntryPointFlow(graph, 'a', { maxDepth: 1 });
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['a', 'b']);
		assert.deepStrictEqual(flow?.edges.map((e) => e.id), ['e1']);
		assert.deepStrictEqual([...(flow?.truncatedNodeIds ?? [])], ['b']);
	});

	test('maxDepth of 0 keeps only the entry point, truncated if it has any outgoing calls', () => {
		const graph: StoredGraph = {
			nodes: [node('a'), node('b')],
			edges: [edge('e1', 'calls', 'a', 'b')]
		};
		const flow = buildEntryPointFlow(graph, 'a', { maxDepth: 0 });
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id), ['a']);
		assert.deepStrictEqual(flow?.edges, []);
		assert.deepStrictEqual([...(flow?.truncatedNodeIds ?? [])], ['a']);
	});

	test('a node at the depth boundary is not marked truncated when its callees are already included', () => {
		const graph: StoredGraph = {
			nodes: [node('a'), node('b'), node('c')],
			edges: [edge('e1', 'calls', 'a', 'b'), edge('e2', 'calls', 'a', 'c'), edge('e3', 'calls', 'b', 'c')]
		};
		const flow = buildEntryPointFlow(graph, 'a', { maxDepth: 1 });
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id).sort(), ['a', 'b', 'c']);
		assert.deepStrictEqual([...(flow?.truncatedNodeIds ?? [])], []);
	});

	test('ignores a calls edge whose target node no longer exists in the graph', () => {
		const graph: StoredGraph = { nodes: [node('a')], edges: [edge('e1', 'calls', 'a', 'ghost')] };
		const flow = buildEntryPointFlow(graph, 'a');
		assert.deepStrictEqual(flow?.nodes.map((n) => n.id), ['a']);
		assert.deepStrictEqual(flow?.edges, []);
		assert.deepStrictEqual([...(flow?.truncatedNodeIds ?? [])], []);
	});
});
