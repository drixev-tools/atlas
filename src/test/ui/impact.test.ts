import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitStatusSource } from '../../core/gitStatus';
import { analyzeWorkspace } from '../../ui/analyzeWorkspace';
import { calculateImpact } from '../../ui/impact';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

function fakeGitStatus(files: string[]): GitStatusSource {
	return { getChangedFiles: async () => files };
}

/**
 * The TS compiler API normalizes file paths to forward slashes regardless of
 * platform (see `core/incremental.ts`'s `fileNodeId` doc comment), so paths
 * coming back out of the Project Graph can use different separators than the
 * ones this test wrote the files with. Comparing via `path.resolve` — which
 * normalizes both to the platform's own separator — sidesteps that instead of
 * asserting on the exact string.
 */
function resolvedSorted(paths: string[]): string[] {
	return paths.map((p) => path.resolve(p)).sort();
}

suite('calculateImpact', () => {
	let tmpDir: string;
	let dbPath: string;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-impact-'));
		dbPath = path.join(tmpDir, 'project-graph.db');
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('uses uncommitted git changes as the target set, computing consumers and related tests', async () => {
		const mathPath = writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		const appPath = writeFile(tmpDir, 'app.ts', "import { add } from './math';\nadd(1, 2);\n");
		const testPath = writeFile(tmpDir, 'math.test.ts', "import { add } from './math';\nadd(1, 2);\n");
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const result = await calculateImpact({ rootDir: tmpDir, dbPath, gitStatus: fakeGitStatus([mathPath]) });

		assert.strictEqual(result.source, 'git');
		assert.deepStrictEqual(resolvedSorted(result.targets), resolvedSorted([mathPath]));
		assert.deepStrictEqual(resolvedSorted(result.impactedFiles), resolvedSorted([appPath, testPath]));
		assert.deepStrictEqual(resolvedSorted(result.relatedTests), resolvedSorted([testPath]));
	});

	test('falls back to the active file when there are no git changes', async () => {
		const mathPath = writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		writeFile(tmpDir, 'app.ts', "import { add } from './math';\nadd(1, 2);\n");
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const result = await calculateImpact({ rootDir: tmpDir, dbPath, gitStatus: fakeGitStatus([]), activeFilePath: mathPath });

		assert.strictEqual(result.source, 'activeFile');
		assert.deepStrictEqual(resolvedSorted(result.targets), resolvedSorted([mathPath]));
	});

	test('reports source "none" with empty results when there is neither a git change nor a known active file', async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const result = await calculateImpact({ rootDir: tmpDir, dbPath, gitStatus: fakeGitStatus([]) });

		assert.deepStrictEqual(result, { source: 'none', targets: [], impacts: [], impactedFiles: [], relatedTests: [] });
	});

	test('ignores git-changed files that are not part of the Project Graph', async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });
		const unrelated = path.join(tmpDir, 'not-in-graph.ts');

		const result = await calculateImpact({ rootDir: tmpDir, dbPath, gitStatus: fakeGitStatus([unrelated]) });

		assert.strictEqual(result.source, 'none');
	});

	test('reports progress for each stage in order', async () => {
		const mathPath = writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const messages: string[] = [];
		await calculateImpact({
			rootDir: tmpDir,
			dbPath,
			gitStatus: fakeGitStatus([mathPath]),
			onProgress: (message) => messages.push(message)
		});

		assert.deepStrictEqual(messages, ['Reading git status...', 'Calculating structural impact...', 'Finding related tests...']);
	});
});
