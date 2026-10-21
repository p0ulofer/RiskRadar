/* Gera src/lib/leaflet-assets.ts a partir de node_modules/leaflet. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'node_modules', 'leaflet', 'dist');
const output = path.join(root, 'src', 'lib', 'leaflet-assets.ts');

const css = fs.readFileSync(path.join(dist, 'leaflet.css'), 'utf8');
const js = fs.readFileSync(path.join(dist, 'leaflet.js'), 'utf8');
const version = require(path.join(root, 'node_modules', 'leaflet', 'package.json')).version;

const contents = `/* Gerado por scripts/generate-leaflet-assets.js. Leaflet ${version}, BSD-2-Clause, https://leafletjs.com. */
export const LEAFLET_VERSION = ${JSON.stringify(version)};
export const LEAFLET_CSS = ${JSON.stringify(css)};
export const LEAFLET_JS = ${JSON.stringify(js)};
`;

fs.writeFileSync(output, contents, 'utf8');
console.log(`Gerado ${path.relative(root, output)} (Leaflet ${version})`);
