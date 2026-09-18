# Changelog

All notable changes to the Atlas extension are documented in this file.

## [0.1.0] - 2026-09-18

Initial release.

- Analyze TypeScript, JavaScript, and Python workspaces into a local code graph
  that updates incrementally as you edit.
- Interactive architecture diagram with layers, files, and symbols levels,
  draggable layout, and focus-on-selection dimming.
- Active File Flow view that follows the file you're editing.
- Sequence diagram for a function in the active file, optionally narrated by
  Claude.
- AI-identified architecture (pattern, roles, and role assignments per module).
- Export diagrams as Markdown (Mermaid), SVG, PNG, or PDF.
- AI Settings sidebar view for the Anthropic API key (stored in SecretStorage)
  and Claude model selection.
