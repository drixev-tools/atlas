# Agent Graph — Extension Quickstart

## What's in the folder

- `package.json` — the extension manifest. Declares the entry point
  (`dist/extension.js`), scripts, and dependencies.
- `src/extension.ts` — the extension's entry point. Exports `activate` and
  `deactivate`.
- `src/core`, `src/pipelines`, `src/ui`, `src/mcp-future` — folder structure
  reserved for later epics (persistence, extraction pipelines, graph
  rendering/commands, and a future MCP server, respectively).
- `esbuild.js` — bundles `src/extension.ts` into `dist/extension.js`.

## Get up and running

- Run `npm install` to install dependencies.
- Press `F5` to open a new window with the extension loaded (uses the
  "Run Extension" launch configuration).
- Set breakpoints in `src/extension.ts` to debug the extension.

## Make changes

- Changes are rebuilt automatically via `npm run watch`. Reload the
  Extension Development Host window (`Ctrl+R` / `Cmd+R`) to load them.

## Run tests

- Run `npm test` (compiles and launches the extension test suite in a
  headless VS Code instance via `@vscode/test-cli`).
- Or use the "Extension Tests" launch configuration from `F5`.

## Learn more

- [VS Code extension API](https://code.visualstudio.com/api)
