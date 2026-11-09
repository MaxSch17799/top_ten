import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Read-only report of the existing Vite output; no bundler or deployment configuration changes.
const assets = new URL('../frontend/dist/assets/', import.meta.url);
let names;
try { names = await readdir(assets); }
catch { throw new Error('No frontend build found. Run npm run build first.'); }
const rows = await Promise.all(names.filter(name => /\.(js|css)$/.test(name)).map(async name => {
  const bytes = await readFile(new URL(name, assets));
  return { asset: name, bytes: bytes.length, gzip: gzipSync(bytes).length };
}));
rows.sort((a, b) => b.bytes - a.bytes);
console.log(`Assets: ${fileURLToPath(assets)}`);
console.table(rows.map(row => ({ asset: row.asset, 'kB (decimal)': (row.bytes / 1000).toFixed(2), 'gzip kB': (row.gzip / 1000).toFixed(2) })));
console.log('Gzip sizes are local estimates, not measured network transfer or Brotli sizes. Lazy chunks are not all loaded on the homepage.');
