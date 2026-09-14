# Agent Graph

Agent Graph is a VS Code extension that extracts, persists, and visualizes the
code graph of a project — modules, symbols, calls, and dependencies — so you
can explore how a codebase is structured, measure the impact of a change
before making it, and keep a navigable map of your code as it evolves.

The extraction pipelines target TypeScript/JavaScript and Python projects.
The extracted graph is stored locally and updated incrementally as files
change, and can be explored through in-editor commands and a graph view.

This project is under active development, following the phased MVP plan
tracked internally epic by epic (project setup, extraction pipelines,
persistence, incremental updates, visualization, analysis commands, and
more).

## Status

Early development (MVP). Not yet published to the VS Code Marketplace.

## Development

Requirements: Node.js 20+ and npm.

```bash
npm install       # install dependencies
npm run watch     # compile in watch mode (esbuild + tsc)
```

Press `F5` in VS Code to launch an Extension Development Host with the
extension loaded.

Other useful scripts:

```bash
npm run compile   # type-check, lint, and build once
npm run lint       # run ESLint
npm test           # compile and run the extension test suite
npm run package    # production build (minified, no sourcemaps)
```

## License

MIT — see [LICENSE](./LICENSE).
