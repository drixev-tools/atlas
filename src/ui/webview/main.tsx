// Browser entry point for the Project Graph webview (Fase 1.2, Epic F),
// bundled standalone by esbuild (see esbuild.js) — React, React Flow, and
// this file's CSS imports included — the same way the retired Cytoscape.js
// version (Epic D) bundled Cytoscape into its own webview script.
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
	createRoot(container).render(<App />);
}
