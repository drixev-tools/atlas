import * as assert from 'assert';
import { DiagramModel } from '../../core/diagramModel';
import { hasHiddenStandaloneImports, standaloneImportNodeIds, visibleDiagramModel } from '../../ui/diagramFileExpansion';

/** Nested under a common (already-expanded) folder, like every node this module considers. */
function node(id: string): DiagramModel['nodes'][number] {
	return { id, kind: 'file', label: id, parentId: 'group:folder' };
}

function edge(id: string, source: string, target: string): DiagramModel['edges'][number] {
	return { id, source, target, kinds: [{ kind: 'imports', count: 1 }] };
}

/** a -> b, a -> c, b -> c (c is a pure import target); d imports nothing and nothing imports it. */
function fixture(): DiagramModel {
	return {
		nodes: [node('a'), node('b'), node('c'), node('d')],
		edges: [edge('e1', 'a', 'b'), edge('e2', 'a', 'c'), edge('e3', 'b', 'c')]
	};
}

suite('standaloneImportNodeIds', () => {
	test('finds nodes with incoming edges but no outgoing edges', () => {
		assert.deepStrictEqual([...standaloneImportNodeIds(fixture())].sort(), ['c']);
	});

	test('excludes an orphan node with neither incoming nor outgoing edges', () => {
		const ids = standaloneImportNodeIds(fixture());
		assert.strictEqual(ids.has('d'), false);
	});

	test('a top-level node (no parentId) is never treated as a standalone import target, even with the same in/out-degree shape', () => {
		const model: DiagramModel = {
			nodes: [{ id: 'root', kind: 'file', label: 'root' }, node('importer')],
			edges: [edge('e1', 'importer', 'root')]
		};
		assert.strictEqual(standaloneImportNodeIds(model).has('root'), false);
	});
});

suite('visibleDiagramModel', () => {
	test('with nothing expanded, hides every standalone import target', () => {
		const { nodes, edges } = visibleDiagramModel(fixture(), new Set());
		assert.deepStrictEqual(nodes.map((n) => n.id).sort(), ['a', 'b', 'd']);
		assert.deepStrictEqual(edges.map((e) => e.id).sort(), ['e1']);
	});

	test('expanding an importer reveals the standalone target it imports, along with any other edge now between visible nodes', () => {
		const { nodes, edges } = visibleDiagramModel(fixture(), new Set(['b']));
		assert.deepStrictEqual(nodes.map((n) => n.id).sort(), ['a', 'b', 'c', 'd']);
		assert.deepStrictEqual(edges.map((e) => e.id).sort(), ['e1', 'e2', 'e3']);
	});

	test('a target stays visible once expanding either of its importers reaches it', () => {
		const viaA = visibleDiagramModel(fixture(), new Set(['a']));
		const viaB = visibleDiagramModel(fixture(), new Set(['b']));
		assert.strictEqual(viaA.nodes.some((n) => n.id === 'c'), true);
		assert.strictEqual(viaB.nodes.some((n) => n.id === 'c'), true);
	});
});

suite('hasHiddenStandaloneImports', () => {
	test('true for a visible node whose standalone import target is not currently visible', () => {
		const model = fixture();
		const { nodes } = visibleDiagramModel(model, new Set());
		assert.strictEqual(hasHiddenStandaloneImports(model, 'a', new Set(nodes.map((n) => n.id))), true);
	});

	test('false once the node is expanded and its standalone targets are visible', () => {
		const model = fixture();
		const { nodes } = visibleDiagramModel(model, new Set(['a', 'b']));
		assert.strictEqual(hasHiddenStandaloneImports(model, 'a', new Set(nodes.map((n) => n.id))), false);
	});

	test('false for a node with no outgoing edges at all', () => {
		const model = fixture();
		const { nodes } = visibleDiagramModel(model, new Set());
		assert.strictEqual(hasHiddenStandaloneImports(model, 'd', new Set(nodes.map((n) => n.id))), false);
	});
});
