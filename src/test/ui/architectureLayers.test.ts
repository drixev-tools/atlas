import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { ProjectGraphStore } from '../../core/store';
import {
	applyLayerNamingResults,
	buildArchitectureFileLevelData,
	buildArchitectureLayerData,
	hashMemberFilePaths,
	resolveCachedLayerLabels,
	toLayerNamingTargets
} from '../../ui/architectureLayers';

const ROOT = path.join('project');

function fileNode(relativePath: string): GraphNode {
	const filePath = path.join(ROOT, relativePath);
	return { id: `file:${relativePath}`, kind: 'file', name: path.basename(relativePath), filePath };
}

function symbolNode(id: string, filePath: string, kind: GraphNode['kind'] = 'function'): GraphNode {
	return { id, kind, name: id, filePath };
}

function edge(id: string, kind: GraphEdge['kind'], source: string, target: string): GraphEdge {
	return { id, kind, source, target };
}

suite('buildArchitectureLayerData', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('exposes one ArchitectureLayerGroup per group with metrics, and flags a group holding a detected entry point', () => {
		const uiFile = fileNode(path.join('ui', 'a.ts'));
		const activate: GraphNode = { id: 'func:activate', kind: 'function', name: 'activate', filePath: uiFile.filePath, exported: true };
		store.upsertNodes([uiFile, activate]);
		store.upsertEdge(edge('contains:1', 'contains', uiFile.id, activate.id));

		const graph = store.getGraph();
		const { model, groups, entryPointGroupIds } = buildArchitectureLayerData(store, graph, ROOT);

		assert.deepStrictEqual(groups.map((g) => g.groupId), ['group:ui']);
		assert.deepStrictEqual(groups[0].filePaths, [uiFile.filePath]);
		assert.ok(model.nodes.find((n) => n.id === 'group:ui')?.metrics);
		assert.deepStrictEqual(entryPointGroupIds, ['group:ui']);
	});
});

suite('buildArchitectureFileLevelData', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('restricts the file-level model to the given group and attaches metrics', () => {
		const uiFile = fileNode(path.join('ui', 'a.ts'));
		const coreFile = fileNode(path.join('core', 'b.ts'));
		store.upsertNodes([uiFile, coreFile]);

		const graph = store.getGraph();
		const { model } = buildArchitectureFileLevelData(store, graph, { groupId: 'group:ui', folderLabel: 'ui', filePaths: [uiFile.filePath as string] });

		assert.deepStrictEqual(model.nodes.map((n) => n.id), [uiFile.id]);
		assert.strictEqual(model.nodes[0].metrics?.fileCount, 1);
	});
});

suite('hashMemberFilePaths', () => {
	test('is stable regardless of input order', () => {
		assert.strictEqual(hashMemberFilePaths(['b', 'a']), hashMemberFilePaths(['a', 'b']));
	});

	test('differs when the file set differs', () => {
		assert.notStrictEqual(hashMemberFilePaths(['a']), hashMemberFilePaths(['a', 'b']));
	});
});

suite('resolveCachedLayerLabels', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('falls back to the folder name and marks the group stale when nothing is cached', () => {
		const group = { groupId: 'group:ui', folderLabel: 'ui', filePaths: ['a.ts'] };
		const { labelsByGroupId, staleGroups } = resolveCachedLayerLabels(store, [group]);

		assert.deepStrictEqual(labelsByGroupId.get('group:ui'), { label: 'ui', description: '', aiGenerated: false });
		assert.deepStrictEqual(staleGroups, [group]);
	});

	test('reuses a cached label whose hash still matches the group\'s file set, without marking it stale', () => {
		const group = { groupId: 'group:ui', folderLabel: 'ui', filePaths: ['a.ts'] };
		store.setLayerSummary('group:ui', { label: 'UI Layer', description: 'Renders things.', membersHash: hashMemberFilePaths(group.filePaths) });

		const { labelsByGroupId, staleGroups } = resolveCachedLayerLabels(store, [group]);

		assert.deepStrictEqual(labelsByGroupId.get('group:ui'), { label: 'UI Layer', description: 'Renders things.', aiGenerated: true });
		assert.deepStrictEqual(staleGroups, []);
	});

	test('serves a stale cached label while still queuing the group for a refresh', () => {
		const group = { groupId: 'group:ui', folderLabel: 'ui', filePaths: ['a.ts', 'b.ts'] };
		store.setLayerSummary('group:ui', { label: 'UI Layer', description: 'Old.', membersHash: hashMemberFilePaths(['a.ts']) });

		const { labelsByGroupId, staleGroups } = resolveCachedLayerLabels(store, [group]);

		assert.deepStrictEqual(labelsByGroupId.get('group:ui'), { label: 'UI Layer', description: 'Old.', aiGenerated: true });
		assert.deepStrictEqual(staleGroups, [group]);
	});
});

suite('toLayerNamingTargets', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('counts symbols per group from the given graph', () => {
		const uiFile = fileNode(path.join('ui', 'a.ts'));
		const func = symbolNode('func:1', uiFile.filePath as string);
		store.upsertNodes([uiFile, func]);

		const targets = toLayerNamingTargets(store.getGraph(), [{ groupId: 'group:ui', folderLabel: 'ui', filePaths: [uiFile.filePath as string] }]);

		assert.strictEqual(targets[0].symbolCount, 1);
		assert.deepStrictEqual(targets[0].fileNames, ['a.ts']);
	});
});

suite('applyLayerNamingResults', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('caches every named group and returns a patch limited to what was actually named', () => {
		const groups = [
			{ groupId: 'group:ui', folderLabel: 'ui', filePaths: ['a.ts'] },
			{ groupId: 'group:core', folderLabel: 'core', filePaths: ['b.ts'] }
		];

		const patch = applyLayerNamingResults(store, groups, [{ groupId: 'group:ui', label: 'UI Layer', description: 'Renders things.' }]);

		assert.deepStrictEqual([...patch.entries()], [['group:ui', { label: 'UI Layer', description: 'Renders things.', aiGenerated: true }]]);
		assert.deepStrictEqual(store.getLayerSummary('group:ui'), {
			label: 'UI Layer',
			description: 'Renders things.',
			membersHash: hashMemberFilePaths(['a.ts'])
		});
		assert.strictEqual(store.getLayerSummary('group:core'), undefined);
	});

	test('ignores a result naming a group outside the given list', () => {
		const patch = applyLayerNamingResults(store, [], [{ groupId: 'group:unknown', label: 'x', description: 'y' }]);
		assert.strictEqual(patch.size, 0);
	});
});
