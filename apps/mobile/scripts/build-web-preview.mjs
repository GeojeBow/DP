#!/usr/bin/env node
/**
 * Packs `expo export --platform web` output into one self-contained HTML page
 * (no external files), for sharing a click-through preview of the app.
 *
 * Usage: node scripts/build-web-preview.mjs <export-dir> <out.html>
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [exportDir, outFile] = process.argv.slice(2);
if (!exportDir || !outFile) {
  console.error('Usage: node scripts/build-web-preview.mjs <export-dir> <out.html>');
  process.exit(1);
}

const html = readFileSync(join(exportDir, 'index.html'), 'utf8');
const styles = [...html.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');

const jsDir = join(exportDir, '_expo/static/js/web');
const bundles = readdirSync(jsDir).filter((f) => f.endsWith('.js'));
if (bundles.length !== 1) throw new Error(`Expected one web bundle, found ${bundles.length}`);
// "</script" inside the bundle would end the inline <script> early.
const js = readFileSync(join(jsDir, bundles[0]), 'utf8').replace(/<\/script/gi, '<\\/script');

const page = `<title>Trip Expense</title>
<style>
:root { --bg: #F6F7F9; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0B0F14; color-scheme: dark } }
:root[data-theme="dark"] { --bg: #0B0F14; color-scheme: dark }
html, body { height: 100%; background: var(--bg); }
</style>
${styles}
<div id="root"></div>
<script>
// Expo Router routes from location.pathname; a preview may be served from a sub-path.
try { if (location.pathname !== '/') history.replaceState(null, '', '/'); } catch (e) {}
</script>
<script>${js}</script>
`;
writeFileSync(outFile, page);
console.log(`Wrote ${outFile} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
