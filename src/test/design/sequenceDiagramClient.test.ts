import * as assert from 'assert';
import { parseSequenceDiagram } from '../../design/sequenceDiagramClient';

suite('parseSequenceDiagram', () => {
	test('parses a well-formed tool input into a SequenceDiagram', () => {
		const result = parseSequenceDiagram({
			summary: 'foo validates input then delegates to bar.',
			steps: [
				{ from: 'foo', to: 'bar', action: 'calls' },
				{ from: 'bar', to: 'foo', action: 'returns result' }
			]
		});

		assert.strictEqual(result.summary, 'foo validates input then delegates to bar.');
		assert.strictEqual(result.steps.length, 2);
		assert.deepStrictEqual(result.steps[0], { from: 'foo', to: 'bar', action: 'calls' });
	});

	test('accepts an empty steps array', () => {
		const result = parseSequenceDiagram({ summary: 'Nothing to show.', steps: [] });
		assert.deepStrictEqual(result.steps, []);
	});

	test('rejects a non-object input', () => {
		assert.throws(() => parseSequenceDiagram('not an object'), /missing its input/);
	});

	test('rejects input missing a non-empty summary', () => {
		assert.throws(() => parseSequenceDiagram({ steps: [] }), /"summary"/);
		assert.throws(() => parseSequenceDiagram({ summary: '  ', steps: [] }), /"summary"/);
	});

	test('rejects input missing the steps array', () => {
		assert.throws(() => parseSequenceDiagram({ summary: 'x' }), /"steps" array/);
	});

	test('rejects a step missing a required field', () => {
		assert.throws(
			() => parseSequenceDiagram({ summary: 'x', steps: [{ from: 'foo', to: 'bar' }] }),
			/steps\[0\]\.action/
		);
	});

	test('rejects a non-object step', () => {
		assert.throws(() => parseSequenceDiagram({ summary: 'x', steps: ['nope'] }), /steps\[0\]/);
	});
});
