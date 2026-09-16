import * as assert from 'assert';
import { computeDiagramLayout } from '../../ui/diagramLayout';

suite('computeDiagramLayout', () => {
	test('lays out standalone nodes left to right by their edges', () => {
		const boxes = computeDiagramLayout(
			[{ id: 'a' }, { id: 'b' }],
			[{ source: 'a', target: 'b' }]
		);

		const a = boxes.get('a');
		const b = boxes.get('b');
		assert.ok(a && b);
		assert.ok((a as { x: number }).x < (b as { x: number }).x, 'expected "a" to be laid out to the left of "b"');
	});

	test('positions a nested child relative to its parent, not absolutely', () => {
		const boxes = computeDiagramLayout([{ id: 'parent' }, { id: 'child', parentId: 'parent' }], []);

		const child = boxes.get('child');
		assert.ok(child);
		assert.strictEqual((child as { x: number }).x, 16);
	});

	test('sizes a parent to fit its children stacked vertically', () => {
		const boxes = computeDiagramLayout(
			[{ id: 'parent' }, { id: 'child1', parentId: 'parent' }, { id: 'child2', parentId: 'parent' }],
			[],
			{ cardWidth: 200, cardHeight: 100, groupPadding: 10, groupHeaderHeight: 20, childGap: 5 }
		);

		const parent = boxes.get('parent');
		assert.ok(parent);
		assert.strictEqual((parent as { width: number }).width, 220);
		assert.strictEqual((parent as { height: number }).height, 20 + 10 + 100 + 5 + 100 + 10);
	});

	test('treats a node with a parentId pointing outside the given node set as top-level', () => {
		const boxes = computeDiagramLayout([{ id: 'orphan', parentId: 'missing' }], []);

		assert.ok(boxes.has('orphan'));
	});

	test('resolves an edge between nested descendants to their top-level ancestors for the outer layout, without duplicating collapsed pairs', () => {
		const boxes = computeDiagramLayout(
			[
				{ id: 'left' },
				{ id: 'leftChild', parentId: 'left' },
				{ id: 'right' },
				{ id: 'rightChild', parentId: 'right' }
			],
			[
				{ source: 'leftChild', target: 'rightChild' },
				{ source: 'left', target: 'right' }
			]
		);

		const left = boxes.get('left');
		const right = boxes.get('right');
		assert.ok(left && right);
		assert.ok((left as { x: number }).x < (right as { x: number }).x);
	});

	test('drops a self-referencing top-level edge instead of erroring', () => {
		assert.doesNotThrow(() => computeDiagramLayout([{ id: 'a' }], [{ source: 'a', target: 'a' }]));
	});
});
