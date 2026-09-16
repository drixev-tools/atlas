import * as assert from 'assert';
import * as path from 'path';
import { GraphEdge, GraphNode } from '../../pipelines/model';
import { ProjectGraphStore } from '../../core/store';
import { buildSequenceContext } from '../../core/sequenceContext';

function fileNode(id: string, filePath: string): GraphNode {
	return { id, kind: 'file', name: path.basename(filePath), filePath, language: 'typescript' };
}

function functionNode(id: string, name: string, filePath: string, startLine = 1): GraphNode {
	return { id, kind: 'function', name, filePath, language: 'typescript', range: { startLine, startColumn: 1, endLine: startLine, endColumn: 1 } };
}

function methodNode(id: string, name: string, filePath: string): GraphNode {
	return { id, kind: 'method', name, filePath, language: 'typescript' };
}

function classNode(id: string, name: string, filePath: string): GraphNode {
	return { id, kind: 'class', name, filePath, language: 'typescript' };
}

function containsEdge(sourceId: string, targetId: string): GraphEdge {
	return { id: `contains:${sourceId}:${targetId}`, kind: 'contains', source: sourceId, target: targetId };
}

function callsEdge(id: string, sourceId: string, targetId: string, order: number, line = order): GraphEdge {
	return { id, kind: 'calls', source: sourceId, target: targetId, metadata: { order, line } };
}

function instantiatesEdge(id: string, sourceId: string, targetId: string): GraphEdge {
	return { id, kind: 'instantiates', source: sourceId, target: targetId, metadata: { order: 0, line: 0 } };
}

