// Browser entry point for the Project Graph webview, bundled standalone by
// esbuild (see esbuild.js) — React, React Flow, and this file's CSS imports
// included.
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
	createRoot(container).render(<App />);
}
