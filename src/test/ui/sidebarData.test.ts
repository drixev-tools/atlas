import * as assert from 'assert';
import { StoredEdge, StoredGraph, StoredNode } from '../../core/store';
import { NodeKind } from '../../pipelines/model';
import { buildProjectFileTree, FileOrSymbolTreeNode, FolderTreeNode } from '../../ui/sidebarData';

function fileNode(id: string, filePath: string): StoredNode {
	return { id, kind: 'file', name: filePath.split('/').pop() as string, filePath, status: 'observed_only' };
}

function symbolNode(id: string, name: string, filePath: string, kind: NodeKind, startLine: number): StoredNode {
	return {
		id,
		kind,
		name,
		filePath,
		range: { startLine, startColumn: 1, endLine: startLine, endColumn: name.length + 1 },
		status: 'observed_only'
	};
}

function containsEdge(source: string, target: string): StoredEdge {
	return { id: `contains:${source}:${target}`, kind: 'contains', source, target, status: 'observed_only' };
}

function asFolder(node: FolderTreeNode | FileOrSymbolTreeNode): FolderTreeNode {
	assert.strictEqual(node.kind, 'folder');
	return node as FolderTreeNode;
}

function asFile(node: FolderTreeNode | FileOrSymbolTreeNode): FileOrSymbolTreeNode {
	assert.strictEqual(node.kind, 'node');
	return node as FileOrSymbolTreeNode;
}

suite('buildProjectFileTree', () => {
	test('returns an empty array for a graph with no file nodes', () => {
		assert.deepStrictEqual(buildProjectFileTree({ nodes: [], edges: [] }), []);
	});

	test('groups files into nested folders relative to rootDir, folders sorted before files, both alphabetically', () => {
		const graph: StoredGraph = {
			nodes: [
				fileNode('file:readme', '/project/README.md'),
				fileNode('file:store', '/project/src/core/store.ts'),
				fileNode('file:panel', '/project/src/ui/graphPanel.ts')
			],
			edges: []
		};

		const tree = buildProjectFileTree(graph, '/project');

		assert.strictEqual(tree.length, 2);
		const srcFolder = asFolder(tree[0]);
		assert.strictEqual(srcFolder.label, 'src');
		assert.strictEqual(asFile(tree[1]).node.id, 'file:readme');

		assert.strictEqual(srcFolder.children.length, 2);
		assert.deepStrictEqual(srcFolder.children.map((child) => asFolder(child).label), ['core', 'ui']);
		assert.deepStrictEqual(
			srcFolder.children.map((child) => asFile(asFolder(child).children[0]).node.id),
			['file:store', 'file:panel']
		);
	});

	test('reuses the same folder node for sibling files under the same directory', () => {
		const graph: StoredGraph = {
			nodes: [fileNode('file:a', '/project/src/a.ts'), fileNode('file:b', '/project/src/b.ts')],
			edges: []
		};

		const tree = buildProjectFileTree(graph, '/project');

		assert.strictEqual(tree.length, 1);
		const srcFolder = asFolder(tree[0]);
		assert.strictEqual(srcFolder.children.length, 2);
		assert.deepStrictEqual(srcFolder.children.map((child) => asFile(child).node.id), ['file:a', 'file:b']);
	});

	test("nests a file's contains children as symbols, sorted by source position rather than alphabetically", () => {
		const filePath = '/project/math.ts';
		const graph: StoredGraph = {
			nodes: [
				fileNode('file:math', filePath),
				symbolNode('symbol:subtract', 'subtract', filePath, 'function', 5),
				symbolNode('symbol:add', 'add', filePath, 'function', 1)
			],
			edges: [containsEdge('file:math', 'symbol:subtract'), containsEdge('file:math', 'symbol:add')]
		};

		const tree = buildProjectFileTree(graph, '/project');
		const fileEntry = asFile(tree[0]);

		assert.deepStrictEqual(
			fileEntry.children.map((child) => asFile(child).node.name),
			['add', 'subtract']
		);
	});

	test("nests contains children recursively, e.g. a class's methods under the class", () => {
		const filePath = '/project/shape.ts';
		const graph: StoredGraph = {
			nodes: [
				fileNode('file:shape', filePath),
				symbolNode('symbol:Shape', 'Shape', filePath, 'class', 1),
				symbolNode('symbol:area', 'area', filePath, 'method', 2)
			],
			edges: [containsEdge('file:shape', 'symbol:Shape'), containsEdge('symbol:Shape', 'symbol:area')]
		};

		const tree = buildProjectFileTree(graph, '/project');
		const classEntry = asFile(asFile(tree[0]).children[0]);

		assert.strictEqual(classEntry.node.name, 'Shape');
		assert.strictEqual(classEntry.children.length, 1);
		assert.strictEqual(asFile(classEntry.children[0]).node.name, 'area');
	});

	test("falls back to the file's own absolute path segments when rootDir is omitted", () => {
		const graph: StoredGraph = { nodes: [fileNode('file:index', '/work/app/index.ts')], edges: [] };

		const tree = buildProjectFileTree(graph);

		const workFolder = asFolder(tree[0]);
		assert.strictEqual(workFolder.label, 'work');
		const appFolder = asFolder(workFolder.children[0]);
		assert.strictEqual(appFolder.label, 'app');
		assert.strictEqual(asFile(appFolder.children[0]).node.id, 'file:index');
	});

	test('falls back to absolute segments for a file outside rootDir', () => {
		const graph: StoredGraph = { nodes: [fileNode('file:outside', '/elsewhere/outside.ts')], edges: [] };

		const tree = buildProjectFileTree(graph, '/project');

		const elsewhereFolder = asFolder(tree[0]);
		assert.strictEqual(elsewhereFolder.label, 'elsewhere');
		assert.strictEqual(asFile(elsewhereFolder.children[0]).node.id, 'file:outside');
	});

	test('ignores contains edges whose target node is not in the graph', () => {
		const filePath = '/project/math.ts';
		const graph: StoredGraph = {
			nodes: [fileNode('file:math', filePath)],
			edges: [containsEdge('file:math', 'symbol:missing')]
		};

		const tree = buildProjectFileTree(graph, '/project');

		assert.deepStrictEqual(asFile(tree[0]).children, []);
	});
});
