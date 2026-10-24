import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readPublishedPackageLocks } from './published-package-inputs.mjs';
import { desktopBuildPlan } from './desktop-build-plan.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const repo = 'https://github.com/ECNU/EduWork/blob/main/';
const categories = ['institution', 'knowledge', 'desktop'];
const html = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const markdown = value => value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
export const docPath = (plugin, language) => `${plugin.docs}/README${language === 'en' ? '_EN' : ''}.md`;

// This is presentation metadata, not another product manifest. Require exact
// coverage of the npm inputs used by public assembly; never list an unbundled
// experiment merely because its source directory exists in the repository.
export function validateCatalog(catalog, locks) {
  assert.ok(Array.isArray(catalog) && catalog.length, 'Plugin catalog must be a nonempty array');
  const names = catalog.flatMap(plugin => [plugin.package, ...(plugin.companions ?? [])]);
  assert.equal(new Set(names).size, names.length, 'Duplicate plugin in catalog');
  assert.deepEqual([...names].sort(), locks.map(lock => lock.name).sort(), 'Plugin catalog must match public npm assembly inputs');
  for (const lock of locks) assert.equal(lock.publicationStatus, 'published', `Unpublished plugin: ${lock.name}`);
  for (const plugin of catalog) {
    assert.match(plugin.package, /^@eduwork\/dsh-[a-z0-9-]+$/);
    assert.ok(categories.includes(plugin.category), `Unknown category: ${plugin.category}`);
    assert.match(plugin.icon, /^[a-z-]+$/);
    assert.match(plugin.eyebrow, /^[A-Z &]+$/);
    assert.match(plugin.docs, /^packages\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/);
    for (const language of ['zh', 'en']) {
      for (const field of ['name', 'summary']) {
        assert.ok(typeof plugin[language]?.[field] === 'string' && plugin[language][field].trim(), `Missing ${language}.${field}: ${plugin.package}`);
      }
    }
  }
  return catalog;
}

export async function loadPluginCatalog() {
  const plan = await desktopBuildPlan({ core: projectRoot, version: '0.0.0' });
  const [catalog, locks] = await Promise.all([
    readFile(join(projectRoot, 'docs/plugin-catalog.json'), 'utf8').then(JSON.parse),
    readPublishedPackageLocks(plan.candidate),
  ]);
  validateCatalog(catalog, locks);
  await Promise.all(catalog.flatMap(plugin => ['zh', 'en'].map(language => access(join(projectRoot, docPath(plugin, language))))));
  return catalog;
}

export function renderPluginTable(catalog, language) {
  const header = language === 'en' ? '| Plugin | What it does |' : '| 插件 | 能做什么 |';
  return [header, '| --- | --- |', ...catalog.map(plugin => {
    const copy = plugin[language];
    return `| [${markdown(copy.name)}](${docPath(plugin, language)}) | ${markdown(copy.summary)} |`;
  })].join('\n');
}

export function renderPluginCards(catalog) {
  const translated = (tag, copy, field) => `<${tag} data-en="${html(copy.en[field])}">${html(copy.zh[field])}</${tag}>`;
  const cards = catalog.map(plugin => `        <article class="plugin-card" data-category="${plugin.category}" data-package="${plugin.package}">
          <div class="plugin-card-top"><svg aria-hidden="true"><use href="#${plugin.icon}"/></svg><span>${html(plugin.eyebrow)}</span></div>
          ${translated('h3', plugin, 'name')}<code>${plugin.package}</code>
          ${translated('p', plugin, 'summary')}
          <div><a href="${repo + docPath(plugin, 'zh')}" data-href-en="${repo + docPath(plugin, 'en')}" target="_blank" rel="noopener noreferrer">文档与源码 <svg aria-hidden="true"><use href="#arrow"/></svg></a><a href="https://www.npmjs.com/package/${plugin.package}" target="_blank" rel="noopener noreferrer" aria-label="npm: ${plugin.package}">npm ↗</a></div>
        </article>`).join('\n');
  return `<div class="plugin-filter" role="group" aria-label="筛选插件"><button aria-pressed="true" data-filter="all">全部插件 <span>${catalog.length}</span></button><button aria-pressed="false" data-filter="institution">机构接入</button><button aria-pressed="false" data-filter="knowledge">知识与内容</button><button aria-pressed="false" data-filter="desktop">桌面扩展</button></div>
      <div class="plugin-grid">
${cards}
      </div><p class="plugin-count" id="plugin-count" role="status">展示 ${catalog.length} 个插件 · 具体运行条件与兼容范围见各插件文档</p>`;
}
