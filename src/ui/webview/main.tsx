// Browser entry point shared by every webview panel this extension opens
// (see esbuild.js) — React, React Flow, and this file's CSS imports bundled
// once here rather than per panel. Which root component actually renders is
// decided by the `data-view` attribute the host sets on `#root` (see
// ../graphPanel.ts / ../activeFileFlowPanel.ts's `renderHtml`), since each
// panel is its own separate webview context loading this same script.
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';
import { ActiveFileFlowApp } from './ActiveFileFlowApp';
import { SequenceDiagramApp } from './SequenceDiagramApp';
import { IdentifiedArchitectureApp } from './IdentifiedArchitectureApp';

const container = document.getElementById('root');
if (container) {
	const view = container.dataset.view;
	const root = createRoot(container);
	if (view === 'activeFileFlow') {
		root.render(<ActiveFileFlowApp />);
	} else if (view === 'sequenceDiagram') {
		root.render(<SequenceDiagramApp />);
	} else if (view === 'identifiedArchitecture') {
		root.render(<IdentifiedArchitectureApp />);
	} else {
		root.render(<App />);
	}
}
