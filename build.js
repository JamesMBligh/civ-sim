#!/usr/bin/env node
// Build script: bundles the app into a single self-contained
// docs/index.html suitable for GitHub Pages (Settings -> Pages ->
// deploy from branch, /docs folder).
//
// The app has no dependencies and no transpilation step, so "building"
// means inlining the js/*.js files (in the order index.html loads them)
// into one HTML file. Run with: node build.js

const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Strip the individual <script src="js/..."> tags, remembering their order.
let bundle = '';
const stripped = html.replace(
  /[ \t]*<script src="js\/([\w.-]+)"><\/script>\s*/g,
  (match, file) => {
    const code = fs.readFileSync(path.join(root, 'js', file), 'utf8');
    bundle += `\n// ---- js/${file} ----\n${code}`;
    return '';
  }
);

if (!bundle) {
  console.error('No js/*.js script tags found in index.html — nothing built.');
  process.exit(1);
}

const output = stripped.replace('</body>', `<script>${bundle}</script>\n</body>`);

const docsDir = path.join(root, 'docs');
fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, 'index.html'), output);
// .nojekyll stops GitHub Pages from running the output through Jekyll.
fs.writeFileSync(path.join(docsDir, '.nojekyll'), '');

console.log(`Built docs/index.html (${(output.length / 1024).toFixed(1)} kB)`);
