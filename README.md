# Atlas — See the shape of your codebase

Atlas turns your project into interactive diagrams inside VS Code. It builds a
local graph of your modules, files, functions, calls, and dependencies, so you
can understand how a codebase fits together, trace how a change ripples
outward, and get your bearings in unfamiliar code without reading every file
first.

Works with **TypeScript / JavaScript** and **Python** projects. Everything runs
locally, and the graph updates incrementally as you edit — no manual re-scan.

## Features

### Architecture map

Run **Atlas: Open Architecture** for an interactive diagram of your project.

- **Layers** — top-level folders and modules and how they depend on each other.
  Click a folder to expand it into its files.
- **Files** — every file in the project as its own node.
- **Symbols** — drill down to functions, classes, and the calls between them.
- Drag nodes to rearrange them, click one to dim everything unrelated to it,
  and reset the layout at any time.

### Active File Flow

**Atlas: Show Active File Flow** centers the diagram on the file you're
editing: what calls into it and what it calls out to. Switch editor tabs and
the view follows you.

### Sequence Diagram

**Atlas: Show Sequence Diagram** lets you pick a function in the active file
and shows how execution reaches it and what it calls, as a sequence diagram —
so you can follow the order of events without jumping between files.

Works out of the box. With an Anthropic API key configured, Claude also
rewrites each step into a readable label and adds a short summary.

### Identified Architecture (AI)

**Atlas: Show Identified Architecture (AI)** asks Claude to look at the
structure of your project and propose the architecture it implies — the
pattern (layered, hexagonal, MVC, …), the roles involved, and which role each
module plays. Requires an Anthropic API key.

### Export

Export diagrams as **Markdown (Mermaid)**, **SVG**, **PNG**, or **PDF** to drop
into docs, pull requests, or slides.

## Getting started

1. Open a folder or workspace containing TypeScript, JavaScript, or Python code.
2. Run **Atlas: Analyze Workspace** from the Command Palette (`Ctrl+Shift+P` /
   `Cmd+Shift+P`), or use the Atlas icon in the activity bar.
3. Run **Atlas: Open Architecture** to explore the result, or open any file and
   try **Atlas: Show Active File Flow**.

## Commands

| Command | What it does |
| --- | --- |
| `Atlas: Analyze Workspace` | Scans the project and builds the local code graph every view reads from |
| `Atlas: Open Architecture` | Interactive layers / files / symbols diagram |
| `Atlas: Show Active File Flow` | Diagram centered on the file you're editing |
| `Atlas: Show Sequence Diagram` | Sequence diagram for a function in the active file |
| `Atlas: Show Identified Architecture (AI)` | Claude-proposed architecture pattern and roles |
| `Atlas: Refresh Sidebar` | Refreshes the Atlas sidebar |

## AI features (optional)

Only the Identified Architecture view requires AI; the Sequence Diagram is
enhanced by it. Everything else works without an API key.

1. Get an API key from the [Anthropic Console](https://console.anthropic.com/).
2. Open the Atlas icon in the activity bar and paste it into the **AI Settings**
   view.

Your key is stored in VS Code's SecretStorage (your OS keychain) — never in
your settings files or the project.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `atlas.claudeModel` | `claude-sonnet-5` | Claude model used for AI features: `claude-opus-5` (most capable), `claude-sonnet-5` (balanced), or `claude-haiku-4-5` (fastest) |

## Requirements

- VS Code 1.85 or newer.
- **Python projects:** Python 3 available on your `PATH` (as `python3` or
  `python`).
- **AI features:** an Anthropic API key (see above).

## Privacy

- The code graph is stored locally in VS Code's per-workspace extension
  storage, not in your project folder.
- Atlas has no telemetry and makes no network calls on its own. It keeps a few
  local usage counters (how many times each command runs) in VS Code's own
  storage; they never leave your machine.
- The only network traffic is to Anthropic's API, and only when you use an AI
  feature with your own API key. It sends names and relationships — modules,
  files, functions, and how they connect. **Your source code is never sent.**

## Contributing & feedback

Found a bug or have an idea? [Open an issue](https://github.com/drixev-tools/atlas/issues).
Want to hack on the extension? See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).

## Support ❤️

I built this extension to help others and keep it free. If it adds value to
your workflow, consider supporting it:

- Star the repository
- Share it with other developers
- Send feedback and suggestions
- [Buy me a coffee](https://buymeacoffee.com/drixev)
- [GitHub Sponsors](https://github.com/sponsors/drixev)
