// Pure mapping from the Project Graph Core's stored shape to the Cytoscape.js
// elements format the webview renders. Kept free of any `vscode`/webview
// dependency so it can be unit tested directly against `StoredGraph` fixtures.
import type cytoscape from 'cytoscape';
import { StoredEdge, StoredGraph, StoredNode } from '../core/store';

export function toCytoscapeElements(graph: StoredGraph): cytoscape.ElementDefinition[] {
	return [...graph.nodes.map(nodeToElement), ...graph.edges.map(edgeToElement)];
}

function nodeToElement(node: StoredNode): cytoscape.ElementDefinition {
	return {
		group: 'nodes',
		data: {
			id: node.id,
			label: node.name,
			kind: node.kind,
			status: node.status,
			filePath: node.filePath,
			language: node.language
		}
	};
}

function edgeToElement(edge: StoredEdge): cytoscape.ElementDefinition {
	return {
		group: 'edges',
		data: {
			id: edge.id,
			source: edge.source,
			target: edge.target,
			kind: edge.kind,
			status: edge.status
		}
	};
}

/**
 * Task 7 — the node the graph view focuses by default when it opens: the
 * `file` node for the editor's active file, if the workspace has one and
 * it's part of the graph; otherwise the first `file` node in the graph
 * (stable, sorted by path) so the view still opens focused on something
 * rather than empty. `undefined` only when the graph has no `file` nodes at
 * all (e.g. an empty, unanalyzed workspace).
 */
export function findInitialFocusNodeId(graph: StoredGraph, activeFilePath?: string): string | undefined {
	const fileNodes = graph.nodes.filter((node) => node.kind === 'file' && node.filePath);
	if (activeFilePath) {
		const active = fileNodes.find((node) => node.filePath === activeFilePath);
		if (active) {
			return active.id;
		}
	}
	const [first] = [...fileNodes].sort((a, b) => (a.filePath ?? '').localeCompare(b.filePath ?? ''));
	return first?.id;
}
