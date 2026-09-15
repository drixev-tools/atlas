import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { ProjectGraphStore } from '../../core/store';
import { findRelatedTestFiles, isLikelyTestFilePath } from '../../core/testLinks';

function fileNodeId(filePath: string): string {
	return `file:${path.resolve(filePath)}`;
}

function makeFileNode(filePath: string): GraphNode {
	return { id: fileNodeId(filePath), kind: 'file', name: path.basename(filePath), filePath, language: 'typescript' };
}

function makeImportEdge(sourceFilePath: string, targetFilePath: string): GraphEdge {
	return { id: `imports:${sourceFilePath}:${targetFilePath}`, kind: 'imports', source: fileNodeId(sourceFilePath), target: fileNodeId(targetFilePath) };
}

suite('testLinks: isLikelyTestFilePath', () => {
	test('matches TS/JS test/spec suffixes', () => {
		for (const name of ['foo.test.ts', 'foo.test.tsx', 'foo.spec.js', 'foo.spec.jsx']) {
			assert.strictEqual(isLikelyTestFilePath(path.join('/project', name)), true, name);
		}
	});

	test('matches Python test naming conventions', () => {
		assert.strictEqual(isLikelyTestFilePath(path.join('/project', 'test_math.py')), true);
		assert.strictEqual(isLikelyTestFilePath(path.join('/project', 'math_test.py')), true);
	});

	test('matches files under a conventional test directory regardless of name', () => {
		assert.strictEqual(isLikelyTestFilePath(path.join('/project', '__tests__', 'math.ts')), true);
		assert.strictEqual(isLikelyTestFilePath(path.join('/project', 'tests', 'math.py')), true);
	});

	test('does not match ordinary source files', () => {
		assert.strictEqual(isLikelyTestFilePath(path.join('/project', 'math.ts')), false);
		assert.strictEqual(isLikelyTestFilePath(path.join('/project', 'math_utils.py')), false);
	});
});

suite('testLinks: findRelatedTestFiles', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('finds a test file that imports the code file', () => {
		const math = path.join('/project', 'math.ts');
		const mathTest = path.join('/project', 'math.test.ts');
		store.upsertNodes([makeFileNode(math), makeFileNode(mathTest)]);
		store.upsertEdge(makeImportEdge(mathTest, math));

		assert.deepStrictEqual(findRelatedTestFiles(store, math), [mathTest]);
	});

	test('finds a naming-convention pair even without an import edge', () => {
		const mathUtils = path.join('/project', 'math_utils.py');
		const testMathUtils = path.join('/project', 'test_math_utils.py');
		store.upsertNodes([makeFileNode(mathUtils), makeFileNode(testMathUtils)]);

		assert.deepStrictEqual(findRelatedTestFiles(store, mathUtils), [testMathUtils]);
	});

	test('ignores a consumer that is not itself named like a test', () => {
		const math = path.join('/project', 'math.ts');
		const app = path.join('/project', 'app.ts');
		store.upsertNodes([makeFileNode(math), makeFileNode(app)]);
		store.upsertEdge(makeImportEdge(app, math));

		assert.deepStrictEqual(findRelatedTestFiles(store, math), []);
	});

	test('returns an empty list for a file that is itself already a test', () => {
		const mathTest = path.join('/project', 'math.test.ts');
		store.upsertNode(makeFileNode(mathTest));

		assert.deepStrictEqual(findRelatedTestFiles(store, mathTest), []);
	});

	test('de-duplicates a test found by both the import and naming-convention routes', () => {
		const math = path.join('/project', 'math.ts');
		const mathTest = path.join('/project', 'math.test.ts');
		store.upsertNodes([makeFileNode(math), makeFileNode(mathTest)]);
		store.upsertEdge(makeImportEdge(mathTest, math));

		assert.deepStrictEqual(findRelatedTestFiles(store, math), [mathTest]);
	});
});
