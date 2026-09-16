// Builds the Proposed Graph from Claude's response: a pure mapping from
// `ProposedArchitecture` to the same pipeline-agnostic
// `CodeGraph` shape the TS/JS and Python extraction pipelines produce (see
// ../pipelines/model), so `populateProposedGraph` (../core/populate) can
// persist it through the existing store with no schema of its own.
import * as path from 'path';
import { CodeGraph, GraphEdge, GraphNode, createEmptyGraph } from '../pipelines/model';
import { ProposedArchitecture, ProposedNode } from './model';

/**
 * Id for a proposed `file` node: the exact `file:<absolute path>` scheme the
 * TS/JS pipeline assigns real file nodes (see ../pipelines/ts/normalize.ts).
 * Once the user creates that file and runs "Analyze Workspace", the node
 * lands under the same id, which is what lets the Proposed vs Observed
 * comparison (../core/comparison) recognize it as the same node instead of
 * two unrelated ones.
 */
function proposedFileNodeId(rootDir: string, filePath: string): string {
	return `file:${path.resolve(rootDir, filePath)}`;
}

/**
 * Id for a proposed `externalModule` node, matching the pipelines'
 * `external:<module specifier>` scheme (see ../pipelines/ts/normalize.ts).
 */
function proposedExternalNodeId(moduleSpecifier: string): string {
	return `external:${moduleSpecifier}`;
}

/**
 * Id for any other proposed node (module/class/function/...). These can't
 * reuse the pipelines' own symbol-id scheme
 * (`symbol:<file>:<line>:<column>:<name>`) since a proposed symbol has no
 * source location yet; this stays deterministic across repeated "Design
 * Project" runs of the same intent so `populateProposedGraph` upserts each
 * node in place instead of duplicating it.
 */
function proposedSymbolNodeId(rootDir: string, node: ProposedNode): string {
	const scope = node.filePath ? proposedFileNodeId(rootDir, node.filePath) : 'unscoped';
	return `proposed:${node.kind}:${scope}:${node.name}`;
}

function proposedNodeId(rootDir: string, node: ProposedNode): string {
	if (node.kind === 'file') {
		if (!node.filePath) {
			throw new Error(`Proposed Graph node "${node.name}" has kind "file" but no filePath.`);
		}
		return proposedFileNodeId(rootDir, node.filePath);
	}
	if (node.kind === 'externalModule') {
		return proposedExternalNodeId(node.name);
	}
	return proposedSymbolNodeId(rootDir, node);
}

/**
 * Converts Claude's `propose_architecture` response into a `CodeGraph`
 * rooted at `rootDir` (the workspace folder the design is for), resolving
 * each node's `ref` to a stable Project Graph id and each edge's
 * `sourceRef`/`targetRef` to the matching node id.
 */
export function buildProposedGraph(rootDir: string, architecture: ProposedArchitecture): CodeGraph {
	const graph = createEmptyGraph();
	const idByRef = new Map<string, string>();

	for (const node of architecture.nodes) {
		if (idByRef.has(node.ref)) {
			throw new Error(`Proposed Graph has more than one node with ref "${node.ref}".`);
		}

		const id = proposedNodeId(rootDir, node);
		idByRef.set(node.ref, id);

		const graphNode: GraphNode = { id, kind: node.kind, name: node.name };
		if (node.filePath) {
			graphNode.filePath = path.resolve(rootDir, node.filePath);
		}
		if (node.language) {
			graphNode.language = node.language;
		}
		if (node.description) {
			graphNode.metadata = { description: node.description };
		}
		graph.nodes.push(graphNode);
	}

	for (const edge of architecture.edges) {
		const source = idByRef.get(edge.sourceRef);
		const target = idByRef.get(edge.targetRef);
		if (!source || !target) {
			throw new Error(`Proposed Graph edge references an unknown ref ("${edge.sourceRef}" -> "${edge.targetRef}").`);
		}

		const graphEdge: GraphEdge = { id: `proposed:${edge.kind}:${source}:${target}`, kind: edge.kind, source, target };
		if (edge.description) {
			graphEdge.metadata = { description: edge.description };
		}
		graph.edges.push(graphEdge);
	}

	return graph;
}
