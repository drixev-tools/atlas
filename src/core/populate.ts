import { CodeGraph, mergeGraphs } from '../pipelines/model';
import { DEFAULT_GRAPH_STATUS, GraphStatus } from './schema';
import { ProjectGraphStore } from './store';

export interface PopulateProjectGraphOptions {
	/**
	 * Status to tag every populated node/edge with. Defaults to
	 * `observed_only` since, until Epic 10 wires up the Proposed-vs-Observed
	 * comparison, everything the extraction pipelines produce describes real
	 * code, not a design proposal.
	 */
	status?: GraphStatus;
}

/**
 * Replaces the contents of the Project Graph store with the combined output
 * of one or more extraction pipelines (TS/JS, Python, ...). The pipeline
 * outputs are merged first — de-duplicating nodes/edges that share an id,
 * e.g. externalModule nodes both pipelines happen to reference — so each
 * node/edge is written to the store exactly once per call.
 */
export function populateProjectGraph(
	store: ProjectGraphStore,
	graphs: CodeGraph[],
	options: PopulateProjectGraphOptions = {}
): void {
	const status = options.status ?? DEFAULT_GRAPH_STATUS;
	const merged = mergeGraphs(graphs);

	store.clear();
	store.upsertNodes(merged.nodes, status);
	store.upsertEdges(merged.edges, status);
}
