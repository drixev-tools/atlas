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
import { DiagramExternalDependency, DiagramMetrics, DiagramNodeKind } from '../../core/diagramModel';

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

/**
 * The selected node itself plus every node directly joined to it by an edge
 * (either endpoint) — what a diagram view keeps at full opacity while
 * dimming the rest, so a selection reads as "this node's actual
 * relationships" rather than just one highlighted box among many unrelated
 * ones. `undefined` (nothing selected) means every node/edge stays at full
 * opacity — the caller's cue not to dim anything.
 */
export function connectedNodeIds(edges: readonly { source: string; target: string }[], selectedId: string | undefined): ReadonlySet<string> | undefined {
	if (!selectedId) {
		return undefined;
	}
	const ids = new Set<string>([selectedId]);
	for (const edge of edges) {
		if (edge.source === selectedId) {
			ids.add(edge.target);
		} else if (edge.target === selectedId) {
			ids.add(edge.source);
		}
	}
	return ids;
}

/** How many external-dependency chips a card renders directly before folding the rest into a single "+N" chip — enough to be useful without a handful of npm packages pushing out a card with real fan-in/fan-out to measure. */
const EXTERNAL_DEPENDENCY_CHIP_LIMIT = 6;

export function visibleExternalDependencies(
	dependencies: readonly DiagramExternalDependency[]
): { shown: readonly DiagramExternalDependency[]; overflowCount: number } {
	if (dependencies.length <= EXTERNAL_DEPENDENCY_CHIP_LIMIT) {
		return { shown: dependencies, overflowCount: 0 };
	}
	return { shown: dependencies.slice(0, EXTERNAL_DEPENDENCY_CHIP_LIMIT), overflowCount: dependencies.length - EXTERNAL_DEPENDENCY_CHIP_LIMIT };
}

/** Number of `.ag-chip` elements `MetricChips` (./DiagramCardNode) actually renders for `metrics` — kept in lockstep with that component so `estimateDiagramCardHeight`'s row math matches what lands on screen. */
function countMetricChips(metrics: DiagramMetrics, showFanMetrics: boolean): number {
	const { shown, overflowCount } = visibleExternalDependencies(metrics.externalDependencies);
	return (
		(metrics.fileCount > 1 ? 1 : 0) +
		(metrics.symbolCount > 0 ? 1 : 0) +
		(showFanMetrics ? 1 : 0) +
		(metrics.changedFileCount > 0 ? 1 : 0) +
		shown.length +
		(overflowCount > 0 ? 1 : 0)
	);
}

const CARD_BASE_HEIGHT = 56;
const CARD_PURPOSE_ROW_HEIGHT = 16;
const CARD_METRICS_TOP_GAP = 9;
const CARD_METRICS_ROW_HEIGHT = 18;
/** Rough fit for this card's fixed width, not a text measurement — chips vary in width by label/dependency-name length, so this trades pixel-perfect wrapping for a height that's never short enough to clip content. */
const CARD_CHIPS_PER_ROW = 3;

/**
 * A leaf card's height, tall enough for every chip `MetricChips` renders to
 * actually fit instead of being clipped by `.ag-card`'s `overflow: hidden` —
 * the "many imports don't display well" problem a single fixed card height
 * caused. `hasPurpose` accounts for the one extra (always single-line)
 * `.ag-card-purpose` row a Claude-generated group description adds.
 */
export function estimateDiagramCardHeight(hasPurpose: boolean, metrics: DiagramMetrics | undefined, showFanMetrics = true): number {
	let height = CARD_BASE_HEIGHT;
	if (hasPurpose) {
		height += CARD_PURPOSE_ROW_HEIGHT;
	}
	const chipCount = metrics ? countMetricChips(metrics, showFanMetrics) : 0;
	if (chipCount > 0) {
		const rows = Math.ceil(chipCount / CARD_CHIPS_PER_ROW);
		height += CARD_METRICS_TOP_GAP + rows * CARD_METRICS_ROW_HEIGHT;
	}
	return height;
}
