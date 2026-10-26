import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { loadPluginCatalog, validateCatalog, projectRoot } from './project-plugin-catalog.mjs';
import { replacePluginBlock, syncProjectDocs } from './sync-project-docs.mjs';

test('entry points cover installed npm packages with bilingual documentation', async () => {
  const catalog = await loadPluginCatalog();
  assert.ok(catalog.some(plugin => plugin.package === '@eduwork/dsh-annotation'));
  assert.ok(catalog.some(plugin => plugin.package === '@eduwork/dsh-remote-access'));
  assert.ok(!catalog.some(plugin => plugin.package === '@eduwork/dsh-calendar'));
  assert.ok(!catalog.some(plugin => plugin.package === '@eduwork/dsh-artifact-services'));
  assert.ok(catalog.find(plugin => plugin.package === '@eduwork/dsh-knowledge-studio').companions.includes('@eduwork/dsh-artifact-services'));
  await syncProjectDocs({ check: true });
});

test('reject both unbundled advertisements and missing installed plugins', async () => {
  const catalog = await loadPluginCatalog();
  const locks = catalog.flatMap(plugin => [plugin.package, ...(plugin.companions ?? [])]).map(name => ({ name, publicationStatus: 'published' }));
  const experiment = { ...catalog[0], package: '@eduwork/dsh-calendar' };
  assert.throws(() => validateCatalog([...catalog, experiment], locks), /must match public npm assembly inputs/);
  assert.throws(() => validateCatalog(catalog.slice(1), locks), /must match public npm assembly inputs/);
  assert.throws(() => validateCatalog(catalog, [...locks, { name: '@eduwork/dsh-new-plugin', publicationStatus: 'published' }]), /must match public npm assembly inputs/);
  assert.throws(() => validateCatalog(catalog, locks.map(lock => ({ ...lock, publicationStatus: 'pending' }))), /Unpublished plugin/);
});

test('regeneration preserves authored installation guidance and refuses ambiguous markers', () => {
  const source = '# Intro\n<!-- BEGIN GENERATED PLUGINS -->\nOld table\n<!-- END GENERATED PLUGINS -->\n## Installation\nKeep this.';
  const generated = replacePluginBlock(source, 'New table');
  assert.equal(generated, source.replace('Old table', 'New table'));
  assert.equal(replacePluginBlock(generated, 'New table'), generated);
  assert.throws(() => replacePluginBlock('# No markers', 'New'), /Expected one plugin block start/);
  assert.throws(() => replacePluginBlock(source + source, 'New'), /Expected one plugin block start/);
});

test('README local documentation and screenshots resolve in both languages', async () => {
  for (const name of ['README.md', 'README_EN.md']) {
    const source = await readFile(join(projectRoot, name), 'utf8');
    const paths = [...source.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]).filter(path => !/^(https?:|#)/.test(path));
    for (const path of paths) await access(join(projectRoot, path.split('#')[0]));
  }
});
