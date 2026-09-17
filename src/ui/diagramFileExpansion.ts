// Pure helpers behind the "Open Architecture" layers view's second tier of
// progressive reveal (./webview/App.tsx's `DiagramLevelView`): once a folder
// is expanded (its member files merged onto the canvas as children, see
// App.tsx's own merge step), a member file that only ever gets imported — no
// outgoing edges of its own within that folder — adds nothing to "what does
// this folder do" and stays hidden until the user expands the file that
// imports it. Restricted to nested nodes (a
// `parentId` set, i.e. already-merged folder members): a top-level node — a
// folder box or a root-level file — is always visible regardless of its own
// in/out degree, since those are "main nodes" the layers view never hides.
import { DiagramModel } from '../core/diagramModel';

/** Every nested node (`parentId` set) in `model` with at least one incoming edge and no outgoing edges — a pure "leaf" dependency target, never a source. */
export function standaloneImportNodeIds(model: DiagramModel): Set<string> {
	const outDegree = new Map<string, number>();
	const inDegree = new Map<string, number>();
	for (const edge of model.edges) {
		outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
		inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
	}

	const result = new Set<string>();
	for (const node of model.nodes) {
		if (!node.parentId) {
			continue;
		}
		if ((outDegree.get(node.id) ?? 0) === 0 && (inDegree.get(node.id) ?? 0) > 0) {
			result.add(node.id);
		}
	}
	return result;
}

/**
 * The subset of `model` actually shown on canvas: every node that isn't a
 * standalone import target (`standaloneImportNodeIds`), plus any standalone
 * target reachable from a node in `expandedNodeIds`. Edges between two
 * visible nodes are kept; an edge to a still-hidden standalone target is
 * dropped along with it.
 */
export function visibleDiagramModel(model: DiagramModel, expandedNodeIds: ReadonlySet<string>): DiagramModel {
	const standalone = standaloneImportNodeIds(model);

	const visibleNodeIds = new Set<string>();
	for (const node of model.nodes) {
		if (!standalone.has(node.id)) {
			visibleNodeIds.add(node.id);
		}
	}
	for (const edge of model.edges) {
		if (standalone.has(edge.target) && expandedNodeIds.has(edge.source)) {
			visibleNodeIds.add(edge.target);
		}
	}

	return {
		nodes: model.nodes.filter((node) => visibleNodeIds.has(node.id)),
		edges: model.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
	};
}

/** Whether `nodeId` imports a standalone target not currently visible — the files view's cue that its card can still be expanded. */
export function hasHiddenStandaloneImports(model: DiagramModel, nodeId: string, visibleNodeIds: ReadonlySet<string>): boolean {
	const standalone = standaloneImportNodeIds(model);
	return model.edges.some((edge) => edge.source === nodeId && standalone.has(edge.target) && !visibleNodeIds.has(edge.target));
}
