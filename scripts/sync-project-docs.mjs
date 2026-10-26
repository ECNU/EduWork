import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, loadPluginCatalog, renderPluginTable, renderPluginCards } from './project-plugin-catalog.mjs';

export function replacePluginBlock(source, generated) {
  const start = '<!-- BEGIN GENERATED PLUGINS -->', end = '<!-- END GENERATED PLUGINS -->';
  assert.equal(source.split(start).length, 2, 'Expected one plugin block start');
  assert.equal(source.split(end).length, 2, 'Expected one plugin block end');
  const left = source.indexOf(start) + start.length, right = source.indexOf(end);
  assert.ok(right > left, 'Invalid plugin block boundaries');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  return source.slice(0, left) + eol + generated.replace(/\r?\n/g, eol) + eol + source.slice(right);
}

export async function syncProjectDocs({ check = false } = {}) {
  const catalog = await loadPluginCatalog();
  const targets = [
    ['README.md', renderPluginTable(catalog, 'zh')],
    ['README_EN.md', renderPluginTable(catalog, 'en')],
    ['website/index.html', renderPluginCards(catalog)],
  ];
  const stale = [];
  for (const [path, generated] of targets) {
    const file = join(projectRoot, path), source = await readFile(file, 'utf8');
    const next = replacePluginBlock(source, generated);
    if (source !== next) {
      if (check) stale.push(path);
      else await writeFile(file, next);
    }
  }
  assert.equal(stale.length, 0, `Outdated plugin introductions: ${stale.join(', ')}. Run node scripts/sync-project-docs.mjs`);
  return { plugins: catalog.length, files: targets.map(([path]) => path), check };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await syncProjectDocs({ check: process.argv.includes('--check') })));
}
