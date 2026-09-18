# Atlas

Atlas is a VS Code extension that helps you actually see the shape of your
codebase. It extracts a local graph of your project — modules, symbols,
calls, and dependencies — and turns it into diagrams you can explore,
so you can understand how a codebase fits together, trace how a change
ripples outward, and get your bearings in unfamiliar code without reading
every file first.

It works on TypeScript/JavaScript and Python projects. The graph is stored
locally and kept up to date incrementally as you edit, so the views stay
fresh without a manual re-scan.

## What you get

All commands live under the **Atlas** entry in the Command Palette
(`Ctrl+Shift+P`) and in the Atlas panel in the activity bar.

- **Analyze Workspace** — scans your project and builds the local code graph
  that every other view reads from.
- **Open Architecture** — an interactive diagram of your project's modules
  and how they depend on each other. Drag nodes around, click one to dim
  everything unrelated to it, and reset the layout whenever you want.
- **Show Active File Flow** — centers the diagram on the file you're
  currently editing, showing what calls into it and what it calls out to.
- **Show Sequence Diagram** — turns the call flow around the active file
  into a sequence diagram, so you can follow execution order without
  jumping between files.
- **Show Identified Architecture (AI)** — asks Claude to look at your
  observed graph and propose the higher-level architecture (layers, roles,
  groupings) it implies.

The sidebar also has an **AI Settings** view for configuring the Claude
model and your Anthropic API key.

## Requirements

- VS Code 1.85 or newer.
- An Anthropic API key, only if you want to use the AI-powered views
  (Sequence Diagram, Identified Architecture). Set it in the **AI Settings**
  sidebar view — it's stored in VS Code's SecretStorage (OS keychain), never
  in workspace settings or the local graph database. Everything else in the
  extension works without one.

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

## Privacy

Atlas keeps a small set of local usage counters (how many times each
command runs) in VS Code's own per-install storage (`context.globalState`).
There is no telemetry, and the extension makes no network calls on its own.

The only network traffic it ever generates is to Anthropic's API, and only
when you actively use an AI-powered view (Sequence Diagram or Identified
Architecture) with your own API key configured. Your code graph and API key
never leave your machine otherwise.

## License

MIT — see [LICENSE](./LICENSE).
