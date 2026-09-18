import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeWorkspace } from '../../ui/analyzeWorkspace';
import { AtlasStore } from '../../core/store';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('analyzeWorkspace', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-analyze-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('runs both pipelines and reports the combined node/edge counts', async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		writeFile(tmpDir, 'math_utils.py', 'def subtract(a, b):\n    return a - b\n');

		const result = await analyzeWorkspace({ rootDir: tmpDir });

		assert.ok(result.nodeCount > 0, 'expected at least one node from the combined pipelines');
		assert.ok(result.edgeCount > 0, 'expected at least one edge from the combined pipelines');
	});

	test('reports progress for each stage in order', async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');

		const messages: string[] = [];
		await analyzeWorkspace({ rootDir: tmpDir, onProgress: (message) => messages.push(message) });

		assert.deepStrictEqual(messages, [
			'Extracting TypeScript/JavaScript...',
			'Extracting Python...',
			'Updating Atlas graph...'
		]);
	});

	test('persists the resulting graph to dbPath when given', async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		const dbPath = path.join(tmpDir, 'atlas.db');

		const result = await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		assert.ok(fs.existsSync(dbPath), 'expected the database file to be written to dbPath');

		const reopened = await AtlasStore.open({ filePath: dbPath });
		try {
			assert.strictEqual(reopened.getGraph().nodes.length, result.nodeCount);
		} finally {
			reopened.close();
		}
	});

	test('a second run replaces the previous graph instead of accumulating duplicates', async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');

		const first = await analyzeWorkspace({ rootDir: tmpDir });
		const second = await analyzeWorkspace({ rootDir: tmpDir });

		assert.strictEqual(second.nodeCount, first.nodeCount);
		assert.strictEqual(second.edgeCount, first.edgeCount);
	});

	test('returns zero counts for an empty workspace', async () => {
		const result = await analyzeWorkspace({ rootDir: tmpDir });
		assert.deepStrictEqual(result, { nodeCount: 0, edgeCount: 0 });
	});
});
