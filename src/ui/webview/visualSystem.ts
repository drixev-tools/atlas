// Shared visual tokens for every diagram-based webview view: today the
// architecture view (./App.tsx's layer/file levels), and — per Fase 1.3's
// plan — the flow and sequence views planned next, reusing the same
// per-kind accent/icon, per-layer tint, and edge-kind styling rather than
// each view inventing its own. Colors are VS Code's own `--vscode-charts-*`
// custom properties (already theme-aware, flipping between light and dark
// with the editor's theme) rather than hand-picked hex values, so no
// separate light/dark table is needed here; matching CSS lives in
// ./styles.css under the `ag-` prefixed classes this module returns.
import { EdgeKind } from '../../pipelines/model';
import { DiagramNodeKind } from '../../core/diagramModel';

export type DiagramCardKind = Extract<DiagramNodeKind, 'group' | 'file' | 'class' | 'method' | 'function'>;

export interface DiagramKindVisual {
	/** Short, non-color-only glyph shown on a card/badge — never relied on alone, always paired with the accent color and a text label. */
	icon: string;
	label: string;
	/** CSS class selecting this kind's accent color, e.g. for a card's icon badge and border. */
	accentClassName: string;
}

export const DIAGRAM_KIND_VISUALS: Record<DiagramCardKind, DiagramKindVisual> = {
	group: { icon: 'L', label: 'Layer', accentClassName: 'ag-accent-group' },
	file: { icon: 'F', label: 'File', accentClassName: 'ag-accent-file' },
	class: { icon: 'C', label: 'Class', accentClassName: 'ag-accent-class' },
	method: { icon: 'M', label: 'Method', accentClassName: 'ag-accent-method' },
	function: { icon: 'ƒ', label: 'Function', accentClassName: 'ag-accent-function' }
};

export interface DiagramEdgeVisual {
	dash: 'solid' | 'dashed' | 'dotted';
	className: string;
}

export const DIAGRAM_EDGE_VISUALS: Record<EdgeKind, DiagramEdgeVisual> = {
	contains: { dash: 'solid', className: 'ag-edge-contains' },
	imports: { dash: 'solid', className: 'ag-edge-imports' },
	exports: { dash: 'solid', className: 'ag-edge-exports' },
	calls: { dash: 'solid', className: 'ag-edge-calls' },
	extends: { dash: 'dashed', className: 'ag-edge-extends' },
	implements: { dash: 'dotted', className: 'ag-edge-implements' },
	instantiates: { dash: 'dashed', className: 'ag-edge-instantiates' }
};

/** The edge kind a multi-kind `DiagramEdge` is labeled/colored by: whichever kind has the most occurrences, ties broken by `EDGE_KIND_PRIORITY`'s order so the same input always picks the same kind. */
const EDGE_KIND_PRIORITY: readonly EdgeKind[] = ['calls', 'imports', 'extends', 'implements', 'instantiates', 'exports', 'contains'];

export function dominantEdgeKind(kinds: readonly { kind: EdgeKind; count: number }[]): EdgeKind {
	let best: { kind: EdgeKind; count: number } | undefined;
	for (const entry of kinds) {
		if (!best || entry.count > best.count || (entry.count === best.count && EDGE_KIND_PRIORITY.indexOf(entry.kind) < EDGE_KIND_PRIORITY.indexOf(best.kind))) {
			best = entry;
		}
	}
	return best?.kind ?? 'imports';
}

const LAYER_TINT_COUNT = 6;

/** Deterministic tint class for a layer/group card's header, rotating through a fixed palette by the group's position among its siblings — a color cue on top of (never instead of) each card's name and folder icon. */
export function layerTintClassName(indexAmongSiblings: number): string {
	return `ag-layer-tint-${((indexAmongSiblings % LAYER_TINT_COUNT) + LAYER_TINT_COUNT) % LAYER_TINT_COUNT}`;
}
