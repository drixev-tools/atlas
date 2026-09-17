import * as assert from 'assert';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { ProjectGraphStore } from '../../core/store';
import { buildEntryPointFlowViewData, resolveFileFlowEntryPointId } from '../../ui/entryPointFlow';

function func(id: string, name: string, exported = true): GraphNode {
	return { id, kind: 'function', name, exported };
}

function file(id: string, filePath: string): GraphNode {
	return { id, kind: 'file', name: filePath, filePath };
}

function withFile(node: GraphNode, filePath: string): GraphNode {
	return { ...node, filePath };
}

function callEdge(id: string, source: string, target: string): GraphEdge {
	return { id, kind: 'calls', source, target };
}

suite('buildEntryPointFlowViewData', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('returns every detected entry point alongside the selected one\'s flow', () => {
		store.upsertNodes([func('func:activate', 'activate'), func('func:main', 'main'), func('func:helper', 'helper', false)]);
		store.upsertEdge(callEdge('calls:1', 'func:activate', 'func:helper'));

		const data = buildEntryPointFlowViewData(store, store.getGraph(), 'func:activate');

		// func:helper also shows up as a 'command' entry point (Epic M): anything
		// directly called from `activate` is treated as a registered command's
		// handler, see ../../core/entryPoints.
		assert.deepStrictEqual(
			data?.entryPoints.map((e) => e.nodeId).sort(),
			['func:activate', 'func:helper', 'func:main']
		);
		assert.strictEqual(data?.selectedEntryPointId, 'func:activate');
		assert.deepStrictEqual(data?.flow.nodes.map((n) => n.id).sort(), ['func:activate', 'func:helper']);
	});

	test('returns undefined when the selected entry point id is no longer in the graph', () => {
		store.upsertNode(func('func:activate', 'activate'));
		const data = buildEntryPointFlowViewData(store, store.getGraph(), 'func:gone');
		assert.strictEqual(data, undefined);
	});
});

suite('resolveFileFlowEntryPointId', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('returns undefined when the id is not a file node', () => {
		store.upsertNode(withFile(func('func:helper', 'helper'), 'a.ts'));
		assert.strictEqual(resolveFileFlowEntryPointId(store, store.getGraph(), 'func:helper'), undefined);
	});

	test('returns undefined when the file declares no functions/methods', () => {
		store.upsertNode(file('file:a', 'a.ts'));
		assert.strictEqual(resolveFileFlowEntryPointId(store, store.getGraph(), 'file:a'), undefined);
	});

	test("prefers the file's own detected entry point over any call-count heuristic", () => {
		store.upsertNodes([file('file:ext', 'extension.ts'), withFile(func('func:activate', 'activate'), 'extension.ts'), withFile(func('func:helper', 'helper', false), 'extension.ts')]);
		store.upsertEdge(callEdge('calls:1', 'func:helper', 'func:activate'));

		assert.strictEqual(resolveFileFlowEntryPointId(store, store.getGraph(), 'file:ext'), 'func:activate');
	});

	test('falls back to the function with the most outgoing calls when the file has no detected entry point', () => {
		store.upsertNodes([
			file('file:a', 'a.ts'),
			withFile(func('func:quiet', 'quiet', false), 'a.ts'),
			withFile(func('func:busy', 'busy', false), 'a.ts'),
			func('func:other', 'other', false)
		]);
		store.upsertEdge(callEdge('calls:1', 'func:busy', 'func:other'));
		store.upsertEdge(callEdge('calls:2', 'func:busy', 'func:quiet'));

		assert.strictEqual(resolveFileFlowEntryPointId(store, store.getGraph(), 'file:a'), 'func:busy');
	});
});
