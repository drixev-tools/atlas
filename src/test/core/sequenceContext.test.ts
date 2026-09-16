import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { ProjectGraphStore } from '../../core/store';
import { buildSequenceContext } from '../../core/sequenceContext';

function fileNode(id: string, filePath: string): GraphNode {
	return { id, kind: 'file', name: path.basename(filePath), filePath, language: 'typescript' };
}

function functionNode(id: string, name: string, filePath: string): GraphNode {
	return { id, kind: 'function', name, filePath, language: 'typescript' };
}

function importEdge(sourceId: string, targetId: string): GraphEdge {
	return { id: `imports:${sourceId}:${targetId}`, kind: 'imports', source: sourceId, target: targetId };
}

function containsEdge(sourceId: string, targetId: string): GraphEdge {
	return { id: `contains:${sourceId}:${targetId}`, kind: 'contains', source: sourceId, target: targetId };
}

suite('buildSequenceContext', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('returns undefined for a node kind outside function/file', async () => {
		store.upsertNodes([{ id: 'class:foo', kind: 'class', name: 'Foo', filePath: '/project/a.ts' }]);
		assert.strictEqual(buildSequenceContext(store, 'class:foo'), undefined);
	});

	test('returns undefined for an id not in the graph', () => {
		assert.strictEqual(buildSequenceContext(store, 'file:missing.ts'), undefined);
	});

	test('a file target: callers/callees come from direct imports, siblings from its own contains edges', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			fileNode('file:b.ts', '/project/b.ts'),
			fileNode('file:c.ts', '/project/c.ts'),
			functionNode('fn:foo', 'foo', '/project/a.ts')
		]);
		store.upsertEdges([importEdge('file:b.ts', 'file:a.ts'), importEdge('file:a.ts', 'file:c.ts'), containsEdge('file:a.ts', 'fn:foo')]);

		const context = buildSequenceContext(store, 'file:a.ts');

		assert.strictEqual(context?.target.name, 'a.ts');
		assert.deepStrictEqual(context?.callers.map((p) => p.id), ['file:b.ts']);
		assert.deepStrictEqual(context?.callees.map((p) => p.id), ['file:c.ts']);
		assert.deepStrictEqual(context?.siblings.map((p) => p.id), ['fn:foo']);
	});

	test('a function target: uses its containing file for callers/callees, excludes itself from siblings', () => {
		const resolvedId = (filePath: string): string => `file:${path.resolve(filePath)}`;
		const aPath = path.join('project', 'a.ts');
		const bPath = path.join('project', 'b.ts');
		const cPath = path.join('project', 'c.ts');

		store.upsertNodes([
			fileNode(resolvedId(aPath), aPath),
			fileNode(resolvedId(bPath), bPath),
			fileNode(resolvedId(cPath), cPath),
			functionNode('fn:foo', 'foo', aPath),
			functionNode('fn:qux', 'qux', aPath)
		]);
		store.upsertEdges([
			importEdge(resolvedId(bPath), resolvedId(aPath)),
			importEdge(resolvedId(aPath), resolvedId(cPath)),
			containsEdge(resolvedId(aPath), 'fn:foo'),
			containsEdge(resolvedId(aPath), 'fn:qux')
		]);

		const context = buildSequenceContext(store, 'fn:foo');

		assert.strictEqual(context?.target.name, 'foo');
		assert.deepStrictEqual(context?.callers.map((p) => p.id), [resolvedId(bPath)]);
		assert.deepStrictEqual(context?.callees.map((p) => p.id), [resolvedId(cPath)]);
		assert.deepStrictEqual(context?.siblings.map((p) => p.id), ['fn:qux']);
	});

	test('only follows direct (maxDepth 1) imports, not transitive ones', () => {
		store.upsertNodes([fileNode('file:a.ts', '/project/a.ts'), fileNode('file:b.ts', '/project/b.ts'), fileNode('file:c.ts', '/project/c.ts')]);
		store.upsertEdges([importEdge('file:a.ts', 'file:b.ts'), importEdge('file:b.ts', 'file:c.ts')]);

		const context = buildSequenceContext(store, 'file:a.ts');

		assert.deepStrictEqual(context?.callees.map((p) => p.id), ['file:b.ts']);
	});
});
