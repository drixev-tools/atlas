import * as assert from 'assert';
import { StoredGraph, StoredNode } from '../../core/store';
import { findInitialFocusNodeId } from '../../ui/graphFocus';

function makeFileNode(id: string, name: string): StoredNode {
	return { id, kind: 'file', name, filePath: `/project/${name}`, language: 'typescript', status: 'observed_only' };
}

function makeFunctionNode(id: string, name: string, filePath: string): StoredNode {
	return { id, kind: 'function', name, filePath, exported: true, status: 'observed_only' };
}

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
