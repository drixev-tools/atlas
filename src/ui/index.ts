// Extension-facing UI: the VS Code commands that build on the Project Graph
// Core (Analyze, Explore, Impact, Design) and the Activity Bar sidebar. The
// pure "run both pipelines and repopulate the store" orchestration behind
// the "Analyze Workspace" command lives in ./analyzeWorkspace, the pure
// dependency/consumer/test calculation behind the "Calculate Impact" command
// (Epic 8) in ./impact, the intent form and Proposed Graph orchestration
// behind the "Design Project" command (Epic 9) in ./designProject, and the
// "Open Architecture" command's React Flow webview panel (Fase 1.2, Epic F —
// rebuilt after the Cytoscape.js version was retired in Epic D) in
// ./graphPanel, whose command id also lives, on its own, in ./architecture.
// The Activity Bar Tree View sidebar (Fase 1.1, Epic A) has its pure
// files/modules/symbols tree-building logic in ./sidebarData and its
// `vscode.TreeDataProvider`/registration in ./sidebarView. The workflow-
// relevance filter/reroute the graph panel renders (Fase 1.2, Epic E) lives
// in ./graphFilter, and the default-focus/progressive-expansion logic behind
// its React Flow view in ./graphFocus and ./graphExpansion.
export * from './architecture';
export * from './graphPanel';
export * from './graphFocus';
export * from './graphFilter';
export * from './graphExpansion';
export * from './graphLayout';
export * from './analyzeWorkspace';
export * from './impact';
export * from './designProject';
export * from './sidebarData';
export * from './sidebarView';
