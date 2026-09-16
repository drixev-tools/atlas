import * as assert from 'assert';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { ProjectGraphStore } from '../../core/store';
import { detectEntryPoints } from '../../core/entryPoints';

function func(id: string, name: string, exported = true): GraphNode {
	return { id, kind: 'function', name, exported };
}

function method(id: string, name: string): GraphNode {
	return { id, kind: 'method', name };
}

function callEdge(id: string, source: string, target: string): GraphEdge {
	return { id, kind: 'calls', source, target };
}

suite('detectEntryPoints', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('finds an exported top-level function named activate', () => {
		store.upsertNode(func('func:activate', 'activate'));

		const entryPoints = detectEntryPoints(store);

		assert.deepStrictEqual(entryPoints, [{ nodeId: 'func:activate', kind: 'activate', name: 'activate', filePath: undefined }]);
	});

	test('ignores a non-exported function named activate', () => {
		store.upsertNode(func('func:activate', 'activate', false));
		assert.deepStrictEqual(detectEntryPoints(store), []);
	});

	test('treats a function called directly from activate as a registered command', () => {
		store.upsertNodes([func('func:activate', 'activate'), func('func:runAnalyze', 'runAnalyzeWorkspaceCommand')]);
		store.upsertEdge(callEdge('calls:1', 'func:activate', 'func:runAnalyze'));

		const entryPoints = detectEntryPoints(store);

		assert.deepStrictEqual(
			entryPoints.map((e) => [e.kind, e.nodeId]).sort(),
			[
				['activate', 'func:activate'],
				['command', 'func:runAnalyze']
			].sort()
		);
	});

	test('finds a top-level function named main', () => {
		store.upsertNode(func('func:main', 'main'));
		assert.deepStrictEqual(detectEntryPoints(store), [{ nodeId: 'func:main', kind: 'main', name: 'main', filePath: undefined }]);
	});

	test('finds a method named after a common HTTP verb', () => {
		store.upsertNode(method('method:get', 'get'));
		assert.deepStrictEqual(detectEntryPoints(store), [{ nodeId: 'method:get', kind: 'httpRoute', name: 'get', filePath: undefined }]);
	});

	test('matches HTTP verb names case-insensitively', () => {
		store.upsertNode(method('method:Post', 'Post'));
		assert.deepStrictEqual(detectEntryPoints(store).map((e) => e.kind), ['httpRoute']);
	});

	test('ignores an ordinary function/method that matches none of the heuristics', () => {
		store.upsertNodes([func('func:helper', 'formatDate'), method('method:helper', 'render')]);
		assert.deepStrictEqual(detectEntryPoints(store), []);
	});

	test('does not duplicate an entry point already found through another path', () => {
		store.upsertNodes([func('func:activate', 'activate'), func('func:main', 'main')]);
		store.upsertEdge(callEdge('calls:1', 'func:activate', 'func:main'));

		const entryPoints = detectEntryPoints(store);

		assert.strictEqual(entryPoints.filter((e) => e.nodeId === 'func:main' && e.kind === 'command').length, 1);
		assert.strictEqual(entryPoints.filter((e) => e.nodeId === 'func:main' && e.kind === 'main').length, 1);
	});
});
