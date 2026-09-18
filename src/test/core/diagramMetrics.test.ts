import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { AtlasStore } from '../../core/store';
import { buildDiagramModel } from '../../core/diagramModel';
import { computeDiagramMetrics, attachDiagramMetrics } from '../../core/diagramMetrics';

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

function makeFileNode(filePath: string): GraphNode {
	return { id: fileNodeId(filePath), kind: 'file', name: path.basename(filePath), filePath, language: 'typescript' };
}

function makeSymbolNode(id: string, filePath: string, kind: GraphNode['kind'] = 'function'): GraphNode {
	return { id, kind, name: id, filePath };
}

function makeEdge(id: string, kind: GraphEdge['kind'], source: string, target: string): GraphEdge {
	return { id, kind, source, target };
}

suite('computeDiagramMetrics', () => {
	let store: AtlasStore;

	setup(async () => {
		store = await AtlasStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('fileCount/symbolCount count files and contained symbols under a node', () => {
		const a = path.join('/project', 'a.ts');
		const funcA1 = makeSymbolNode('func:a1', a);
		const funcA2 = makeSymbolNode('func:a2', a);

		store.upsertNodes([makeFileNode(a), funcA1, funcA2]);
		store.upsertEdges([makeEdge('contains:1', 'contains', fileNodeId(a), funcA1.id), makeEdge('contains:2', 'contains', fileNodeId(a), funcA2.id)]);

		const graph = store.getGraph();
		const { model, filePathsByNodeId } = buildDiagramModel(graph);
		const metrics = computeDiagramMetrics(store, graph, model, filePathsByNodeId);

		const fileMetrics = metrics.get(fileNodeId(a));
		assert.strictEqual(fileMetrics?.fileCount, 1);
		assert.strictEqual(fileMetrics?.symbolCount, 2);
	});

	test('fanIn/fanOut count distinct neighbors, not raw edge occurrences', () => {
		const a = path.join('/project', 'a.ts');
		const b = path.join('/project', 'b.ts');
		const c = path.join('/project', 'c.ts');

		store.upsertNodes([makeFileNode(a), makeFileNode(b), makeFileNode(c)]);
		store.upsertEdges([
			makeEdge('imports:1', 'imports', fileNodeId(a), fileNodeId(b)),
			makeEdge('imports:2', 'imports', fileNodeId(a), fileNodeId(b)),
			makeEdge('imports:3', 'imports', fileNodeId(c), fileNodeId(b))
		]);

		const graph = store.getGraph();
		const { model, filePathsByNodeId } = buildDiagramModel(graph);
		const metrics = computeDiagramMetrics(store, graph, model, filePathsByNodeId);

		assert.strictEqual(metrics.get(fileNodeId(a))?.fanOut, 1);
		assert.strictEqual(metrics.get(fileNodeId(b))?.fanIn, 2);
		assert.strictEqual(metrics.get(fileNodeId(b))?.fanOut, 0);
	});

	test('externalDependencies tallies edges from member nodes to externalModule nodes', () => {
		const a = path.join('/project', 'a.ts');
		store.upsertNodes([makeFileNode(a), { id: 'external:vscode', kind: 'externalModule', name: 'vscode' }]);
		store.upsertEdges([
			makeEdge('imports:1', 'imports', fileNodeId(a), 'external:vscode'),
			makeEdge('imports:2', 'imports', fileNodeId(a), 'external:vscode')
		]);

		const graph = store.getGraph();
		const { model, filePathsByNodeId } = buildDiagramModel(graph);
		const metrics = computeDiagramMetrics(store, graph, model, filePathsByNodeId);

		assert.deepStrictEqual(metrics.get(fileNodeId(a))?.externalDependencies, [{ name: 'vscode', count: 2 }]);
	});

	test('testLinks reuses findRelatedTestFiles instead of reimplementing test discovery', () => {
		const math = path.join('/project', 'math.ts');
		const mathTest = path.join('/project', 'math.test.ts');
		store.upsertNodes([makeFileNode(math), makeFileNode(mathTest)]);
		store.upsertEdge(makeEdge('imports:1', 'imports', fileNodeId(mathTest), fileNodeId(math)));

		const graph = store.getGraph();
		const { model, filePathsByNodeId } = buildDiagramModel(graph);
		const metrics = computeDiagramMetrics(store, graph, model, filePathsByNodeId);

		assert.deepStrictEqual(metrics.get(fileNodeId(math))?.testLinks, [mathTest]);
	});

	test('changedFileCount reflects the provided changedFiles list', () => {
		const a = path.join('/project', 'a.ts');
		const b = path.join('/project', 'b.ts');
		store.upsertNodes([makeFileNode(a), makeFileNode(b)]);

		const graph = store.getGraph();
		const { model, filePathsByNodeId } = buildDiagramModel(graph);
		const metrics = computeDiagramMetrics(store, graph, model, filePathsByNodeId, { changedFiles: [a] });

		assert.strictEqual(metrics.get(fileNodeId(a))?.changedFileCount, 1);
		assert.strictEqual(metrics.get(fileNodeId(b))?.changedFileCount, 0);
	});
});

suite('attachDiagramMetrics', () => {
	test('merges metrics into matching nodes and leaves the rest untouched', () => {
		const model = { nodes: [{ id: 'file:a', kind: 'file' as const, label: 'a.ts' }, { id: 'group:x', kind: 'group' as const, label: 'x' }], edges: [] };
		const metricsByNodeId = new Map([
			['file:a', { fileCount: 1, symbolCount: 0, fanIn: 0, fanOut: 0, externalDependencies: [], testLinks: [], changedFileCount: 0 }]
		]);

		const result = attachDiagramMetrics(model, metricsByNodeId);

		assert.strictEqual(result.nodes.find((n) => n.id === 'file:a')?.metrics?.fileCount, 1);
		assert.strictEqual(result.nodes.find((n) => n.id === 'group:x')?.metrics, undefined);
	});
});
