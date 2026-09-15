import * as assert from 'assert';
import { parseProposedArchitecture } from '../../design/claudeClient';

suite('parseProposedArchitecture', () => {
	test('parses a well-formed tool input into a ProposedArchitecture', () => {
		const result = parseProposedArchitecture({
			nodes: [
				{ ref: 'file', kind: 'file', name: 'index.ts', filePath: 'src/index.ts' },
				{ ref: 'fn', kind: 'function', name: 'main', description: 'Entry point.' }
			],
			edges: [{ kind: 'contains', sourceRef: 'file', targetRef: 'fn' }]
		});

		assert.strictEqual(result.nodes.length, 2);
		assert.strictEqual(result.nodes[1].description, 'Entry point.');
		assert.strictEqual(result.edges.length, 1);
		assert.strictEqual(result.edges[0].kind, 'contains');
	});

	test('drops optional fields entirely rather than keeping them undefined', () => {
		const result = parseProposedArchitecture({
			nodes: [{ ref: 'n1', kind: 'module', name: 'auth' }],
			edges: []
		});

		assert.strictEqual('filePath' in result.nodes[0], false);
		assert.strictEqual('language' in result.nodes[0], false);
		assert.strictEqual('description' in result.nodes[0], false);
	});

	test('rejects a non-object input', () => {
		assert.throws(() => parseProposedArchitecture('not an object'), /missing its input/);
	});

	test('rejects input missing the nodes/edges arrays', () => {
		assert.throws(() => parseProposedArchitecture({ nodes: [] }), /"nodes" and "edges" arrays/);
	});

	test('rejects a node with an invalid kind', () => {
		assert.throws(
			() => parseProposedArchitecture({ nodes: [{ ref: 'n1', kind: 'banana', name: 'x' }], edges: [] }),
			/nodes\[0\]\.kind/
		);
	});

	test('rejects a node missing a required field', () => {
		assert.throws(() => parseProposedArchitecture({ nodes: [{ ref: 'n1', kind: 'file' }], edges: [] }), /nodes\[0\]\.name/);
	});

	test('rejects an edge with an invalid kind', () => {
		assert.throws(
			() =>
				parseProposedArchitecture({
					nodes: [
						{ ref: 'a', kind: 'file', name: 'a.ts' },
						{ ref: 'b', kind: 'file', name: 'b.ts' }
					],
					edges: [{ kind: 'calls', sourceRef: 'a', targetRef: 'b' }]
				}),
			/edges\[0\]\.kind/
		);
	});
});
