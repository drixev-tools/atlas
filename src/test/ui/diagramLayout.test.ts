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

	test('sizes a parent to fit its unconnected children stacked vertically', () => {
		const boxes = computeDiagramLayout(
			[{ id: 'parent' }, { id: 'child1', parentId: 'parent' }, { id: 'child2', parentId: 'parent' }],
			[],
			{ cardWidth: 200, cardHeight: 100, groupPadding: 10, groupHeaderHeight: 20, nodeSeparation: 5 }
		);

		const parent = boxes.get('parent');
		assert.ok(parent);
		assert.strictEqual((parent as { width: number }).width, 220);
		assert.strictEqual((parent as { height: number }).height, 20 + 10 + 100 + 5 + 100 + 10);
	});

	test('lays out a group\'s connected children horizontally by their own edges, not just in listed order', () => {
		const boxes = computeDiagramLayout(
			[{ id: 'parent' }, { id: 'child1', parentId: 'parent' }, { id: 'child2', parentId: 'parent' }],
			[{ source: 'child2', target: 'child1' }]
		);

		const child1 = boxes.get('child1');
		const child2 = boxes.get('child2');
		assert.ok(child1 && child2);
		assert.ok((child2 as { x: number }).x < (child1 as { x: number }).x, 'expected "child2" (the edge source) to be laid out to the left of "child1"');
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

	test('keeps top-level boxes from overlapping when a cycle and a disconnected node confuse dagre nodesep', () => {
		const nodes = [
			{ id: 'g0' }, { id: 'g0c0', parentId: 'g0' }, { id: 'g0c1', parentId: 'g0' }, { id: 'g0c2', parentId: 'g0' },
			{ id: 'g0c3', parentId: 'g0' }, { id: 'g0c4', parentId: 'g0' }, { id: 'g0c5', parentId: 'g0' }, { id: 'g0c6', parentId: 'g0' },
			{ id: 'g1' }, { id: 'g1c0', parentId: 'g1' }, { id: 'g1c1', parentId: 'g1' }, { id: 'g1c2', parentId: 'g1' },
			{ id: 'g1c3', parentId: 'g1' }, { id: 'g1c4', parentId: 'g1' },
			{ id: 'g2' }, { id: 'g2c0', parentId: 'g2' }, { id: 'g2c1', parentId: 'g2' }, { id: 'g2c2', parentId: 'g2' },
			{ id: 'g2c3', parentId: 'g2' }, { id: 'g2c4', parentId: 'g2' }, { id: 'g2c5', parentId: 'g2' },
			{ id: 'root0' }, { id: 'root1' }
		];
		const edges = [
			{ source: 'g2c2', target: 'g0c5' },
			{ source: 'g1c2', target: 'g0c0' },
			{ source: 'g2c4', target: 'g0c6' },
			{ source: 'g2c5', target: 'root0' },
			{ source: 'g0c2', target: 'g2c0' },
			{ source: 'g0c5', target: 'g2c2' }
		];

		const boxes = computeDiagramLayout(nodes, edges);
		const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
			a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

		const topLevel = ['g0', 'g1', 'g2', 'root0', 'root1'].map((id) => boxes.get(id)!);
		for (let i = 0; i < topLevel.length; i++) {
			for (let j = i + 1; j < topLevel.length; j++) {
				assert.ok(!overlaps(topLevel[i], topLevel[j]), `expected top-level box ${i} and ${j} not to overlap`);
			}
		}
	});
});
