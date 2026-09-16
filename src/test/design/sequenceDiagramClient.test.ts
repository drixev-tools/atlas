import * as assert from 'assert';
import { parseSequenceDiagramNarration } from '../../design/sequenceDiagramClient';

suite('parseSequenceDiagramNarration', () => {
	test('parses a well-formed tool input into a SequenceDiagramNarration', () => {
		const result = parseSequenceDiagramNarration({
			summary: 'foo validates input then delegates to bar.',
			stepLabels: [
				{ order: 0, label: 'validates input' },
				{ order: 1, label: 'delegates to bar' }
			]
		});

		assert.strictEqual(result.summary, 'foo validates input then delegates to bar.');
		assert.strictEqual(result.stepLabels.length, 2);
		assert.deepStrictEqual(result.stepLabels[0], { order: 0, label: 'validates input' });
	});

	test('accepts an empty stepLabels array', () => {
		const result = parseSequenceDiagramNarration({ summary: 'Nothing to show.', stepLabels: [] });
		assert.deepStrictEqual(result.stepLabels, []);
	});

	test('rejects a non-object input', () => {
		assert.throws(() => parseSequenceDiagramNarration('not an object'), /missing its input/);
	});

	test('rejects input missing a non-empty summary', () => {
		assert.throws(() => parseSequenceDiagramNarration({ stepLabels: [] }), /"summary"/);
		assert.throws(() => parseSequenceDiagramNarration({ summary: '  ', stepLabels: [] }), /"summary"/);
	});

	test('rejects input missing the stepLabels array', () => {
		assert.throws(() => parseSequenceDiagramNarration({ summary: 'x' }), /"stepLabels" array/);
	});

	test('rejects a stepLabels entry missing a required field', () => {
		assert.throws(() => parseSequenceDiagramNarration({ summary: 'x', stepLabels: [{ order: 0 }] }), /stepLabels\[0\]\.label/);
		assert.throws(() => parseSequenceDiagramNarration({ summary: 'x', stepLabels: [{ label: 'y' }] }), /stepLabels\[0\]\.order/);
	});

	test('rejects a non-object stepLabels entry', () => {
		assert.throws(() => parseSequenceDiagramNarration({ summary: 'x', stepLabels: ['nope'] }), /stepLabels\[0\]/);
	});
});
