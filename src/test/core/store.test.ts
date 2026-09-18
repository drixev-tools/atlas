import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { AtlasStore } from '../../core/store';

function makeFileNode(id: string, name: string): GraphNode {
	return { id, kind: 'file', name, filePath: `/project/${name}`, language: 'typescript' };
}

function makeFunctionNode(id: string, name: string, filePath: string): GraphNode {
	return {
		id,
		kind: 'function',
		name,
		filePath,
		exported: true,
		range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 2 },
		metadata: { async: false }
	};
}

function makeContainsEdge(id: string, source: string, target: string): GraphEdge {
	return { id, kind: 'contains', source, target };
}

suite('AtlasStore: CRUD', () => {
	let store: AtlasStore;

	setup(async () => {
		store = await AtlasStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('upserts and retrieves a node, round-tripping range, exported, and metadata', () => {
		const fn = makeFunctionNode('symbol:1', 'run', '/project/index.ts');
		store.upsertNode(fn);

		const stored = store.getNode('symbol:1');
		assert.ok(stored);
		assert.strictEqual(stored?.name, 'run');
		assert.strictEqual(stored?.exported, true);
		assert.deepStrictEqual(stored?.range, fn.range);
		assert.deepStrictEqual(stored?.metadata, { async: false });
		assert.strictEqual(stored?.status, 'observed_only');
	});

	test('defaults a node without a range/metadata to undefined fields, not null placeholders', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		const stored = store.getNode('file:1');
		assert.strictEqual(stored?.range, undefined);
		assert.strictEqual(stored?.metadata, undefined);
	});

	test('upserting a node with the same id updates it in place rather than duplicating', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.upsertNode({ ...makeFileNode('file:1', 'index.ts'), name: 'renamed.ts' });

		assert.strictEqual(store.listNodes().length, 1);
		assert.strictEqual(store.getNode('file:1')?.name, 'renamed.ts');
	});

	test('accepts an explicit status and allows changing it later', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'), 'proposed_only');
		assert.strictEqual(store.getNode('file:1')?.status, 'proposed_only');

		store.setNodeStatus('file:1', 'matched');
		assert.strictEqual(store.getNode('file:1')?.status, 'matched');
	});

	test('lists nodes filtered by kind, status, and filePath', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.upsertNode(makeFunctionNode('symbol:1', 'run', '/project/index.ts'));
		store.upsertNode(makeFunctionNode('symbol:2', 'helper', '/project/other.ts'), 'proposed_only');

		assert.strictEqual(store.listNodes({ kind: 'function' }).length, 2);
		assert.strictEqual(store.listNodes({ status: 'proposed_only' }).length, 1);
		assert.strictEqual(store.listNodes({ filePath: '/project/index.ts' }).length, 2);
	});

	test('deletes a node', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.deleteNode('file:1');
		assert.strictEqual(store.getNode('file:1'), undefined);
	});

	test('upserts and retrieves an edge with metadata, and supports directional lookups', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.upsertNode(makeFunctionNode('symbol:1', 'run', '/project/index.ts'));
		store.upsertEdge({ ...makeContainsEdge('edge:1', 'file:1', 'symbol:1'), metadata: { note: 'test' } });

		const stored = store.getEdge('edge:1');
		assert.ok(stored);
		assert.strictEqual(stored?.source, 'file:1');
		assert.strictEqual(stored?.target, 'symbol:1');
		assert.deepStrictEqual(stored?.metadata, { note: 'test' });

		assert.strictEqual(store.getEdgesForNode('file:1', 'out').length, 1);
		assert.strictEqual(store.getEdgesForNode('symbol:1', 'in').length, 1);
		assert.strictEqual(store.getEdgesForNode('file:1', 'in').length, 0);
		assert.strictEqual(store.getEdgesForNode('symbol:1', 'both').length, 1);
	});

	test('deletes an edge', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.upsertNode(makeFunctionNode('symbol:1', 'run', '/project/index.ts'));
		store.upsertEdge(makeContainsEdge('edge:1', 'file:1', 'symbol:1'));

		store.deleteEdge('edge:1');
		assert.strictEqual(store.getEdge('edge:1'), undefined);
	});

	test('getGraph returns the pipeline-agnostic CodeGraph shape, optionally filtered by status', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.upsertNode(makeFunctionNode('symbol:1', 'run', '/project/index.ts'), 'proposed_only');
		store.upsertEdge(makeContainsEdge('edge:1', 'file:1', 'symbol:1'), 'proposed_only');

		const fullGraph = store.getGraph();
		assert.strictEqual(fullGraph.nodes.length, 2);
		assert.strictEqual(fullGraph.edges.length, 1);

		const proposedOnly = store.getGraph({ status: 'proposed_only' });
		assert.strictEqual(proposedOnly.nodes.length, 1);
		assert.strictEqual(proposedOnly.edges.length, 1);
	});

	test('clear empties both tables', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.upsertNode(makeFunctionNode('symbol:1', 'run', '/project/index.ts'));
		store.upsertEdge(makeContainsEdge('edge:1', 'file:1', 'symbol:1'));

		store.clear();

		assert.strictEqual(store.listNodes().length, 0);
		assert.strictEqual(store.listEdges().length, 0);
	});

	test('getLayerSummary returns undefined until one is set, then round-trips it', () => {
		assert.strictEqual(store.getLayerSummary('group:ui'), undefined);

		store.setLayerSummary('group:ui', { label: 'UI Layer', description: 'Renders the graph.', membersHash: 'abc' });

		assert.deepStrictEqual(store.getLayerSummary('group:ui'), { label: 'UI Layer', description: 'Renders the graph.', membersHash: 'abc' });
	});

	test('setLayerSummary for an existing group id updates it in place rather than duplicating', () => {
		store.setLayerSummary('group:ui', { label: 'UI Layer', description: 'Old.', membersHash: 'abc' });
		store.setLayerSummary('group:ui', { label: 'UI Layer', description: 'New.', membersHash: 'def' });

		assert.deepStrictEqual(store.getLayerSummary('group:ui'), { label: 'UI Layer', description: 'New.', membersHash: 'def' });
	});

	test('getIdentifiedArchitecture returns undefined until one is set, then round-trips it', () => {
		assert.strictEqual(store.getIdentifiedArchitecture(), undefined);

		store.setIdentifiedArchitecture({
			patternName: 'Layered Architecture',
			patternDescription: 'Controllers call services.',
			roles: [{ role: 'Controller', description: 'Handles requests.' }],
			assignments: [{ groupId: 'group:controllers', role: 'Controller' }],
			entitiesHash: 'abc'
		});

		assert.deepStrictEqual(store.getIdentifiedArchitecture(), {
			patternName: 'Layered Architecture',
			patternDescription: 'Controllers call services.',
			roles: [{ role: 'Controller', description: 'Handles requests.' }],
			assignments: [{ groupId: 'group:controllers', role: 'Controller' }],
			entitiesHash: 'abc'
		});
	});

	test('setIdentifiedArchitecture updates the single cached row in place rather than duplicating', () => {
		store.setIdentifiedArchitecture({ patternName: 'A', patternDescription: 'a', roles: [], assignments: [], entitiesHash: 'abc' });
		store.setIdentifiedArchitecture({ patternName: 'B', patternDescription: 'b', roles: [], assignments: [], entitiesHash: 'def' });

		assert.strictEqual(store.getIdentifiedArchitecture()?.patternName, 'B');
	});

	test('clearByStatus removes only the matching status, leaving the rest of the graph intact', () => {
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.upsertNode(makeFunctionNode('symbol:1', 'run', '/project/index.ts'), 'proposed_only');
		store.upsertEdge(makeContainsEdge('edge:1', 'file:1', 'symbol:1'), 'proposed_only');

		store.clearByStatus('proposed_only');

		assert.strictEqual(store.getNode('file:1')?.status, 'observed_only');
		assert.strictEqual(store.getNode('symbol:1'), undefined);
		assert.strictEqual(store.getEdge('edge:1'), undefined);
	});
});

suite('AtlasStore: file persistence', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-store-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('save writes a database file that a later open can reload', async () => {
		const dbPath = path.join(tmpDir, 'atlas.sqlite');

		const store = await AtlasStore.open({ filePath: dbPath });
		store.upsertNode(makeFileNode('file:1', 'index.ts'));
		store.save();
		store.close();

		assert.ok(fs.existsSync(dbPath));

		const reopened = await AtlasStore.open({ filePath: dbPath });
		assert.strictEqual(reopened.getNode('file:1')?.name, 'index.ts');
		reopened.close();
	});

	test('save throws when no filePath was ever provided', async () => {
		const store = await AtlasStore.open();
		assert.throws(() => store.save());
		store.close();
	});
});
