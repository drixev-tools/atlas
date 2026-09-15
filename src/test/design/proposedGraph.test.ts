import * as assert from 'assert';
import * as path from 'path';
import { buildProposedGraph } from '../../design/proposedGraph';
import { ProposedArchitecture } from '../../design/model';

const ROOT = path.join('/', 'project');

suite('buildProposedGraph', () => {
	test('resolves a file-kind node to the same id scheme the TS/JS pipeline uses', () => {
		const architecture: ProposedArchitecture = {
			nodes: [{ ref: 'n1', kind: 'file', name: 'loginService.ts', filePath: 'src/auth/loginService.ts' }],
			edges: []
		};

		const graph = buildProposedGraph(ROOT, architecture);

		assert.strictEqual(graph.nodes.length, 1);
		assert.strictEqual(graph.nodes[0].id, `file:${path.resolve(ROOT, 'src/auth/loginService.ts')}`);
		assert.strictEqual(graph.nodes[0].filePath, path.resolve(ROOT, 'src/auth/loginService.ts'));
	});

	test('throws when a file-kind node has no filePath', () => {
		const architecture: ProposedArchitecture = {
			nodes: [{ ref: 'n1', kind: 'file', name: 'loginService.ts' }],
			edges: []
		};

		assert.throws(() => buildProposedGraph(ROOT, architecture), /filePath/);
	});

	test('gives an externalModule node the pipelines\' external:<specifier> id', () => {
		const architecture: ProposedArchitecture = {
			nodes: [{ ref: 'n1', kind: 'externalModule', name: 'express' }],
			edges: []
		};

		const graph = buildProposedGraph(ROOT, architecture);

		assert.strictEqual(graph.nodes[0].id, 'external:express');
	});

	test('gives non-file nodes a deterministic id that is stable across repeated calls', () => {
		const architecture: ProposedArchitecture = {
			nodes: [{ ref: 'n1', kind: 'class', name: 'LoginService', filePath: 'src/auth/loginService.ts', description: 'Handles login.' }],
			edges: []
		};

		const first = buildProposedGraph(ROOT, architecture);
		const second = buildProposedGraph(ROOT, architecture);

		assert.strictEqual(first.nodes[0].id, second.nodes[0].id);
		assert.deepStrictEqual(first.nodes[0].metadata, { description: 'Handles login.' });
	});

	test('resolves edge refs to node ids and derives a stable edge id', () => {
		const architecture: ProposedArchitecture = {
			nodes: [
				{ ref: 'file', kind: 'file', name: 'loginService.ts', filePath: 'src/auth/loginService.ts' },
				{ ref: 'cls', kind: 'class', name: 'LoginService', filePath: 'src/auth/loginService.ts' }
			],
			edges: [{ kind: 'contains', sourceRef: 'file', targetRef: 'cls', description: 'defines' }]
		};

		const graph = buildProposedGraph(ROOT, architecture);

		assert.strictEqual(graph.edges.length, 1);
		assert.strictEqual(graph.edges[0].source, graph.nodes[0].id);
		assert.strictEqual(graph.edges[0].target, graph.nodes[1].id);
		assert.deepStrictEqual(graph.edges[0].metadata, { description: 'defines' });
	});

	test('throws when an edge references an unknown ref', () => {
		const architecture: ProposedArchitecture = {
			nodes: [{ ref: 'file', kind: 'file', name: 'a.ts', filePath: 'a.ts' }],
			edges: [{ kind: 'imports', sourceRef: 'file', targetRef: 'missing' }]
		};

		assert.throws(() => buildProposedGraph(ROOT, architecture), /unknown ref/);
	});

	test('throws when two nodes share the same ref', () => {
		const architecture: ProposedArchitecture = {
			nodes: [
				{ ref: 'dup', kind: 'file', name: 'a.ts', filePath: 'a.ts' },
				{ ref: 'dup', kind: 'file', name: 'b.ts', filePath: 'b.ts' }
			],
			edges: []
		};

		assert.throws(() => buildProposedGraph(ROOT, architecture), /ref "dup"/);
	});
});
