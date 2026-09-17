// Local usage metrics: counts how many times each Agent Graph feature runs,
// purely for the user's own visibility into their usage. This
// module never makes a network call — it only reads/writes VS Code's
// `Memento` (backed by a local file in the extension's per-install storage,
// see `context.globalState`), so there is nothing here to send metrics
// anywhere, by construction rather than by policy.
import * as vscode from 'vscode';

export const USAGE_METRICS_STORAGE_KEY = 'agentGraph.usageMetrics';

/** One entry per feature we count. Extend this list, not the storage shape, when a new feature needs a counter. */
export type UsageMetricEvent =
	| 'analyzeWorkspace'
	| 'openArchitecture'
	| 'calculateImpact'
	| 'showSequenceDiagram'
	| 'showActiveFileFlow'
	| 'showIdentifiedArchitecture'
	| 'designProject'
	| 'incrementalUpdate';

export type UsageMetrics = Partial<Record<UsageMetricEvent, number>>;

/**
 * Narrowed to an interface — separate from the concrete
 * `MementoUsageMetricsStore` — so tests and callers like `ProjectGraphWatcher`
 * can supply an in-memory fake, matching `ApiKeyStore` (../design/apiKey) and
 * `GitStatusSource` (./gitStatus).
 */
export interface UsageMetricsStore {
	record(event: UsageMetricEvent): Promise<void>;
	getAll(): UsageMetrics;
}

/**
 * Persists usage counters in a VS Code `Memento` — `context.globalState` for
 * counts that span every workspace (how this is wired in `extension.ts`), or
 * `context.workspaceState` for per-workspace counts, should that ever be
 * needed. Either way the data lives only in VS Code's local extension storage
 * on disk; nothing here reads it back out over a network.
 */
export class MementoUsageMetricsStore implements UsageMetricsStore {
	constructor(private readonly memento: vscode.Memento) {}

	async record(event: UsageMetricEvent): Promise<void> {
		const metrics = this.getAll();
		metrics[event] = (metrics[event] ?? 0) + 1;
		await this.memento.update(USAGE_METRICS_STORAGE_KEY, metrics);
	}

	getAll(): UsageMetrics {
		return { ...(this.memento.get<UsageMetrics>(USAGE_METRICS_STORAGE_KEY) ?? {}) };
	}
}
