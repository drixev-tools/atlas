// Common graph model produced by every extraction pipeline (TS/JS, and later
// Python). Keeping this pipeline-agnostic lets persistence (Epic 4) and the
// renderer (Epic 6) work against a single shape regardless of source language.

export type NodeKind =
	| 'file'
	| 'module'
	| 'externalModule'
	| 'function'
	| 'class'
	| 'interface'
	| 'method'
	| 'property'
	| 'variable'
	| 'enum'
	| 'typeAlias';

export type EdgeKind = 'contains' | 'imports' | 'exports';

export interface SourceRange {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
}

export interface GraphNode {
	id: string;
	kind: NodeKind;
	name: string;
	/** Absolute path of the file the node belongs to, or its own path for 'file' nodes. Undefined for externalModule nodes. */
	filePath?: string;
	language?: string;
	exported?: boolean;
	range?: SourceRange;
	metadata?: Record<string, unknown>;
}

export interface GraphEdge {
	id: string;
	kind: EdgeKind;
	source: string;
	target: string;
	metadata?: Record<string, unknown>;
}

export interface CodeGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export function createEmptyGraph(): CodeGraph {
	return { nodes: [], edges: [] };
}

export function mergeGraphs(graphs: CodeGraph[]): CodeGraph {
	const merged = createEmptyGraph();
	const seenNodeIds = new Set<string>();
	const seenEdgeIds = new Set<string>();

	for (const graph of graphs) {
		for (const node of graph.nodes) {
			if (seenNodeIds.has(node.id)) {
				continue;
			}
			seenNodeIds.add(node.id);
			merged.nodes.push(node);
		}
		for (const edge of graph.edges) {
			if (seenEdgeIds.has(edge.id)) {
				continue;
			}
			seenEdgeIds.add(edge.id);
			merged.edges.push(edge);
		}
	}

	return merged;
}
