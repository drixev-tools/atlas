import * as assert from 'assert';
import * as path from 'path';
import { StoredEdge, StoredGraph, StoredNode } from '../../core/store';
import { aggregateDiagramModelByFile, aggregateDiagramModelByFolder } from '../../core/moduleAggregation';
import { NodeKind } from '../../pipelines/model';

const ROOT = path.join('project');

function node(id: string, kind: NodeKind, name: string, filePath?: string): StoredNode {
	return { id, kind, name, filePath, status: 'observed_only' };
}

function edge(id: string, kind: StoredEdge['kind'], source: string, target: string): StoredEdge {
	return { id, kind, source, target, status: 'observed_only' };
}

function fileNode(relativePath: string): StoredNode {
	const filePath = path.join(ROOT, relativePath);
	return node(`file:${relativePath}`, 'file', path.basename(relativePath), filePath);
}

suite('aggregateDiagramModelByFolder', () => {
	test('groups files under their folder at the configured depth', () => {
		const graph: StoredGraph = {
			nodes: [fileNode(path.join('ui', 'a.ts')), fileNode(path.join('ui', 'b.ts')), fileNode(path.join('core', 'c.ts'))],
			edges: []
		};

		const { model, filePathsByNodeId } = aggregateDiagramModelByFolder(graph, { rootDir: ROOT, depth: 1 });

		assert.deepStrictEqual(
			model.nodes.map((n) => n.id).sort(),
			['group:core', 'group:ui'].sort()
		);
		assert.deepStrictEqual(
			[...(filePathsByNodeId.get('group:ui') ?? [])].sort(),
			[path.join(ROOT, 'ui', 'a.ts'), path.join(ROOT, 'ui', 'b.ts')].sort()
		);
		assert.deepStrictEqual(filePathsByNodeId.get('group:core'), [path.join(ROOT, 'core', 'c.ts')]);
	});

	test('nests deeper folder levels under their parent group up to the configured depth', () => {
		const graph: StoredGraph = { nodes: [fileNode(path.join('src', 'core', 'store.ts'))], edges: [] };

		const { model, filePathsByNodeId } = aggregateDiagramModelByFolder(graph, { rootDir: ROOT, depth: 2 });

		const src = model.nodes.find((n) => n.id === 'group:src');
		const srcCore = model.nodes.find((n) => n.id === 'group:src/core');
		assert.strictEqual(src?.parentId, undefined);
		assert.strictEqual(srcCore?.parentId, 'group:src');
		assert.deepStrictEqual(filePathsByNodeId.get('group:src'), undefined);
		assert.deepStrictEqual(filePathsByNodeId.get('group:src/core'), [path.join(ROOT, 'src', 'core', 'store.ts')]);
	});

	test('files with no folder land in a single synthetic root group', () => {
		const graph: StoredGraph = { nodes: [fileNode('extension.ts')], edges: [] };
		const { model, filePathsByNodeId } = aggregateDiagramModelByFolder(graph, { rootDir: ROOT, depth: 2 });

		assert.deepStrictEqual(model.nodes.map((n) => n.id), ['group:.']);
		assert.deepStrictEqual(filePathsByNodeId.get('group:.'), [path.join(ROOT, 'extension.ts')]);
	});

	test('aggregates a symbol-to-symbol edge into a single group-pair DiagramEdge, dropping self edges', () => {
		const uiFile = fileNode(path.join('ui', 'a.ts'));
		const coreFile = fileNode(path.join('core', 'b.ts'));
		const uiFunc = node('func:ui', 'function', 'render', uiFile.filePath);
		const coreFunc = node('func:core', 'function', 'run', coreFile.filePath);
		const coreFunc2 = node('func:core2', 'function', 'run2', coreFile.filePath);

		const graph: StoredGraph = {
			nodes: [uiFile, coreFile, uiFunc, coreFunc, coreFunc2],
			edges: [
				edge('calls:1', 'calls', uiFunc.id, coreFunc.id),
				edge('calls:2', 'calls', uiFunc.id, coreFunc2.id),
				edge('imports:1', 'imports', uiFile.id, coreFile.id),
				edge('calls:self', 'calls', coreFunc.id, coreFunc2.id)
			]
		};

		const { model } = aggregateDiagramModelByFolder(graph, { rootDir: ROOT, depth: 1 });

		assert.strictEqual(model.edges.length, 1);
		const [uiToCore] = model.edges;
		assert.strictEqual(uiToCore.source, 'group:ui');
		assert.strictEqual(uiToCore.target, 'group:core');
		assert.deepStrictEqual(
			[...uiToCore.kinds].sort((a, b) => a.kind.localeCompare(b.kind)),
			[
				{ kind: 'calls', count: 2 },
				{ kind: 'imports', count: 1 }
			]
		);
	});

	test('drops edges to an externalModule node instead of creating a group-to-group edge', () => {
		const uiFile = fileNode(path.join('ui', 'a.ts'));
		const external = node('external:vscode', 'externalModule', 'vscode');

		const graph: StoredGraph = {
			nodes: [uiFile, external],
			edges: [edge('imports:1', 'imports', uiFile.id, external.id)]
		};

		const { model } = aggregateDiagramModelByFolder(graph, { rootDir: ROOT, depth: 1 });

		assert.deepStrictEqual(model.edges, []);
		assert.deepStrictEqual(model.nodes.map((n) => n.id), ['group:ui']);
	});
});

