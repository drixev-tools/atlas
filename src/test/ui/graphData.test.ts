import * as assert from 'assert';
import { StoredEdge, StoredGraph, StoredNode } from '../../core/store';
import { findInitialFocusNodeId, toCytoscapeElements } from '../../ui/graphData';

function makeFileNode(id: string, name: string): StoredNode {
	return { id, kind: 'file', name, filePath: `/project/${name}`, language: 'typescript', status: 'observed_only' };
}

function makeFunctionNode(id: string, name: string, filePath: string): StoredNode {
	return { id, kind: 'function', name, filePath, exported: true, status: 'observed_only' };
}

function makeContainsEdge(id: string, source: string, target: string): StoredEdge {
	return { id, kind: 'contains', source, target, status: 'observed_only' };
}

suite('toCytoscapeElements', () => {
	test('maps nodes to Cytoscape node elements carrying kind/status/filePath', () => {
		const graph: StoredGraph = { nodes: [makeFileNode('file:1', 'index.ts')], edges: [] };

		const [element] = toCytoscapeElements(graph);

		assert.strictEqual(element.group, 'nodes');
		assert.deepStrictEqual(element.data, {
			id: 'file:1',
			label: 'index.ts',
			kind: 'file',
			status: 'observed_only',
			filePath: '/project/index.ts',
			language: 'typescript'
		});
	});

	test('maps edges to Cytoscape edge elements carrying source/target/kind/status', () => {
		const graph: StoredGraph = {
			nodes: [makeFileNode('file:1', 'index.ts'), makeFunctionNode('symbol:1', 'run', '/project/index.ts')],
			edges: [makeContainsEdge('edge:1', 'file:1', 'symbol:1')]
		};

		const elements = toCytoscapeElements(graph);
		const edgeElement = elements.find((element) => element.group === 'edges');

		assert.deepStrictEqual(edgeElement?.data, {
			id: 'edge:1',
			source: 'file:1',
			target: 'symbol:1',
			kind: 'contains',
			status: 'observed_only'
		});
	});

	test('places all nodes before edges, and preserves node/edge order otherwise', () => {
		const graph: StoredGraph = {
			nodes: [makeFileNode('file:1', 'a.ts'), makeFileNode('file:2', 'b.ts')],
			edges: [makeContainsEdge('edge:1', 'file:1', 'file:2')]
		};

		const elements = toCytoscapeElements(graph);

		assert.deepStrictEqual(
			elements.map((element) => element.data.id),
			['file:1', 'file:2', 'edge:1']
		);
	});

	test('returns an empty array for an empty graph', () => {
		assert.deepStrictEqual(toCytoscapeElements({ nodes: [], edges: [] }), []);
	});
});

suite('findInitialFocusNodeId', () => {
	test('focuses the file node matching the active editor path', () => {
		const graph: StoredGraph = {
			nodes: [makeFileNode('file:1', 'a.ts'), makeFileNode('file:2', 'b.ts')],
			edges: []
		};

		assert.strictEqual(findInitialFocusNodeId(graph, '/project/b.ts'), 'file:2');
	});

	test('falls back to the first file node (sorted by path) when there is no active file match', () => {
		const graph: StoredGraph = {
			nodes: [makeFileNode('file:1', 'b.ts'), makeFileNode('file:2', 'a.ts')],
			edges: []
		};

		assert.strictEqual(findInitialFocusNodeId(graph), 'file:2');
		assert.strictEqual(findInitialFocusNodeId(graph, '/project/not-in-graph.ts'), 'file:2');
	});

	test('returns undefined when the graph has no file nodes', () => {
		const graph: StoredGraph = { nodes: [makeFunctionNode('symbol:1', 'run', '/project/index.ts')], edges: [] };

		assert.strictEqual(findInitialFocusNodeId(graph), undefined);
	});
});