suite('buildSequenceContext', () => {
	let store: ProjectGraphStore;

	setup(async () => {
		store = await ProjectGraphStore.open();
	});

	teardown(() => {
		store.close();
	});

	test('returns undefined for a node kind outside function/file', () => {
		store.upsertNodes([classNode('class:foo', 'Foo', '/project/a.ts')]);
		assert.strictEqual(buildSequenceContext(store, 'class:foo'), undefined);
	});

	test('returns undefined for an id not in the graph', () => {
		assert.strictEqual(buildSequenceContext(store, 'file:missing.ts'), undefined);
	});

	test('a function target with no outgoing/incoming calls has itself as its only participant, no steps', () => {
		store.upsertNodes([fileNode('file:a.ts', '/project/a.ts'), functionNode('fn:foo', 'foo', '/project/a.ts')]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:foo')]);

		const context = buildSequenceContext(store, 'fn:foo');

		assert.strictEqual(context?.target.id, 'fn:foo');
		assert.deepStrictEqual(context?.participants.map((p) => p.id), ['fn:foo']);
		assert.deepStrictEqual(context?.steps, []);
		assert.strictEqual(context?.truncated, false);
	});

	test('orders outgoing calls by metadata.order, not by insertion order', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:foo', 'foo', '/project/a.ts'),
			functionNode('fn:bar', 'bar', '/project/a.ts'),
			functionNode('fn:baz', 'baz', '/project/a.ts')
		]);
		store.upsertEdges([
			containsEdge('file:a.ts', 'fn:foo'),
			callsEdge('calls:foo:baz', 'fn:foo', 'fn:baz', 1),
			callsEdge('calls:foo:bar', 'fn:foo', 'fn:bar', 0)
		]);

		const context = buildSequenceContext(store, 'fn:foo');

		assert.deepStrictEqual(
			context?.steps.map((step) => step.toParticipantId),
			['fn:bar', 'fn:baz']
		);
		assert.deepStrictEqual(
			context?.steps.map((step) => step.order),
			[0, 1]
		);
	});

	test('ignores instantiates edges, following only calls edges', () => {
		store.upsertNodes([fileNode('file:a.ts', '/project/a.ts'), functionNode('fn:foo', 'foo', '/project/a.ts'), classNode('class:Thing', 'Thing', '/project/a.ts')]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:foo'), instantiatesEdge('inst:foo:thing', 'fn:foo', 'class:Thing')]);

		const context = buildSequenceContext(store, 'fn:foo');

		assert.deepStrictEqual(context?.steps, []);
	});

	test('groups a class method participant by its class lifeline, a plain function by its file lifeline', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:foo', 'foo', '/project/a.ts'),
			classNode('class:Thing', 'Thing', '/project/a.ts'),
			methodNode('method:run', 'run', '/project/a.ts')
		]);
		store.upsertEdges([
			containsEdge('file:a.ts', 'fn:foo'),
			containsEdge('file:a.ts', 'class:Thing'),
			containsEdge('class:Thing', 'method:run'),
			callsEdge('calls:foo:run', 'fn:foo', 'method:run', 0)
		]);

		const context = buildSequenceContext(store, 'fn:foo');

		const fooParticipant = context?.participants.find((p) => p.id === 'fn:foo');
		const runParticipant = context?.participants.find((p) => p.id === 'method:run');
		assert.strictEqual(fooParticipant?.lifelineId, 'file:' + path.resolve('/project/a.ts'));
		assert.strictEqual(runParticipant?.lifelineId, 'class:Thing');

		const classLifeline = context?.lifelines.find((l) => l.id === 'class:Thing');
		assert.strictEqual(classLifeline?.kind, 'class');
		assert.strictEqual(classLifeline?.label, 'Thing');
	});

	test('stops following calls beyond maxDepth and reports the chain as truncated', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:a', 'a', '/project/a.ts'),
			functionNode('fn:b', 'b', '/project/a.ts'),
			functionNode('fn:c', 'c', '/project/a.ts')
		]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:a'), callsEdge('calls:a:b', 'fn:a', 'fn:b', 0), callsEdge('calls:b:c', 'fn:b', 'fn:c', 0)]);

		const context = buildSequenceContext(store, 'fn:a', { maxDepth: 1 });

		assert.deepStrictEqual(
			context?.steps.map((step) => step.toParticipantId),
			['fn:b']
		);
		assert.strictEqual(context?.truncated, true);
	});

	test('caps the total step count at maxSteps and reports the chain as truncated', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:a', 'a', '/project/a.ts'),
			functionNode('fn:b', 'b', '/project/a.ts'),
			functionNode('fn:c', 'c', '/project/a.ts')
		]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:a'), callsEdge('calls:a:b', 'fn:a', 'fn:b', 0), callsEdge('calls:a:c', 'fn:a', 'fn:c', 1)]);

		const context = buildSequenceContext(store, 'fn:a', { maxSteps: 1 });

		assert.strictEqual(context?.steps.length, 1);
		assert.strictEqual(context?.truncated, true);
	});

	test('is cycle-safe: mutual recursion produces one step per direction instead of looping forever', () => {
		store.upsertNodes([fileNode('file:a.ts', '/project/a.ts'), functionNode('fn:a', 'a', '/project/a.ts'), functionNode('fn:b', 'b', '/project/a.ts')]);
		store.upsertEdges([containsEdge('file:a.ts', 'fn:a'), callsEdge('calls:a:b', 'fn:a', 'fn:b', 0), callsEdge('calls:b:a', 'fn:b', 'fn:a', 0)]);

		const context = buildSequenceContext(store, 'fn:a');

		assert.deepStrictEqual(
			context?.steps.map((step) => [step.fromParticipantId, step.toParticipantId]),
			[
				['fn:a', 'fn:b'],
				['fn:b', 'fn:a']
			]
		);
	});

	test('a file target traces from its top-level functions in declaration order, skipping methods nested in classes', () => {
		store.upsertNodes([
			fileNode('file:a.ts', '/project/a.ts'),
			functionNode('fn:second', 'second', '/project/a.ts', 20),
			functionNode('fn:first', 'first', '/project/a.ts', 5),
			classNode('class:Thing', 'Thing', '/project/a.ts'),
			methodNode('method:run', 'run', '/project/a.ts')
		]);
		store.upsertEdges([
			containsEdge('file:a.ts', 'fn:second'),
			containsEdge('file:a.ts', 'fn:first'),
			containsEdge('file:a.ts', 'class:Thing'),
			containsEdge('class:Thing', 'method:run'),
			callsEdge('calls:first:target', 'fn:first', 'fn:second', 0)
		]);

		const context = buildSequenceContext(store, 'file:a.ts');

		assert.deepStrictEqual(
			context?.participants.map((p) => p.id),
			['file:a.ts', 'fn:first', 'fn:second']
		);
		assert.deepStrictEqual(
			context?.steps.map((step) => [step.fromParticipantId, step.toParticipantId]),
			[['fn:first', 'fn:second']]
		);
		assert.strictEqual(context?.target.lifelineId, 'file:a.ts');
	});
});
