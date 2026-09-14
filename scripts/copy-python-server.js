// tsc/esbuild only handle .ts sources, so the Python pipeline's server.py
// resource needs an explicit copy step into every output directory that
// runs at __dirname-relative paths (out/ for tests, dist/ for the packaged
// extension) alongside its compiled server.ts glue code.
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'src', 'pipelines', 'python', 'server.py');
const targets = process.argv.slice(2);

if (targets.length === 0) {
	console.error('Usage: node copy-python-server.js <outputDir> [outputDir...]');
	process.exit(1);
}

for (const target of targets) {
	const destDir = path.join(__dirname, '..', target, 'pipelines', 'python');
	fs.mkdirSync(destDir, { recursive: true });
	fs.copyFileSync(source, path.join(destDir, 'server.py'));
}
