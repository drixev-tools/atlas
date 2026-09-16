import { CodeGraph, mergeGraphs } from '../pipelines/model';
import { DEFAULT_GRAPH_STATUS, GraphStatus } from './schema';
import { ProjectGraphStore } from './store';

export interface PopulateProjectGraphOptions {
	/**
	 * Status to tag every populated node/edge with. Defaults to
	 * `observed_only` since everything the extraction pipelines produce
	 * describes real code, not a design proposal.
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

/**
 * Replaces just the Proposed Graph slice of the store — every node/edge
 * currently tagged `proposed_only` — with `graph`, leaving the Observed
 * Graph (and anything already tagged `matched`) untouched. This is what the
 * "Project Graph: Design Project" command needs: each run reflects only the
 * latest intent's proposal instead of accumulating every past one, while
 * still coexisting with whatever "Analyze Workspace" already found in the
 * code.
 */
export function populateProposedGraph(store: ProjectGraphStore, graph: CodeGraph): void {
	store.clearByStatus('proposed_only');
	store.upsertNodes(graph.nodes, 'proposed_only');
	store.upsertEdges(graph.edges, 'proposed_only');
}