suite('aggregateDiagramModelByFile', () => {
	test('produces one DiagramNode per file, resolving symbol-level edges to their owning file', () => {
		const uiFile = fileNode(path.join('ui', 'a.ts'));
		const coreFile = fileNode(path.join('core', 'b.ts'));
		const uiFunc = node('func:ui', 'function', 'render', uiFile.filePath);
		const coreFunc = node('func:core', 'function', 'run', coreFile.filePath);

		const graph: StoredGraph = {
			nodes: [uiFile, coreFile, uiFunc, coreFunc],
			edges: [edge('calls:1', 'calls', uiFunc.id, coreFunc.id), edge('contains:1', 'contains', uiFile.id, uiFunc.id)]
		};

		const { model, filePathsByNodeId } = aggregateDiagramModelByFile(graph);

		assert.deepStrictEqual(
			model.nodes.map((n) => n.id).sort(),
			[uiFile.id, coreFile.id].sort()
		);
		assert.strictEqual(model.edges.length, 1);
		assert.strictEqual(model.edges[0].source, uiFile.id);
		assert.strictEqual(model.edges[0].target, coreFile.id);
		assert.deepStrictEqual(filePathsByNodeId.get(uiFile.id), [uiFile.filePath]);
	});

	test('restricts the result to the given file paths when provided', () => {
		const uiFile = fileNode(path.join('ui', 'a.ts'));
		const coreFile = fileNode(path.join('core', 'b.ts'));
		const graph: StoredGraph = { nodes: [uiFile, coreFile], edges: [] };

		const { model } = aggregateDiagramModelByFile(graph, new Set([uiFile.filePath as string]));

		assert.deepStrictEqual(model.nodes.map((n) => n.id), [uiFile.id]);
	});

	test('drops edges to an externalModule node instead of creating a file-to-file edge', () => {
		const uiFile = fileNode(path.join('ui', 'a.ts'));
		const external = node('external:vscode', 'externalModule', 'vscode');
		const graph: StoredGraph = {
			nodes: [uiFile, external],
			edges: [edge('imports:1', 'imports', uiFile.id, external.id)]
		};

		const { model } = aggregateDiagramModelByFile(graph);

		assert.deepStrictEqual(model.edges, []);
		assert.deepStrictEqual(model.nodes.map((n) => n.id), [uiFile.id]);
	});
});
