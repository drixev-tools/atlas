import * as assert from 'assert';
import { countEdges, GraphElement, directRelationIds, visibleElements } from '../../ui/graphExpansion';

function node(id: string): GraphElement {
	return { group: 'nodes', data: { id, label: id } };
}

function edge(id: string, source: string, target: string): GraphElement {
	return { group: 'edges', data: { id, source, target } };
}

/**
 * a -> b -> c, and d -> a, with e left completely disconnected. Exercises
 * both edge directions and a node with no relations at all.
 */
function fixture(): GraphElement[] {
	return [
		node('a'),
		node('b'),
		node('c'),
		node('d'),
		node('e'),
		edge('e1', 'a', 'b'),
		edge('e2', 'b', 'c'),
		edge('e3', 'd', 'a')
	];
}

suite('directRelationIds', () => {
	test('includes the node itself, its incoming and outgoing neighbors, and only the edges touching it', () => {
		const { nodeIds, edgeIds } = directRelationIds(fixture(), 'a');

		assert.deepStrictEqual([...nodeIds].sort(), ['a', 'b', 'd']);
		assert.deepStrictEqual([...edgeIds].sort(), ['e1', 'e3']);
	});

	test('a node with no edges has only itself as a direct relation', () => {
		const { nodeIds, edgeIds } = directRelationIds(fixture(), 'e');

		assert.deepStrictEqual([...nodeIds], ['e']);
		assert.deepStrictEqual([...edgeIds], []);
	});
});

suite('visibleElements', () => {
	test('with nothing expanded, shows only the focus node and its direct relations', () => {
		const visible = visibleElements(fixture(), 'b', new Set());

		assert.deepStrictEqual(
			visible.map((element) => element.data.id).sort(),
			['a', 'b', 'c', 'e1', 'e2']
		);
	});

	test('expanding another node adds its own direct relations too', () => {
		const visible = visibleElements(fixture(), 'b', new Set(['a']));

		assert.deepStrictEqual(
			visible.map((element) => element.data.id).sort(),
			['a', 'b', 'c', 'd', 'e1', 'e2', 'e3']
		);
	});

	test('collapsing an expanded node drops a neighbor no longer reachable from the focus or any other expanded node', () => {
		const stillExpanded = visibleElements(fixture(), 'b', new Set(['a']));
		const collapsed = visibleElements(fixture(), 'b', new Set());

		assert.ok(stillExpanded.some((element) => element.data.id === 'd'));
		assert.ok(!collapsed.some((element) => element.data.id === 'd'));
	});
});

suite('countEdges', () => {
	test('counts incoming and outgoing edges independently of what is currently visible', () => {
		assert.deepStrictEqual(countEdges(fixture(), 'a'), { incoming: 1, outgoing: 1 });
		assert.deepStrictEqual(countEdges(fixture(), 'e'), { incoming: 0, outgoing: 0 });
	});
});
