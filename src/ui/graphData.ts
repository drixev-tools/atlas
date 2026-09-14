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
