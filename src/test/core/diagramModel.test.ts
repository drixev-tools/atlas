import * as assert from 'assert';
import { StoredEdge, StoredGraph, StoredNode } from '../../core/store';
import { aggregateEdgesByEndpoint, buildDiagramModel } from '../../core/diagramModel';
import { NodeKind } from '../../pipelines/model';

function node(id: string, kind: NodeKind, name = id, filePath?: string): StoredNode {
	return { id, kind, name, filePath, status: 'observed_only' };
}

function edge(id: string, kind: StoredEdge['kind'], source: string, target: string): StoredEdge {
	return { id, kind, source, target, status: 'observed_only' };
}

suite('aggregateEdgesByEndpoint', () => {
	test('collapses multiple edges between the same resolved pair, counted per kind', () => {
		const edges = [
			edge('e1', 'calls', 'a', 'b'),
			edge('e2', 'calls', 'a', 'b'),
			edge('e3', 'imports', 'a', 'b')
		];

		const result = aggregateEdgesByEndpoint(edges, (id) => id);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].source, 'a');
		assert.strictEqual(result[0].target, 'b');
		assert.deepStrictEqual(
			[...result[0].kinds].sort((x, y) => x.kind.localeCompare(y.kind)),
			[
				{ kind: 'calls', count: 2 },
				{ kind: 'imports', count: 1 }
			]
		);
	});

	test('drops an edge whose endpoint resolves to undefined', () => {
		const edges = [edge('e1', 'imports', 'a', 'external')];
		const result = aggregateEdgesByEndpoint(edges, (id) => (id === 'external' ? undefined : id));
		assert.deepStrictEqual(result, []);
	});

	test('drops a resolved self-edge', () => {
		const edges = [edge('e1', 'calls', 'method-a', 'method-b')];
		const result = aggregateEdgesByEndpoint(edges, () => 'group:same');
		assert.deepStrictEqual(result, []);
	});
});

suite('buildDiagramModel', () => {
	test('turns contains edges into parentId nesting instead of DiagramEdges', () => {
		const graph: StoredGraph = {
			nodes: [node('file:a', 'file', 'a.ts', '/project/a.ts'), node('class:C', 'class', 'C', '/project/a.ts')],
			edges: [edge('contains:1', 'contains', 'file:a', 'class:C')]
		};

		const { model } = buildDiagramModel(graph);

		assert.strictEqual(model.edges.length, 0);
		const classNode = model.nodes.find((n) => n.id === 'class:C');
		assert.strictEqual(classNode?.parentId, 'file:a');
	});

	test('aggregates non-contains edges and keeps externalModule nodes in the model', () => {
		const graph: StoredGraph = {
			nodes: [
				node('file:a', 'file', 'a.ts', '/project/a.ts'),
				node('external:vscode', 'externalModule', 'vscode')
			],
			edges: [edge('imports:1', 'imports', 'file:a', 'external:vscode')]
		};

		const { model } = buildDiagramModel(graph);

		assert.strictEqual(model.nodes.some((n) => n.id === 'external:vscode'), true);
		assert.strictEqual(model.edges.length, 1);
		assert.deepStrictEqual(model.edges[0].kinds, [{ kind: 'imports', count: 1 }]);
	});

	test('maps only file nodes into filePathsByNodeId, one entry per file', () => {
		const graph: StoredGraph = {
			nodes: [node('file:a', 'file', 'a.ts', '/project/a.ts'), node('func:f', 'function', 'f', '/project/a.ts')],
			edges: [edge('contains:1', 'contains', 'file:a', 'func:f')]
		};

		const { filePathsByNodeId } = buildDiagramModel(graph);

		assert.deepStrictEqual([...filePathsByNodeId.entries()], [['file:a', ['/project/a.ts']]]);
	});
});
