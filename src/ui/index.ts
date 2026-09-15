// Graph renderer: a Cytoscape.js webview over the Project Graph Core, plus
// the VS Code commands that build on it (Analyze, Explore, Impact, Design).
// The webview panel lives in ./graphPanel, the pure Project Graph -> Cytoscape.js
// mapping in ./graphData, the pure "run both pipelines and repopulate the
// store" orchestration behind the "Analyze Workspace" command in
// ./analyzeWorkspace, the pure dependency/consumer/test calculation behind
// the "Calculate Impact" command (Epic 8) in ./impact, the intent form and
// Proposed Graph orchestration behind the "Design Project" command (Epic 9)
// in ./designProject, and the webview's own client-side script (bundled
// separately, see esbuild.js) in ./webview/main.ts. The Activity Bar Tree
// View sidebar (Fase 1.1, Epic A) has its pure files/modules/symbols
// tree-building logic in ./sidebarData and its `vscode.TreeDataProvider`/
// registration in ./sidebarView.
export * from './graphData';
export * from './graphPanel';
export * from './analyzeWorkspace';
export * from './impact';
export * from './designProject';
export * from './sidebarData';
export * from './sidebarView';
