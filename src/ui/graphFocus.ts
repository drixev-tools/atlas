// Pure helper surviving the retirement of the Cytoscape.js graph view (Fase
// 1.2, Epic D): which node a future graph view should focus by default. Kept
// free of any rendering-library dependency so it can be reused as-is once
// the React Flow rebuild (Epic F) needs it again.
import { StoredGraph } from '../core/store';

/**
 * The node a graph view should focus by default when it opens: the `file`
 * node for the editor's active file, if the workspace has one and it's part
 * of the graph; otherwise the first `file` node in the graph (stable, sorted
 * by path) so the view still opens focused on something rather than empty.
 * `undefined` only when the graph has no `file` nodes at all (e.g. an empty,
 * unanalyzed workspace).
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
