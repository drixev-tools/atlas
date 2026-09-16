// tsc/esbuild only handle .ts sources, so the Python pipeline's server.py
// resource needs an explicit copy step into every output directory that
// runs at __dirname-relative paths alongside its compiled server.ts glue
// code. `out/` is tsc's unbundled test output, which mirrors src/'s
// directory structure, so server.js keeps its own __dirname and the copy
// must land in the matching pipelines/python subfolder. `dist/` is esbuild's
// single bundled extension.js, so __dirname there resolves to dist/ itself
// and the copy must land flat, next to it.
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'src', 'pipelines', 'python', 'server.py');
const targets = process.argv.slice(2);

if (targets.length === 0) {
	console.error('Usage: node copy-python-server.js <outputDir> [outputDir...]');
	process.exit(1);
}

const BUNDLED_TARGETS = new Set(['dist']);

for (const target of targets) {
	const destDir = BUNDLED_TARGETS.has(target)
		? path.join(__dirname, '..', target)
		: path.join(__dirname, '..', target, 'pipelines', 'python');
	fs.mkdirSync(destDir, { recursive: true });
	fs.copyFileSync(source, path.join(destDir, 'server.py'));
}
