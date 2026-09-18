# Contributing

## Setup

Requirements: Node.js 20+ and npm.

```bash
npm install       # install dependencies
npm run watch     # compile in watch mode (esbuild + tsc)
```

Press `F5` in VS Code to launch an Extension Development Host with the
extension loaded.

## Scripts

```bash
npm run compile   # type-check, lint, and build once
npm run lint      # run ESLint
npm test          # compile and run the extension test suite
npm run package   # production build (minified, no sourcemaps)
```