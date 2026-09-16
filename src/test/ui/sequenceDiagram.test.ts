import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeWorkspace } from '../../ui/analyzeWorkspace';
import {
	applySequenceDiagramNarration,
	buildFallbackSequenceDiagramViewState,
	buildFallbackSequenceSummary,
	loadSequenceContext,
	toSequenceDiagramNarrationInput
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

	test('builds the outgoing call chain for a function node from the analyzed Project Graph', async () => {
		writeFile(tmpDir, 'math.ts', 'export function add(a: number, b: number): number { return a + b; }\n');
		writeFile(tmpDir, 'app.ts', "import { add } from './math';\nexport function run(): number {\n\treturn add(1, 2);\n}\n");
		await analyzeWorkspace({ rootDir: tmpDir, dbPath });

		const store = await ProjectGraphStore.open({ filePath: dbPath });
		const runNode = store.listNodes({ kind: 'function' }).find((node) => node.name === 'run');
		store.close();
		assert.ok(runNode, 'expected a "run" function node in the analyzed graph');

		const context = await loadSequenceContext(dbPath, runNode.id);

		assert.strictEqual(context?.target.name, 'run');
		assert.strictEqual(context?.steps.length, 1);
		const callee = context?.participants.find((p) => p.id === context.steps[0].toParticipantId);
		assert.strictEqual(callee?.name, 'add');
		assert.strictEqual(path.resolve(callee?.filePath ?? ''), path.resolve(tmpDir, 'math.ts'));
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
		target: { id: 'fn:foo', name: 'foo', kind: 'function', filePath: '/repo/math.ts', lifelineId: 'file:/repo/math.ts' },
		participants: [
			{ id: 'fn:foo', name: 'foo', kind: 'function', filePath: '/repo/math.ts', lifelineId: 'file:/repo/math.ts' },
			{ id: 'fn:qux', name: 'qux', kind: 'function', filePath: '/repo/math.ts', lifelineId: 'file:/repo/math.ts' }
		],
		lifelines: [{ id: 'file:/repo/math.ts', label: 'math.ts', kind: 'file', filePath: '/repo/math.ts' }],
		steps: [{ id: 'calls:foo:qux', order: 0, fromParticipantId: 'fn:foo', toParticipantId: 'fn:qux', action: 'calls qux', line: 3 }],
		truncated: false,
		...overrides
	};
}

suite('toSequenceDiagramNarrationInput', () => {
	test('maps target/steps to participant names and each step\'s default action', () => {
		const input = toSequenceDiagramNarrationInput(sampleContext());

		assert.deepStrictEqual(input.target, { name: 'foo', kind: 'function' });
		assert.deepStrictEqual(input.steps, [{ order: 0, from: 'foo', to: 'qux', defaultAction: 'calls qux' }]);
	});
});

suite('buildFallbackSequenceSummary', () => {
	test('reports the step/lifeline counts when there are steps', () => {
		const summary = buildFallbackSequenceSummary(sampleContext());
		assert.match(summary, /1 call\(s\)/);
		assert.match(summary, /1 lifeline\(s\)/);
	});

	test('mentions truncation when the chain was cut off', () => {
		const summary = buildFallbackSequenceSummary(sampleContext({ truncated: true }));
		assert.match(summary, /left out/);
	});

	test('reports no resolvable calls when there are no steps', () => {
		const summary = buildFallbackSequenceSummary(sampleContext({ steps: [] }));
		assert.match(summary, /No resolvable calls/);
	});
});

suite('buildFallbackSequenceDiagramViewState', () => {
	test('carries the target, lifelines, participants and default step labels, not AI-generated', () => {
		const state = buildFallbackSequenceDiagramViewState(sampleContext());

		assert.strictEqual(state.targetId, 'fn:foo');
		assert.strictEqual(state.targetLifelineId, 'file:/repo/math.ts');
		assert.strictEqual(state.aiGenerated, false);
		assert.deepStrictEqual(state.lifelines, sampleContext().lifelines);
		assert.deepStrictEqual(state.participants, sampleContext().participants);
		assert.deepStrictEqual(state.steps, [{ id: 'calls:foo:qux', order: 0, fromParticipantId: 'fn:foo', toParticipantId: 'fn:qux', label: 'calls qux', line: 3 }]);
	});
});

suite('applySequenceDiagramNarration', () => {
	test('overrides the summary and matching step labels, marking the state AI-generated', () => {
		const state = applySequenceDiagramNarration(sampleContext(), {
			summary: 'foo delegates to qux.',
			stepLabels: [{ order: 0, label: 'delegates to qux' }]
		});

		assert.strictEqual(state.aiGenerated, true);
		assert.strictEqual(state.summary, 'foo delegates to qux.');
		assert.strictEqual(state.steps[0].label, 'delegates to qux');
	});

	test('ignores a stepLabels entry whose order has no matching step', () => {
		const state = applySequenceDiagramNarration(sampleContext(), {
			summary: 'foo delegates to qux.',
			stepLabels: [{ order: 99, label: 'unrelated' }]
		});

		assert.strictEqual(state.steps[0].label, 'calls qux');
	});
});
