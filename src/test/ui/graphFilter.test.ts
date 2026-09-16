import * as assert from 'assert';
import { StoredEdge, StoredGraph, StoredNode } from '../../core/store';
import { NodeKind } from '../../pipelines/model';
import { HIDDEN_NODE_KINDS, WORKFLOW_NODE_KINDS, filterGraphForWorkflow, isWorkflowNodeKind } from '../../ui/graphFilter';

function node(id: string, kind: NodeKind, name = id): StoredNode {
	return { id, kind, name, status: 'observed_only' };
}

function edge(id: string, source: string, target: string, kind: StoredEdge['kind'] = 'contains'): StoredEdge {
	return { id, kind, source, target, status: 'observed_only' };
}

suite('WORKFLOW_NODE_KINDS / HIDDEN_NODE_KINDS', () => {
	test('workflow kinds are exactly file, class, method, function', () => {
		assert.deepStrictEqual([...WORKFLOW_NODE_KINDS].sort(), ['class', 'file', 'function', 'method']);
	});

	test('hidden kinds are exactly the other seven NodeKinds', () => {
		assert.deepStrictEqual(
			[...HIDDEN_NODE_KINDS].sort(),
			['enum', 'externalModule', 'interface', 'module', 'property', 'typeAlias', 'variable'].sort()
		);
	});

	test('isWorkflowNodeKind agrees with both lists', () => {
		for (const kind of WORKFLOW_NODE_KINDS) {
			assert.strictEqual(isWorkflowNodeKind(kind), true);
		}
		for (const kind of HIDDEN_NODE_KINDS) {
			assert.strictEqual(isWorkflowNodeKind(kind), false);
		}
	});
});

