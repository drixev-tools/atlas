import * as assert from 'assert';
import { parseLayerNamingResults } from '../../design/layerNamingClient';

suite('parseLayerNamingResults', () => {
	test('parses a well-formed tool input into LayerNamingResults', () => {
		const results = parseLayerNamingResults(
			{ layers: [{ groupId: 'group:ui', label: 'UI Layer', description: 'Renders the graph.' }] },
			new Set(['group:ui'])
		);

		assert.deepStrictEqual(results, [{ groupId: 'group:ui', label: 'UI Layer', description: 'Renders the graph.' }]);
	});

	test('drops an entry naming a group id outside knownGroupIds', () => {
		const results = parseLayerNamingResults(
			{ layers: [{ groupId: 'group:invented', label: 'x', description: 'y' }] },
			new Set(['group:ui'])
		);

		assert.deepStrictEqual(results, []);
	});

	test('drops an entry missing a required field instead of failing the whole batch', () => {
		const results = parseLayerNamingResults(
			{
				layers: [
					{ groupId: 'group:ui', label: 'UI Layer', description: 'Renders the graph.' },
					{ groupId: 'group:core', label: '', description: 'y' }
				]
			},
			new Set(['group:ui', 'group:core'])
		);

		assert.deepStrictEqual(results, [{ groupId: 'group:ui', label: 'UI Layer', description: 'Renders the graph.' }]);
	});

	test('rejects a non-object input', () => {
		assert.throws(() => parseLayerNamingResults('nope', new Set()), /missing its input/);
	});

	test('rejects input missing the layers array', () => {
		assert.throws(() => parseLayerNamingResults({}, new Set()), /"layers" array/);
	});
});
