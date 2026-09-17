import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { StoredGraph } from '../../core/store';
import { buildActiveFileFlowViewData, resolveActiveFileId } from '../../ui/activeFileFlow';

function file(id: string, filePath: string): GraphNode {
	return { id, kind: 'file', name: filePath, filePath };
}

function importEdge(id: string, source: string, target: string): GraphEdge {
	return { id, kind: 'imports', source, target };
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): StoredGraph {
	return {
		nodes: nodes.map((node) => ({ ...node, status: 'observed_only' })),
		edges: edges.map((edge) => ({ ...edge, status: 'observed_only' }))
	};
}

suite('resolveActiveFileId', () => {
	test('matches a file node by resolved path, regardless of separators', () => {
		const filePath = path.join('project', 'a.ts');
		const data = graph([file('file:a', filePath)], []);
		assert.strictEqual(resolveActiveFileId(data, filePath), 'file:a');
	});

	test('returns undefined when no file node matches the path', () => {
		const data = graph([file('file:a', path.join('project', 'a.ts'))], []);
		assert.strictEqual(resolveActiveFileId(data, path.join('project', 'b.ts')), undefined);
	});
});

suite('buildActiveFileFlowViewData', () => {
	test('builds the flow for the file at the given path', () => {
		const rootPath = path.join('project', 'root.ts');
		const activePath = path.join('project', 'active.ts');
		const data = graph([file('file:root', rootPath), file('file:active', activePath)], [importEdge('e1', 'file:root', 'file:active')]);

		const result = buildActiveFileFlowViewData(data, activePath);
		assert.deepStrictEqual(result?.flow.nodes.map((n) => n.id).sort(), ['file:active', 'file:root']);
		assert.strictEqual(result?.flow.activeFileId, 'file:active');
	});

	test('returns undefined when the path is not a known file', () => {
		const data = graph([file('file:root', path.join('project', 'root.ts'))], []);
		assert.strictEqual(buildActiveFileFlowViewData(data, path.join('project', 'missing.ts')), undefined);
	});
});
