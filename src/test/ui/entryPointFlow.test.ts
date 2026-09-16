import * as assert from 'assert';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { ProjectGraphStore } from '../../core/store';
import { buildEntryPointFlowViewData } from '../../ui/entryPointFlow';

function func(id: string, name: string, exported = true): GraphNode {
	return { id, kind: 'function', name, exported };
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
