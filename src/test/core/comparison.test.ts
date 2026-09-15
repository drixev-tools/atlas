import * as assert from 'assert';
import { CodeGraph, GraphEdge, GraphNode } from '../../pipelines/model';
import { EdgeMatchResult, NodeMatchResult, matchEdges, matchNodes, reconcileProposedGraph } from '../../core/comparison';
import { ProjectGraphStore } from '../../core/store';

const node = (overrides: GraphNode): GraphNode => overrides;
const edge = (overrides: GraphEdge): GraphEdge => overrides;

suite('matchNodes', () => {
	test('matches file/externalModule nodes on exact id', () => {
		const observed: GraphNode[] = [
			node({ id: 'file:/project/index.ts', kind: 'file', name: 'index.ts', filePath: '/project/index.ts' }),
			node({ id: 'external:express', kind: 'externalModule', name: 'express' })
		];
		const proposed: GraphNode[] = [
			node({ id: 'file:/project/index.ts', kind: 'file', name: 'index.ts', filePath: '/project/index.ts' }),
			node({ id: 'external:express', kind: 'externalModule', name: 'express' })
		];

		const result: NodeMatchResult = matchNodes(observed, proposed);

		assert.strictEqual(result.matchedProposedIds.size, 2);
		assert.strictEqual(result.resolvedId.get('file:/project/index.ts'), 'file:/project/index.ts');
		assert.strictEqual(result.resolvedId.get('external:express'), 'external:express');
	});

	test('matches a symbol-kind proposed node to an observed one by kind + name + file, since ids differ', () => {
		const observed: GraphNode[] = [
			node({
				id: 'symbol:/project/loginService.ts:3:1:LoginService',
				kind: 'class',
				name: 'LoginService',
				filePath: '/project/loginService.ts'
			})
		];
		const proposed: GraphNode[] = [
			node({
				id: 'proposed:class:file:/project/loginService.ts:LoginService',
				kind: 'class',
				name: 'LoginService',
				filePath: '/project/loginService.ts'
			})
		];

		const result = matchNodes(observed, proposed);

		assert.strictEqual(result.matchedProposedIds.size, 1);
		assert.strictEqual(
			result.resolvedId.get('proposed:class:file:/project/loginService.ts:LoginService'),
			'symbol:/project/loginService.ts:3:1:LoginService'
		);
	});

	test('leaves a proposed node unmatched, resolved to its own id, when nothing observed corresponds to it', () => {
		const result = matchNodes([], [node({ id: 'proposed:module:auth', kind: 'module', name: 'auth' })]);

		assert.strictEqual(result.matchedProposedIds.size, 0);
		assert.strictEqual(result.resolvedId.get('proposed:module:auth'), 'proposed:module:auth');
	});

	test('does not match the same observed node twice', () => {
		const observed: GraphNode[] = [node({ id: 'symbol:1', kind: 'function', name: 'run', filePath: '/project/a.ts' })];
		const proposed: GraphNode[] = [
			node({ id: 'proposed:function:a:run', kind: 'function', name: 'run', filePath: '/project/a.ts' }),
			node({ id: 'proposed:function:b:run', kind: 'function', name: 'run', filePath: '/project/a.ts' })
		];

		const result = matchNodes(observed, proposed);

		assert.strictEqual(result.matchedProposedIds.size, 1);
		const matchedRefs = [...result.matchedProposedIds];
		assert.strictEqual(result.resolvedId.get(matchedRefs[0]), 'symbol:1');
	});
});

suite('matchEdges', () => {
	test('matches a proposed edge whose resolved endpoints equal an observed edge of the same kind', () => {
		const resolvedNodeId = new Map([
			['proposed:file', 'file:/project/index.ts'],
			['proposed:class', 'symbol:1']
		]);
		const observed: GraphEdge[] = [edge({ id: 'edge:observed', kind: 'contains', source: 'file:/project/index.ts', target: 'symbol:1' })];
		const proposed: GraphEdge[] = [edge({ id: 'edge:proposed', kind: 'contains', source: 'proposed:file', target: 'proposed:class' })];

		const result: EdgeMatchResult = matchEdges(observed, proposed, resolvedNodeId);

		assert.strictEqual(result.matchedProposedEdgeIds.get('edge:proposed'), 'edge:observed');
		assert.deepStrictEqual(result.resolvedEdges[0], {
			id: 'edge:proposed',
			kind: 'contains',
			source: 'file:/project/index.ts',
			target: 'symbol:1'
		});
	});

	test('leaves an edge between two unmatched proposed nodes unmatched', () => {
		const result = matchEdges(
			[],
			[edge({ id: 'edge:proposed', kind: 'contains', source: 'proposed:a', target: 'proposed:b' })],
			new Map()
		);

		assert.strictEqual(result.matchedProposedEdgeIds.size, 0);
		assert.strictEqual(result.resolvedEdges[0].source, 'proposed:a');
	});
});

