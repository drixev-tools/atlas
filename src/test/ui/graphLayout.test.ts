import * as assert from 'assert';
import { computeHierarchicalLayout } from '../../ui/graphLayout';

suite('computeHierarchicalLayout', () => {
	test('returns a position for every node id, including one with no edges', () => {
		const positions = computeHierarchicalLayout(['a', 'b', 'isolated'], [{ source: 'a', target: 'b' }]);

		assert.strictEqual(positions.size, 3);
		for (const id of ['a', 'b', 'isolated']) {
			const position = positions.get(id);
			assert.ok(position, `expected a position for ${id}`);
			assert.strictEqual(typeof position?.x, 'number');
			assert.strictEqual(typeof position?.y, 'number');
		}
	});

	test('top-to-bottom (default) layout places a target strictly below its source', () => {
		const positions = computeHierarchicalLayout(['parent', 'child'], [{ source: 'parent', target: 'child' }]);

		const parent = positions.get('parent');
		const child = positions.get('child');
		assert.ok(parent && child);
		assert.ok(child.y > parent.y, 'expected the child to be laid out below its parent');
	});

	test('left-to-right layout places a target strictly to the right of its source', () => {
		const positions = computeHierarchicalLayout(['parent', 'child'], [{ source: 'parent', target: 'child' }], {
			direction: 'LR'
		});

		const parent = positions.get('parent');
		const child = positions.get('child');
		assert.ok(parent && child);
		assert.ok(child.x > parent.x, 'expected the child to be laid out to the right of its parent');
	});

	test('ignores edges referencing a node id outside the given set, and self-loops, without throwing', () => {
		const positions = computeHierarchicalLayout(
			['a', 'b'],
			[
				{ source: 'a', target: 'missing' },
				{ source: 'a', target: 'a' },
				{ source: 'a', target: 'b' }
			]
		);

		assert.strictEqual(positions.size, 2);
	});

	test('siblings under the same parent are placed apart from each other', () => {
		const positions = computeHierarchicalLayout(
			['parent', 'left', 'right'],
			[
				{ source: 'parent', target: 'left' },
				{ source: 'parent', target: 'right' }
			]
		);

		const left = positions.get('left');
		const right = positions.get('right');
		assert.ok(left && right);
		assert.notStrictEqual(left.x, right.x);
	});
});
