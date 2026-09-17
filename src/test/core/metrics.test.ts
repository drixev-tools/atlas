import * as assert from 'assert';
import { MementoUsageMetricsStore, UsageMetrics } from '../../core/metrics';

/** Minimal `vscode.Memento` fake — enough of the interface for `MementoUsageMetricsStore`. */
function fakeMemento(): { get: (key: string) => unknown; update: (key: string, value: unknown) => Promise<void> } {
	const values = new Map<string, unknown>();
	return {
		get: (key: string) => values.get(key),
		update: async (key: string, value: unknown) => {
			values.set(key, value);
		}
	};
}

suite('MementoUsageMetricsStore', () => {
	test('getAll returns an empty object before anything is recorded', () => {
		const store = new MementoUsageMetricsStore(fakeMemento() as never);
		assert.deepStrictEqual(store.getAll(), {});
	});

	test('record increments the counter for that event, starting from zero', async () => {
		const store = new MementoUsageMetricsStore(fakeMemento() as never);

		await store.record('analyzeWorkspace');
		await store.record('analyzeWorkspace');
		await store.record('openArchitecture');

		assert.deepStrictEqual(store.getAll(), { analyzeWorkspace: 2, openArchitecture: 1 });
	});

	test('tracks every usage metric event independently', async () => {
		const store = new MementoUsageMetricsStore(fakeMemento() as never);
		const events: UsageMetrics = {
			analyzeWorkspace: 1,
			openArchitecture: 1,
			showSequenceDiagram: 1,
			designProject: 1,
			incrementalUpdate: 1
		};

		for (const event of Object.keys(events) as (keyof UsageMetrics)[]) {
			await store.record(event);
		}

		assert.deepStrictEqual(store.getAll(), events);
	});

	test('does not mutate the object returned by a previous getAll call', async () => {
		const store = new MementoUsageMetricsStore(fakeMemento() as never);

		const before = store.getAll();
		await store.record('designProject');

		assert.deepStrictEqual(before, {});
		assert.deepStrictEqual(store.getAll(), { designProject: 1 });
	});

	test('persists counts through the underlying memento so a new store instance sees them', async () => {
		const memento = fakeMemento();
		const first = new MementoUsageMetricsStore(memento as never);
		await first.record('openArchitecture');

		const second = new MementoUsageMetricsStore(memento as never);
		assert.deepStrictEqual(second.getAll(), { openArchitecture: 1 });
	});
});
