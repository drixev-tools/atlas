import * as assert from 'assert';
import { connectedNodeIds } from '../../ui/webview/visualSystem';

suite('connectedNodeIds', () => {
	const edges = [
		{ source: 'a', target: 'b' },
		{ source: 'c', target: 'a' },
		{ source: 'b', target: 'd' },
		{ source: 'e', target: 'f' }
	];

	test('returns undefined when nothing is selected, so the caller dims nothing', () => {
		assert.strictEqual(connectedNodeIds(edges, undefined), undefined);
	});

	test('includes the selected node plus both its outgoing and incoming neighbours', () => {
		const ids = connectedNodeIds(edges, 'a');

		assert.deepStrictEqual([...(ids ?? [])].sort(), ['a', 'b', 'c']);
	});

	test('does not include neighbours of neighbours', () => {
		const ids = connectedNodeIds(edges, 'a');

		assert.strictEqual(ids?.has('d'), false);
		assert.strictEqual(ids?.has('e'), false);
	});

	test('keeps a node with no edges highlighted on its own', () => {
		const ids = connectedNodeIds(edges, 'isolated');

		assert.deepStrictEqual([...(ids ?? [])], ['isolated']);
	});

	test('ignores an empty selection id', () => {
		assert.strictEqual(connectedNodeIds(edges, ''), undefined);
	});
});