suite('reconcileProposedGraph', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	function proposedGraph(nodes: GraphNode[], edges: GraphEdge[] = []): CodeGraph {
		return { nodes, edges };
	}

	test('tags a proposed node matching existing code as matched, without touching its stored data', () => {
		store.upsertNode(
			{ id: 'symbol:1', kind: 'class', name: 'LoginService', filePath: '/project/loginService.ts', exported: true },
			'observed_only'
		);

		reconcileProposedGraph(
			store,
			proposedGraph([node({ id: 'proposed:class:LoginService', kind: 'class', name: 'LoginService', filePath: '/project/loginService.ts' })])
		);

		const matched = store.getNode('symbol:1');
		assert.strictEqual(matched?.status, 'matched');
		assert.strictEqual(matched?.exported, true);
		assert.strictEqual(store.getNode('proposed:class:LoginService'), undefined);
	});

	test('inserts a proposed node with no observed counterpart as proposed_only', () => {
		reconcileProposedGraph(store, proposedGraph([node({ id: 'proposed:module:billing', kind: 'module', name: 'billing' })]));

		assert.strictEqual(store.getNode('proposed:module:billing')?.status, 'proposed_only');
	});

	test('matches an edge once both its endpoints matched, and repoints an unmatched edge to the matched endpoint', () => {
		store.upsertNode({ id: 'file:/project/index.ts', kind: 'file', name: 'index.ts', filePath: '/project/index.ts' }, 'observed_only');
		store.upsertNode(
			{ id: 'symbol:1', kind: 'class', name: 'LoginService', filePath: '/project/index.ts' },
			'observed_only'
		);
		store.upsertEdge({ id: 'edge:contains', kind: 'contains', source: 'file:/project/index.ts', target: 'symbol:1' }, 'observed_only');

		reconcileProposedGraph(
			store,
			proposedGraph(
				[
					node({ id: 'file:/project/index.ts', kind: 'file', name: 'index.ts', filePath: '/project/index.ts' }),
					node({ id: 'proposed:class:LoginService', kind: 'class', name: 'LoginService', filePath: '/project/index.ts' }),
					node({ id: 'proposed:method:login', kind: 'method', name: 'login', filePath: '/project/index.ts' })
				],
				[
					edge({ id: 'edge:proposed-contains', kind: 'contains', source: 'file:/project/index.ts', target: 'proposed:class:LoginService' }),
					edge({ id: 'edge:proposed-method', kind: 'contains', source: 'proposed:class:LoginService', target: 'proposed:method:login' })
				]
			)
		);

		assert.strictEqual(store.getEdge('edge:contains')?.status, 'matched');
		assert.strictEqual(store.getEdge('edge:proposed-contains'), undefined);

		const repointed = store.getEdge('edge:proposed-method');
		assert.strictEqual(repointed?.status, 'proposed_only');
		assert.strictEqual(repointed?.source, 'symbol:1');
		assert.strictEqual(repointed?.target, 'proposed:method:login');
	});

	test('re-running with a new proposal resets stale matches back to observed_only instead of accumulating them', () => {
		store.upsertNode({ id: 'symbol:1', kind: 'class', name: 'A', filePath: '/project/a.ts' }, 'observed_only');
		store.upsertNode({ id: 'symbol:2', kind: 'class', name: 'B', filePath: '/project/b.ts' }, 'observed_only');

		reconcileProposedGraph(store, proposedGraph([node({ id: 'proposed:a', kind: 'class', name: 'A', filePath: '/project/a.ts' })]));
		assert.strictEqual(store.getNode('symbol:1')?.status, 'matched');

		reconcileProposedGraph(store, proposedGraph([node({ id: 'proposed:b', kind: 'class', name: 'B', filePath: '/project/b.ts' })]));

		assert.strictEqual(store.getNode('symbol:1')?.status, 'observed_only');
		assert.strictEqual(store.getNode('symbol:2')?.status, 'matched');
	});

	test('returns a summary of matched vs proposed_only counts', () => {
		store.upsertNode({ id: 'symbol:1', kind: 'class', name: 'A', filePath: '/project/a.ts' }, 'observed_only');

		const summary = reconcileProposedGraph(
			store,
			proposedGraph([
				node({ id: 'proposed:a', kind: 'class', name: 'A', filePath: '/project/a.ts' }),
				node({ id: 'proposed:b', kind: 'module', name: 'billing' })
			])
		);

		assert.strictEqual(summary.matchedNodeCount, 1);
		assert.strictEqual(summary.proposedOnlyNodeCount, 1);
		assert.strictEqual(summary.matchedEdgeCount, 0);
		assert.strictEqual(summary.proposedOnlyEdgeCount, 0);
	});
});
