// Webview-side script for the Project Graph view: renders whatever elements
// the extension host sends over postMessage using Cytoscape.js, and handles
// the view's own navigation (zoom, selection, neighbor highlighting) without
// any further round-trip to the host. Runs inside the webview's browser
// context (no `vscode` module access), bundled standalone by esbuild
// alongside Cytoscape.js itself (see esbuild.js) so nothing loads from a CDN.
import cytoscape from 'cytoscape';

interface VsCodeApi {
	postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface GraphUpdateMessage {
	type: 'graph:update';
	elements: cytoscape.ElementDefinition[];
}

const HIGHLIGHTED_CLASS = 'cy-highlighted';
const FADED_CLASS = 'cy-faded';

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
	// color/shape stay kind-driven) but before `node:selected`/`edge:selected`
	// so selection is always the most prominent state on screen.
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
	{
		selector: 'node:selected',
		style: {
			'border-width': 2,
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
			opacity: 0.6
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
	},
	{
		selector: `.${FADED_CLASS}`,
		style: { opacity: 0.12 }
	},
	{
		selector: `.${HIGHLIGHTED_CLASS}`,
		style: { opacity: 1 }
	}
];

const vscode = acquireVsCodeApi();
const container = document.getElementById('cy');
const emptyState = document.getElementById('empty-state');

let cy: cytoscape.Core | undefined;

function render(elements: cytoscape.ElementDefinition[]): void {
	if (!container) {
		return;
	}
	if (cy) {
		cy.destroy();
	}
	if (emptyState) {
		emptyState.hidden = elements.length > 0;
	}

	cy = cytoscape({
		container,
		elements,
		style,
		layout: { name: 'cose', animate: false },
		wheelSensitivity: 0.2,
		minZoom: 0.1,
		maxZoom: 4
	});

	cy.on('tap', 'node', (event) => highlightNeighborhood(event.target));
	cy.on('tap', (event) => {
		if (event.target === cy) {
			clearHighlight();
		}
	});
}

/** Reveals a clicked node's relationships by dimming everything outside its closed neighborhood (itself, its edges, and the nodes on the other end of those edges). */
function highlightNeighborhood(node: cytoscape.NodeSingular): void {
	if (!cy) {
		return;
	}
	const neighborhood = node.closedNeighborhood();
	cy.elements().removeClass(HIGHLIGHTED_CLASS).addClass(FADED_CLASS);
	neighborhood.removeClass(FADED_CLASS).addClass(HIGHLIGHTED_CLASS);
}

function clearHighlight(): void {
	cy?.elements().removeClass(FADED_CLASS).removeClass(HIGHLIGHTED_CLASS);
}

window.addEventListener('message', (event: MessageEvent<GraphUpdateMessage>) => {
	if (event.data?.type === 'graph:update') {
		render(event.data.elements);
	}
});

window.addEventListener('resize', () => cy?.resize());

vscode.postMessage({ type: 'graph:ready' });
