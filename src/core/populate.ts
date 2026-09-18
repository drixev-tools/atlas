import { CodeGraph, mergeGraphs } from '../pipelines/model';
import { DEFAULT_GRAPH_STATUS, GraphStatus } from './schema';
import { AtlasStore } from './store';

export interface PopulateAtlasOptions {
	/**
	 * Status to tag every populated node/edge with. Defaults to
	 * `observed_only` since everything the extraction pipelines produce
	 * describes real code, not a design proposal.
	 */
	status?: GraphStatus;
}

/**
 * Replaces the contents of the Atlas store with the combined output
 * of one or more extraction pipelines (TS/JS, Python, ...). The pipeline
 * outputs are merged first — de-duplicating nodes/edges that share an id,
 * e.g. externalModule nodes both pipelines happen to reference — so each
 * node/edge is written to the store exactly once per call.
 */
export function populateAtlas(
	store: AtlasStore,
	graphs: CodeGraph[],
	options: PopulateAtlasOptions = {}
): void {
	const status = options.status ?? DEFAULT_GRAPH_STATUS;
	const merged = mergeGraphs(graphs);

	store.clear();
	store.upsertNodes(merged.nodes, status);
	store.upsertEdges(merged.edges, status);
}
