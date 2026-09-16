import * as assert from 'assert';
import { StoredEdge, StoredNode } from '../../core/store';
import { EntryPointFlow } from '../../core/entryPointFlow';
import { childIds, hasCollapsedChildren, visibleEntryPointFlow } from '../../ui/entryPointFlowExpansion';

function node(id: string): StoredNode {
	return { id, kind: 'function', name: id, status: 'observed_only' };
}

function edge(id: string, source: string, target: string): StoredEdge {
	return { id, kind: 'calls', source, target, status: 'observed_only' };
}

/** a -> b -> c, a -> d, b -> d (convergence), c -> a (cycle back to the entry point). */
function fixture(): EntryPointFlow {
	const nodes = [node('a'), node('b'), node('c'), node('d')];
	const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'a', 'd'), edge('e4', 'b', 'd'), edge('e5', 'c', 'a')];
	return { entryPointId: 'a', nodes, edges, depthById: new Map([['a', 0], ['b', 1], ['c', 2], ['d', 1]]), truncatedNodeIds: new Set() };
}

suite('childIds', () => {
	test('returns the ids every calls edge from nodeId reaches', () => {
		assert.deepStrictEqual(childIds(fixture(), 'a').sort(), ['b', 'd']);
		assert.deepStrictEqual(childIds(fixture(), 'd'), []);
	});
});

suite('visibleEntryPointFlow', () => {
	test('with nothing expanded, shows the entry point and its direct callees only', () => {
		const { nodeIds, edgeIds } = visibleEntryPointFlow(fixture(), new Set());
		assert.deepStrictEqual([...nodeIds].sort(), ['a', 'b', 'd']);
		assert.deepStrictEqual([...edgeIds].sort(), ['e1', 'e3']);
	});

	test('expanding a node reveals its own direct callees', () => {
		const { nodeIds, edgeIds } = visibleEntryPointFlow(fixture(), new Set(['b']));
		assert.deepStrictEqual([...nodeIds].sort(), ['a', 'b', 'c', 'd']);
		assert.deepStrictEqual([...edgeIds].sort(), ['e1', 'e2', 'e3', 'e4']);
	});

	test('a convergence target stays visible once expanding either of its callers reaches it', () => {
		const viaA = visibleEntryPointFlow(fixture(), new Set());
		const viaB = visibleEntryPointFlow(fixture(), new Set(['b']));
		assert.strictEqual(viaA.nodeIds.has('d'), true);
		assert.strictEqual(viaB.nodeIds.has('d'), true);
	});

	test('a cycle back to the entry point does not loop forever and surfaces the back-edge once reachable', () => {
		const { nodeIds, edgeIds } = visibleEntryPointFlow(fixture(), new Set(['b', 'c']));
		assert.deepStrictEqual([...nodeIds].sort(), ['a', 'b', 'c', 'd']);
		assert.strictEqual(edgeIds.has('e5'), true);
	});
});

suite('hasCollapsedChildren', () => {
	test('true for a visible node whose callee is not currently visible', () => {
		const flow = fixture();
		const { nodeIds } = visibleEntryPointFlow(flow, new Set());
		assert.strictEqual(hasCollapsedChildren(flow, 'b', nodeIds), true);
	});

	test('false once the node is expanded and its callees are visible', () => {
		const flow = fixture();
		const { nodeIds } = visibleEntryPointFlow(flow, new Set(['b']));
		assert.strictEqual(hasCollapsedChildren(flow, 'b', nodeIds), false);
	});

	test('false for a node with no outgoing calls at all', () => {
		const flow = fixture();
		const { nodeIds } = visibleEntryPointFlow(flow, new Set());
		assert.strictEqual(hasCollapsedChildren(flow, 'd', nodeIds), false);
	});
});
