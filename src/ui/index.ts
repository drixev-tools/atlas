// Extension-facing UI: the VS Code commands that build on the Project Graph
// Core (Analyze, Explore, Impact, Design) and the Activity Bar sidebar. The
// pure "run both pipelines and repopulate the store" orchestration behind
// the "Analyze Workspace" command lives in ./analyzeWorkspace, the pure
// dependency/consumer/test calculation behind the "Calculate Impact" command
// (Epic 8) in ./impact, the intent form and Proposed Graph orchestration
// behind the "Design Project" command (Epic 9) in ./designProject, and the
// "Open Architecture" command id in ./architecture (its Cytoscape.js webview
// implementation was retired in Fase 1.2, Epic D, pending the React Flow
// rebuild in Epic F — see extension.ts for the disabled command itself). The
// Activity Bar Tree View sidebar (Fase 1.1, Epic A) has its pure
// files/modules/symbols tree-building logic in ./sidebarData and its
// `vscode.TreeDataProvider`/registration in ./sidebarView.
export * from './architecture';
export * from './graphFocus';
export * from './analyzeWorkspace';
export * from './impact';
export * from './designProject';
export * from './sidebarData';
export * from './sidebarView';