suite('filterGraphForWorkflow', () => {
	test('keeps only workflow-relevant nodes', () => {
		const graph: StoredGraph = {
			nodes: [
				node('file:a', 'file'),
				node('class:C', 'class'),
				node('method:m', 'method'),
				node('function:f', 'function'),
				node('module:m', 'module'),
				node('external:lib', 'externalModule'),
				node('interface:I', 'interface'),
				node('property:p', 'property'),
				node('variable:v', 'variable'),
				node('enum:E', 'enum'),
				node('typeAlias:T', 'typeAlias')
			],
			edges: []
		};

		const filtered = filterGraphForWorkflow(graph);

		assert.deepStrictEqual(
			filtered.nodes.map((n) => n.id).sort(),
			['class:C', 'file:a', 'function:f', 'method:m'].sort()
		);
	});

	test('keeps an edge between two workflow-relevant nodes unchanged', () => {
		const graph: StoredGraph = {
			nodes: [node('file:a', 'file'), node('class:C', 'class')],
			edges: [edge('contains:1', 'file:a', 'class:C')]
		};

		const filtered = filterGraphForWorkflow(graph);

		assert.deepStrictEqual(filtered.edges, graph.edges);
	});

	test('drops an edge into a hidden dead end with no further edges', () => {
		const graph: StoredGraph = {
			nodes: [node('file:a', 'file'), node('variable:v', 'variable')],
			edges: [edge('contains:1', 'file:a', 'variable:v')]
		};

		assert.deepStrictEqual(filterGraphForWorkflow(graph).edges, []);
	});

	test('reroutes a single hidden hop: function -> variable -> function becomes function -> function', () => {
		const graph: StoredGraph = {
			nodes: [node('function:f1', 'function'), node('variable:v', 'variable'), node('function:f2', 'function')],
			edges: [
				edge('e1', 'function:f1', 'variable:v', 'imports'),
				edge('e2', 'variable:v', 'function:f2', 'exports')
			]
		};

		const filtered = filterGraphForWorkflow(graph);

		assert.strictEqual(filtered.edges.length, 1);
		const [rerouted] = filtered.edges;
		assert.strictEqual(rerouted.source, 'function:f1');
		assert.strictEqual(rerouted.target, 'function:f2');
		// Reroute inherits the *last* real edge's kind/status: the one that
		// actually lands on the workflow-relevant target.
		assert.strictEqual(rerouted.kind, 'exports');
	});

	test('reroutes a multi-hop chain of hidden nodes', () => {
		const graph: StoredGraph = {
			nodes: [
				node('file:a', 'file'),
				node('module:m', 'module'),
				node('typeAlias:t', 'typeAlias'),
				node('class:C', 'class')
			],
			edges: [
				edge('e1', 'file:a', 'module:m'),
				edge('e2', 'module:m', 'typeAlias:t'),
				edge('e3', 'typeAlias:t', 'class:C')
			]
		};

		const filtered = filterGraphForWorkflow(graph);

		assert.strictEqual(filtered.edges.length, 1);
		assert.strictEqual(filtered.edges[0].source, 'file:a');
		assert.strictEqual(filtered.edges[0].target, 'class:C');
	});

	test('fans out a hidden node with multiple outgoing edges into multiple rerouted edges', () => {
		const graph: StoredGraph = {
			nodes: [
				node('file:a', 'file'),
				node('module:m', 'module'),
				node('class:C1', 'class'),
				node('class:C2', 'class')
			],
			edges: [
				edge('e1', 'file:a', 'module:m'),
				edge('e2', 'module:m', 'class:C1'),
				edge('e3', 'module:m', 'class:C2')
			]
		};

		const filtered = filterGraphForWorkflow(graph);

		assert.deepStrictEqual(
			filtered.edges.map((e) => e.target).sort(),
			['class:C1', 'class:C2']
		);
		assert.ok(filtered.edges.every((e) => e.source === 'file:a'));
	});

	test('deduplicates rerouted edges reaching the same target through different hidden paths', () => {
		const graph: StoredGraph = {
			nodes: [
				node('file:a', 'file'),
				node('variable:v1', 'variable'),
				node('variable:v2', 'variable'),
				node('function:f', 'function')
			],
			edges: [
				edge('e1', 'file:a', 'variable:v1'),
				edge('e2', 'file:a', 'variable:v2'),
				edge('e3', 'variable:v1', 'function:f'),
				edge('e4', 'variable:v2', 'function:f')
			]
		};

		const filtered = filterGraphForWorkflow(graph);

		assert.strictEqual(filtered.edges.length, 1);
		assert.strictEqual(filtered.edges[0].source, 'file:a');
		assert.strictEqual(filtered.edges[0].target, 'function:f');
	});

	test('drops a rerouted edge that would become a self-loop', () => {
		const graph: StoredGraph = {
			nodes: [node('function:f', 'function'), node('variable:v', 'variable')],
			edges: [edge('e1', 'function:f', 'variable:v'), edge('e2', 'variable:v', 'function:f')]
		};

		assert.deepStrictEqual(filterGraphForWorkflow(graph).edges, []);
	});

	test('does not loop forever on a cycle among hidden nodes', () => {
		const graph: StoredGraph = {
			nodes: [node('file:a', 'file'), node('variable:v1', 'variable'), node('variable:v2', 'variable')],
			edges: [
				edge('e1', 'file:a', 'variable:v1'),
				edge('e2', 'variable:v1', 'variable:v2'),
				edge('e3', 'variable:v2', 'variable:v1')
			]
		};

		assert.deepStrictEqual(filterGraphForWorkflow(graph).edges, []);
	});

	test('keeps calls/extends/implements/instantiates edges between workflow-relevant nodes unchanged', () => {
		const graph: StoredGraph = {
			nodes: [node('function:f1', 'function'), node('function:f2', 'function'), node('class:C1', 'class'), node('class:C2', 'class')],
			edges: [
				edge('e1', 'function:f1', 'function:f2', 'calls'),
				edge('e2', 'class:C1', 'class:C2', 'extends'),
				edge('e3', 'function:f1', 'class:C1', 'instantiates')
			]
		};

		assert.deepStrictEqual(filterGraphForWorkflow(graph).edges, graph.edges);
	});

	test('drops an implements edge sourced from a hidden interface with no reachable workflow node', () => {
		const graph: StoredGraph = {
			nodes: [node('interface:A', 'interface'), node('interface:B', 'interface')],
			edges: [edge('e1', 'interface:A', 'interface:B', 'extends')]
		};

		assert.deepStrictEqual(filterGraphForWorkflow(graph).edges, []);
	});

	test('leaves an already fully workflow-relevant graph untouched', () => {
		const graph: StoredGraph = {
			nodes: [node('file:a', 'file'), node('class:C', 'class'), node('method:m', 'method')],
			edges: [edge('e1', 'file:a', 'class:C'), edge('e2', 'class:C', 'method:m')]
		};

		assert.deepStrictEqual(filterGraphForWorkflow(graph), graph);
	});
});
