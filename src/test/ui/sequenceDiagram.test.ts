import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeWorkspace } from '../../ui/analyzeWorkspace';
import {
	buildErrorSequenceDiagramViewState,
	buildNoApiKeySequenceDiagramViewState,
	buildSequenceDiagramViewState,
	loadSequenceContext,
	toSequenceDiagramContextInput
} from '../../ui/sequenceDiagram';
import { SequenceContext } from '../../core/sequenceContext';
import { ProjectGraphStore } from '../../core/store';

function writeFile(dir: string, name: string, contents: string): string {
	const filePath = path.join(dir, name);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents, 'utf8');
	return filePath;
}

suite('loadSequenceContext', () => {
	let tmpDir: string;
	let dbPath: string;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-graph-sequence-'));
		dbPath = path.join(tmpDir, 'project-graph.db');
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('builds the call context for a function node from the analyzed Project Graph', async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		writeFile(tmpDir, 'app.ts', "import { add } from './math';\nadd(1, 2);\n");
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const store = await ProjectGraphStore.open({ filePath: dbPath });
		const addNode = store.listNodes({ kind: 'function' }).find((node) => node.name === 'add');
		store.close();
		assert.ok(addNode, 'expected an "add" function node in the analyzed graph');

		const context = await loadSequenceContext(dbPath, addNode.id);

		assert.strictEqual(context?.target.name, 'add');
		assert.deepStrictEqual(
			context?.callers.map((p) => path.resolve(p.filePath ?? '')),
			[path.resolve(tmpDir, 'app.ts')]
		);
	});

	test('returns undefined for a class node (outside function/file scope)', async () => {
		writeFile(tmpDir, 'thing.ts', 'export class Thing {}\n');
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const fileId = `file:${path.resolve(tmpDir, 'thing.ts')}`;
		const context = await loadSequenceContext(dbPath, fileId);
		assert.ok(context, 'expected a context for the file node itself');
	});
});

function sampleContext(overrides: Partial<SequenceContext> = {}): SequenceContext {
	return {
		target: { id: 'fn:foo', name: 'foo', kind: 'function', filePath: '/repo/math.ts' },
		siblings: [{ id: 'fn:qux', name: 'qux', kind: 'function', filePath: '/repo/math.ts' }],
		callers: [{ id: 'file:app.ts', name: 'app.ts', kind: 'file', filePath: '/repo/app.ts' }],
		callees: [],
		...overrides
	};
}

suite('toSequenceDiagramContextInput', () => {
	test('maps target/siblings/callers/callees, dropping the internal id and empty filePath', () => {
		const input = toSequenceDiagramContextInput(sampleContext());

		assert.deepStrictEqual(input.target, { name: 'foo', kind: 'function', filePath: '/repo/math.ts' });
		assert.deepStrictEqual(input.siblings, [{ name: 'qux', kind: 'function', filePath: '/repo/math.ts' }]);
		assert.deepStrictEqual(input.callers, [{ name: 'app.ts', kind: 'file', filePath: '/repo/app.ts' }]);
		assert.deepStrictEqual(input.callees, []);
	});

	test('omits filePath entirely when a participant has none', () => {
		const input = toSequenceDiagramContextInput(
			sampleContext({ target: { id: 'ext:foo', name: 'foo', kind: 'function' } })
		);
		assert.strictEqual('filePath' in input.target, false);
	});
});

suite('buildSequenceDiagramViewState', () => {
	test('carries the target and the generated summary/steps as a "ready" state', () => {
		const state = buildSequenceDiagramViewState(sampleContext(), {
			summary: 'foo delegates to qux.',
			steps: [{ from: 'foo', to: 'qux', action: 'calls' }]
		});

		assert.deepStrictEqual(state, {
			status: 'ready',
			targetName: 'foo',
			targetKind: 'function',
			filePath: '/repo/math.ts',
			summary: 'foo delegates to qux.',
			steps: [{ from: 'foo', to: 'qux', action: 'calls' }]
		});
	});
});

suite('buildNoApiKeySequenceDiagramViewState', () => {
	test('describes a "noApiKey" state pointing at the AI Settings view, with no steps', () => {
		const state = buildNoApiKeySequenceDiagramViewState(sampleContext());

		assert.strictEqual(state.status, 'noApiKey');
		assert.deepStrictEqual(state.steps, []);
		assert.match(state.summary, /AI Settings/);
	});
});

suite('buildErrorSequenceDiagramViewState', () => {
	test('carries the given message as an "error" state, with no steps', () => {
		const state = buildErrorSequenceDiagramViewState(sampleContext(), 'Claude call failed.');

		assert.deepStrictEqual(state, {
			status: 'error',
			targetName: 'foo',
			targetKind: 'function',
			filePath: '/repo/math.ts',
			summary: 'Claude call failed.',
			steps: []
		});
	});
});
