import * as assert from 'assert';
import { parseArchitectureIdentification } from '../../design/architectureIdentificationClient';

const KNOWN_GROUP_IDS = new Set(['group:controllers', 'group:services']);

function validInput(): unknown {
	return {
		patternName: 'Layered Architecture',
		patternDescription: 'Controllers depend on services, which depend on nothing else shown.',
		roles: [
			{ role: 'Controller', description: 'Handles incoming requests.' },
			{ role: 'Service', description: 'Implements business logic.' }
		],
		assignments: [
			{ groupId: 'group:controllers', role: 'Controller' },
			{ groupId: 'group:services', role: 'Service' }
		]
	};
}

suite('parseArchitectureIdentification', () => {
	test('parses a well-formed tool input', () => {
		const result = parseArchitectureIdentification(validInput(), KNOWN_GROUP_IDS);

		assert.strictEqual(result.patternName, 'Layered Architecture');
		assert.strictEqual(result.roles.length, 2);
		assert.deepStrictEqual(result.assignments, [
			{ groupId: 'group:controllers', role: 'Controller' },
			{ groupId: 'group:services', role: 'Service' }
		]);
	});

	test('drops an assignment naming a group id outside knownGroupIds', () => {
		const input = validInput() as { assignments: unknown[] };
		input.assignments = [...input.assignments, { groupId: 'group:invented', role: 'Controller' }];

		const result = parseArchitectureIdentification(input, KNOWN_GROUP_IDS);

		assert.strictEqual(result.assignments.length, 2);
	});

	test('drops an assignment naming a role missing from the declared roles list', () => {
		const input = validInput() as { assignments: unknown[] };
		input.assignments = [{ groupId: 'group:controllers', role: 'Repository' }];

		const result = parseArchitectureIdentification(input, KNOWN_GROUP_IDS);

		assert.deepStrictEqual(result.assignments, []);
	});

	test('rejects a non-object input', () => {
		assert.throws(() => parseArchitectureIdentification('nope', KNOWN_GROUP_IDS), /missing its input/);
	});

	test('rejects input missing patternName', () => {
		const input = validInput() as Record<string, unknown>;
		delete input.patternName;
		assert.throws(() => parseArchitectureIdentification(input, KNOWN_GROUP_IDS), /"patternName"/);
	});

	test('rejects input missing patternDescription', () => {
		const input = validInput() as Record<string, unknown>;
		delete input.patternDescription;
		assert.throws(() => parseArchitectureIdentification(input, KNOWN_GROUP_IDS), /"patternDescription"/);
	});

	test('rejects input missing the roles array', () => {
		const input = validInput() as Record<string, unknown>;
		delete input.roles;
		assert.throws(() => parseArchitectureIdentification(input, KNOWN_GROUP_IDS), /"roles" array/);
	});

	test('rejects input missing the assignments array', () => {
		const input = validInput() as Record<string, unknown>;
		delete input.assignments;
		assert.throws(() => parseArchitectureIdentification(input, KNOWN_GROUP_IDS), /"assignments" array/);
	});

	test('rejects a role entry missing a description', () => {
		const input = validInput() as { roles: unknown[] };
		input.roles = [{ role: 'Controller' }];
		assert.throws(() => parseArchitectureIdentification(input, KNOWN_GROUP_IDS), /roles\[0\]\.description/);
	});
});
