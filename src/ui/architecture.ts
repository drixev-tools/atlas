// The "Open Architecture" command id, kept in its own module (rather than
// alongside an implementation, the way analyzeWorkspace.ts/impact.ts do) so
// both extension.ts (which registers the command) and sidebarView.ts (whose
// shortcut list needs the id) can depend on it without a circular import now
// that its previous home, graphPanel.ts, is gone (Fase 1.2, Epic D). The
// command itself is disabled until the React Flow rebuild (Epic F) lands.
export const OPEN_ARCHITECTURE_COMMAND = 'agentGraph.openArchitecture';
