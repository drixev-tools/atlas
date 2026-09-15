import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { ProjectGraphStore } from '../../core/store';
import { getStructuralConsumers, getStructuralConsumersForFile, getStructuralDependencies, getStructuralDependenciesForFile } from '../../core/impact';

function makeFileNode(name: string): GraphNode {
	return { id: `file:${name}`, kind: 'file', name, filePath: `/project/${name}`, language: 'typescript' };
}

function makeImportEdge(sourceName: string, targetName: string): GraphEdge {
	return { id: `imports:${sourceName}:${targetName}`, kind: 'imports', source: `file:${sourceName}`, target: `file:${targetName}` };
}

suite('impact: structural dependencies/consumers', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
		// a.ts -> b.ts -> c.ts (import chain)
		store.upsertNodes([makeFileNode('a.ts'), makeFileNode('b.ts'), makeFileNode('c.ts')]);
		store.upsertEdges([makeImportEdge('a.ts', 'b.ts'), makeImportEdge('b.ts', 'c.ts')]);
	});

	teardown(() => {
		store.close();
	});

	test('getStructuralDependencies walks outgoing imports transitively, excluding the start node', () => {
		const deps = getStructuralDependencies(store, 'file:a.ts');
		assert.deepStrictEqual(
			deps.map((n) => n.id).sort(),
			['file:b.ts', 'file:c.ts']
		);
	});

	test('getStructuralConsumers walks incoming imports transitively, excluding the start node', () => {
		const consumers = getStructuralConsumers(store, 'file:c.ts');
		assert.deepStrictEqual(
			consumers.map((n) => n.id).sort(),
			['file:a.ts', 'file:b.ts']
		);
	});

	test('a leaf dependency has no further dependencies', () => {
		assert.deepStrictEqual(getStructuralDependencies(store, 'file:c.ts'), []);
	});

	test('a root consumer has no further consumers', () => {
		assert.deepStrictEqual(getStructuralConsumers(store, 'file:a.ts'), []);
	});

	test('maxDepth limits how many import hops are followed', () => {
		const deps = getStructuralDependencies(store, 'file:a.ts', { maxDepth: 1 });
		assert.deepStrictEqual(
			deps.map((n) => n.id),
			['file:b.ts']
		);
	});

	test('does not loop forever on a dependency cycle', () => {
		store.upsertEdge(makeImportEdge('c.ts', 'a.ts'));
		const deps = getStructuralDependencies(store, 'file:a.ts');
		assert.deepStrictEqual(
			deps.map((n) => n.id).sort(),
			['file:b.ts', 'file:c.ts']
		);
	});

	test('the *ForFile helpers resolve from a file path instead of a raw node id', async () => {
		const fileStore = await ProjectGraphStore.open();
		try {
			const resolvedFileNodeId = (filePath: string): string => `file:${path.resolve(filePath)}`;
			const paths = { a: path.join('project', 'a.ts'), b: path.join('project', 'b.ts'), c: path.join('project', 'c.ts') };

			fileStore.upsertNodes(
				Object.values(paths).map((filePath) => ({
					id: resolvedFileNodeId(filePath),
					kind: 'file',
					name: path.basename(filePath),
					filePath,
					language: 'typescript'
				}))
			);
			fileStore.upsertEdges([
				{ id: 'e1', kind: 'imports', source: resolvedFileNodeId(paths.a), target: resolvedFileNodeId(paths.b) },
				{ id: 'e2', kind: 'imports', source: resolvedFileNodeId(paths.b), target: resolvedFileNodeId(paths.c) }
			]);

			assert.deepStrictEqual(
				getStructuralDependenciesForFile(fileStore, paths.a).map((n) => n.id).sort(),
				[resolvedFileNodeId(paths.b), resolvedFileNodeId(paths.c)].sort()
			);
			assert.deepStrictEqual(
				getStructuralConsumersForFile(fileStore, paths.c).map((n) => n.id).sort(),
				[resolvedFileNodeId(paths.a), resolvedFileNodeId(paths.b)].sort()
			);
		} finally {
			fileStore.close();
		}
	});
});
