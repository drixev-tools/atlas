import * as assert from 'assert';
import { computeSequenceDiagramLayout, sourceHandleId, targetHandleId } from '../../ui/sequenceDiagramLayout';

suite('computeSequenceDiagramLayout', () => {
	test('positions lifelines left to right in the given order, all sharing the same total height', () => {
		const layout = computeSequenceDiagramLayout(['a', 'b', 'c'], []);

		assert.strictEqual(layout.lifelinesById.get('a')?.x, 0);
		assert.strictEqual(layout.lifelinesById.get('b')?.x, 220);
		assert.strictEqual(layout.lifelinesById.get('c')?.x, 440);
		const heights = [...layout.lifelinesById.values()].map((lifeline) => lifeline.totalHeight);
		assert.deepStrictEqual(new Set(heights).size, 1);
	});

	test('places a step\'s handles at the row matching its order, on its source/target lifelines', () => {
		const layout = computeSequenceDiagramLayout(
			['a', 'b'],
			[{ id: 'step-0', order: 0, sourceLifelineId: 'a', targetLifelineId: 'b' }],
			{ headerHeight: 50, stepHeight: 40 }
		);

		const [step] = layout.steps;
		assert.strictEqual(step.sourceHandleId, sourceHandleId('step-0'));
		assert.strictEqual(step.targetHandleId, targetHandleId('step-0'));

		const sourceLifeline = layout.lifelinesById.get('a');
		const targetLifeline = layout.lifelinesById.get('b');
		assert.deepStrictEqual(sourceLifeline?.sourceHandles, [{ id: sourceHandleId('step-0'), top: 90, side: 'right' }]);
		assert.deepStrictEqual(targetLifeline?.targetHandles, [{ id: targetHandleId('step-0'), top: 90, side: 'left' }]);
	});

	test('a step whose target lifeline sits to the left of its source uses the opposite sides, drawing a clean backward line', () => {
		const layout = computeSequenceDiagramLayout(['a', 'b'], [{ id: 'step-0', order: 0, sourceLifelineId: 'b', targetLifelineId: 'a' }]);

		const sourceLifeline = layout.lifelinesById.get('b');
		const targetLifeline = layout.lifelinesById.get('a');
		assert.strictEqual(sourceLifeline?.sourceHandles[0].side, 'left');
		assert.strictEqual(targetLifeline?.targetHandles[0].side, 'right');
	});

	test('a later order places its row further down', () => {
		const layout = computeSequenceDiagramLayout(
			['a', 'b'],
			[
				{ id: 'step-0', order: 0, sourceLifelineId: 'a', targetLifelineId: 'b' },
				{ id: 'step-1', order: 1, sourceLifelineId: 'a', targetLifelineId: 'b' }
			],
			{ headerHeight: 0, stepHeight: 50 }
		);

		const tops = layout.steps.map((step) => layout.lifelinesById.get(step.sourceLifelineId)?.sourceHandles.find((h) => h.id === step.sourceHandleId)?.top);
		assert.deepStrictEqual(tops, [50, 100]);
	});

	test('offsets a self-message\'s target handle below its source handle instead of collapsing them', () => {
		const layout = computeSequenceDiagramLayout(['a'], [{ id: 'step-0', order: 0, sourceLifelineId: 'a', targetLifelineId: 'a' }]);

		assert.strictEqual(layout.steps[0].isSelfMessage, true);
		const lifeline = layout.lifelinesById.get('a');
		const sourceTop = lifeline?.sourceHandles[0].top;
		const targetTop = lifeline?.targetHandles[0].top;
		assert.ok(sourceTop !== undefined && targetTop !== undefined && targetTop > sourceTop);
		assert.strictEqual(lifeline?.sourceHandles[0].side, 'right');
		assert.strictEqual(lifeline?.targetHandles[0].side, 'right');
	});

	test('drops a step referencing a lifeline id that was not provided', () => {
		const layout = computeSequenceDiagramLayout(['a'], [{ id: 'step-0', order: 0, sourceLifelineId: 'a', targetLifelineId: 'missing' }]);
		assert.deepStrictEqual(layout.steps, []);
	});

	test('height grows with the number of steps regardless of which lifelines they touch', () => {
		const empty = computeSequenceDiagramLayout(['a', 'b'], []);
		const withSteps = computeSequenceDiagramLayout(['a', 'b'], [{ id: 'step-0', order: 0, sourceLifelineId: 'a', targetLifelineId: 'b' }]);
		assert.ok(withSteps.height > empty.height);
	});
});
