// Design Project (Epic 9): turning a user's intent for a new project/feature
// into a Proposed Graph. ./model holds the shared intent/response types, the
// Anthropic API key lives in SecretStorage via ./apiKey, ./claudeClient talks
// to Claude with tool use to get a structured architecture proposal back,
// and ./proposedGraph converts that into the pipeline-agnostic graph model
// ../core/populate persists as the Proposed Graph. The "Project Graph:
// Design Project" command itself (intent form, progress, messaging) lives in
// ../ui/designProject, matching where the other commands' vscode-facing
// wiring lives (../ui/analyzeWorkspace, ../ui/impact). ./settings adds the
// shared Claude settings (API key + model) infrastructure from Fase 1.2,
// Epic G, which the sidebar Settings view (../ui/settingsView) and Design
// Project both build on.
export * from './model';
export * from './apiKey';
export * from './claudeClient';
export * from './proposedGraph';
export * from './settings';
