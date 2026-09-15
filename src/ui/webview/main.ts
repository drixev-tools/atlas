// Webview-side script for the Project Graph view: renders whatever elements
// the extension host sends over postMessage using Cytoscape.js with a
// hierarchical (`cytoscape-dagre`) layout, and handles the view's own
// navigation — default-collapsed focus, progressive inline expansion, and
// the side detail panel (Fase 1.1, Epic B) — without any further round-trip
// to the host. Runs inside the webview's browser context (no `vscode` module
// access), bundled standalone by esbuild alongside Cytoscape.js and
// cytoscape-dagre themselves (see esbuild.js) so nothing loads from a CDN.
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { countEdges, GraphElement, visibleElements } from '../graphExpansion';

cytoscape.use(dagre);

interface VsCodeApi {
	postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface GraphUpdateMessage {
	type: 'graph:update';
	elements: GraphElement[];
	focusNodeId: string | undefined;
}

interface GraphSelectMessage {
	type: 'graph:select';
	nodeId: string;
}

type HostMessage = GraphUpdateMessage | GraphSelectMessage;

const FOCUS_CLASS = 'cy-focus';

const style: cytoscape.StylesheetJsonBlock[] = [
	{
		selector: 'node',
		style: {
			label: 'data(label)',
			'font-size': 8,
			'background-color': '#4a90d9',
			width: 22,
			height: 22,
			color: '#cccccc',
			'text-valign': 'bottom',
			'text-halign': 'center',
			'text-margin-y': 4,
			'text-wrap': 'ellipsis',
			'text-max-width': '80px'
		}
	},
	{
		selector: 'node[kind = "file"]',
		style: {
			'background-color': '#d9a54a',
			shape: 'round-rectangle',
			width: 28,
			height: 28
		}
	},
	{
		selector: 'node[kind = "externalModule"]',
		style: {
			'background-color': '#888888',
			shape: 'diamond'
		}
	},
	// Proposed vs Observed (Epic 10): `status` distinguishes code the pipelines
	// actually found (`observed_only`, the plain node/edge style above) from a
	// Design Project proposal not yet built (`proposed_only`, dashed/ghosted)
	// and a proposal that turned out to already exist in the code (`matched`,
	// highlighted). Declared after the kind-based rules above (background
	// color/shape stay kind-driven) but before `.cy-focus`/`node:selected` so
	// selection/focus are always the most prominent state on screen.
	{
		selector: 'node[status = "proposed_only"]',
		style: {
			'border-width': 2,
			'border-color': '#b18cf2',
			'border-style': 'dashed',
			'background-opacity': 0.35
		}
	},
	{
		selector: 'node[status = "matched"]',
		style: {
			'border-width': 2,
			'border-color': '#4caf50'
		}
	},
	// Marks the currently focused node (task 4/7): the anchor whose direct
	// relations are shown by default, distinct from `node:selected` (last
	// clicked, drives the detail panel) since they can be different nodes once
	// the user has expanded a neighbor.
	{
		selector: `.${FOCUS_CLASS}`,
		style: {
			'border-width': 3,
			'border-color': '#ffcc00'
		}
	},
	{
		selector: 'node:selected',
		style: {
			'border-width': 3,
			'border-color': '#ffffff'
		}
	},
	{
		selector: 'edge',
		style: {
			width: 1,
			'line-color': '#666666',
			'target-arrow-color': '#666666',
			'target-arrow-shape': 'triangle',
			'curve-style': 'bezier',
			opacity: 0.8
		}
	},
	{
		selector: 'edge[status = "proposed_only"]',
		style: {
			'line-color': '#b18cf2',
			'target-arrow-color': '#b18cf2',
			'line-style': 'dashed'
		}
	},
	{
		selector: 'edge[status = "matched"]',
		style: {
			'line-color': '#4caf50',
			'target-arrow-color': '#4caf50'
		}
	}
];

const dagreLayout: cytoscape.LayoutOptions = {
	name: 'dagre',
	rankDir: 'TB',
	nodeSep: 30,
	rankSep: 60,
	padding: 24,
	fit: true,
	animate: false
} as cytoscape.LayoutOptions;

const vscode = acquireVsCodeApi();
const container = document.getElementById('cy');
const emptyState = document.getElementById('empty-state');
const detailPanel = document.getElementById('detail-panel');
const detailTitle = document.getElementById('detail-title');
const detailFields = document.getElementById('detail-fields');
const detailClose = document.getElementById('detail-close');

let cy: cytoscape.Core | undefined;

/** Every node/edge the host knows about (Epic 4/5's Project Graph), independent of how much of it is currently on screen. */
let allElements: GraphElement[] = [];
/** Task 4/7 — the node whose direct relations are shown even with nothing else expanded. `undefined` when the graph has no `file` node to anchor on; the whole graph is then rendered instead (see `visibleGraphElements`). */
let focusNodeId: string | undefined;
/** Task 5 — nodes the user has expanded by clicking them (`focusNodeId` always included), each contributing its own direct relations to what's visible. */
let expandedNodeIds = new Set<string>();
/** Task 6 — the node the detail panel currently describes; not always `focusNodeId` once the user has clicked a neighbor. */
let selectedNodeId: string | undefined;

function visibleGraphElements(): GraphElement[] {
	return focusNodeId ? visibleElements(allElements, focusNodeId, expandedNodeIds) : allElements;
}

function renderGraph(): void {
	if (!container) {
		return;
	}
	if (cy) {
		cy.destroy();
	}
	if (emptyState) {
		emptyState.hidden = allElements.length > 0;
	}

	const elements = visibleGraphElements();
	cy = cytoscape({
		container,
		elements,
		style,
		layout: dagreLayout,
		wheelSensitivity: 0.2,
		minZoom: 0.1,
		maxZoom: 4
	});

	if (focusNodeId) {
		cy.$id(focusNodeId).addClass(FOCUS_CLASS);
	}
	if (selectedNodeId) {
		const selected = cy.$id(selectedNodeId);
		if (!selected.empty()) {
			selected.select();
		}
	}

	cy.on('tap', 'node', (event) => onNodeTap(event.target));
	cy.on('tap', (event) => {
		if (event.target === cy) {
			clearSelection();
		}
	});
}

/**
 * Task 5 — clicking a node both selects it (task 6: populates the detail
 * panel) and toggles its own direct relations in/out of the visible set. The
 * focus node's relations stay pinned visible (that's the default view, task
 * 4); clicking it only updates the selection/detail panel.
 */
function onNodeTap(node: cytoscape.NodeSingular): void {
	const nodeId = node.data('id') as string;
	selectedNodeId = nodeId;

	if (nodeId !== focusNodeId) {
		if (expandedNodeIds.has(nodeId)) {
			expandedNodeIds.delete(nodeId);
		} else {
			expandedNodeIds.add(nodeId);
		}
	}

	renderGraph();
	showDetailPanel(nodeId);
}

function clearSelection(): void {
	selectedNodeId = undefined;
	cy?.elements(':selected').unselect();
	hideDetailPanel();
}

function formatStatus(status: string): string {
	return status.replace(/_/g, ' ');
}

function showDetailPanel(nodeId: string): void {
	const element = allElements.find((candidate) => candidate.group === 'nodes' && candidate.data.id === nodeId);
	if (!detailPanel || !detailTitle || !detailFields || !element) {
		return;
	}
	const data = element.data as Record<string, unknown>;
	const { incoming, outgoing } = countEdges(allElements, nodeId);

	const fields: Array<[string, string]> = [
		['Kind', String(data.kind ?? '—')],
		['Status', formatStatus(String(data.status ?? '—'))]
	];
	if (data.filePath) {
		fields.push(['File', String(data.filePath)]);
	}
	if (data.language) {
		fields.push(['Language', String(data.language)]);
	}
	fields.push(['Outgoing relations', String(outgoing)]);
	fields.push(['Incoming relations', String(incoming)]);

	detailTitle.textContent = String(data.label ?? nodeId);
	detailFields.replaceChildren(
		...fields.flatMap(([term, description]) => {
			const dt = document.createElement('dt');
			dt.textContent = term;
			const dd = document.createElement('dd');
			dd.textContent = description;
			return [dt, dd];
		})
	);
	detailPanel.hidden = false;
}

function hideDetailPanel(): void {
	if (detailPanel) {
		detailPanel.hidden = true;
	}
}

detailClose?.addEventListener('click', () => clearSelection());

/**
 * Task 7 — the full graph plus the initial `focusNodeId` the host resolved
 * for "opening the view" (e.g. the active editor's file). Resets expansion
 * back to just the focus and clears any stale selection from a previous
 * graph.
 */
function loadGraph(elements: GraphElement[], initialFocusNodeId: string | undefined): void {
	allElements = elements;
	focusNodeId = initialFocusNodeId;
	expandedNodeIds = new Set(focusNodeId ? [focusNodeId] : []);
	selectedNodeId = undefined;
	hideDetailPanel();
	renderGraph();
}

/** Sidebar Panel (Fase 1.1, Epic A, task 3) / re-focusing the view on demand: switches the anchor to `nodeId`, collapsing back to just its direct relations, and opens the detail panel for it. No-op if `nodeId` isn't part of the currently loaded graph. */
function focusNode(nodeId: string): void {
	if (!allElements.some((element) => element.group === 'nodes' && element.data.id === nodeId)) {
		return;
	}
	focusNodeId = nodeId;
	expandedNodeIds = new Set([nodeId]);
	selectedNodeId = nodeId;
	renderGraph();
	showDetailPanel(nodeId);
	const node = cy?.$id(nodeId);
	if (node && !node.empty()) {
		cy?.animate({ center: { eles: node } }, { duration: 200 });
	}
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
	if (event.data?.type === 'graph:update') {
		loadGraph(event.data.elements, event.data.focusNodeId);
	} else if (event.data?.type === 'graph:select') {
		focusNode(event.data.nodeId);
	}
});

window.addEventListener('resize', () => cy?.resize());

vscode.postMessage({ type: 'graph:ready' });
