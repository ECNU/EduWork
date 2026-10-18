import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { usePinnedBrowser } from '../pinned-browser.mjs'
import { browserConfig } from '../../dsh-plugins/browser-upstream/lib/config.js'

test('official browser replaces the same activation entry and keeps standalone public search', async () => {
  const original = JSON.parse(await readFile(new URL('../../config/distributions/generic.json', import.meta.url)))
  const result = usePinnedBrowser(original)
  assert.equal(original.plugins.find(row => row.id === 'eduwork-browser').name, '@chatecnu-work/dsh-tool-browser')
  assert.equal(original.plugins.some(row => row.id === 'eduwork-ui-web-search'), false)
  assert.equal(original.patches.some(row => row.id === 'ui-settings-web-search'), false)
  assert.equal(result.plugins.filter(row => row.id === 'eduwork-ui-web-search').length, 1)
  assert.equal(result.patches.find(row => row.id === 'ui-settings-web-search').disabled, true)
  assert.equal(result.plugins.filter(row => row.id === 'eduwork-browser').length, 1)
  assert.equal(result.plugins.find(row => row.id === 'eduwork-browser').name, '@eduwork/dsh-browser-upstream')
  assert.equal(result.plugins.some(row => row.name === '@chatecnu-work/dsh-tool-browser'), false)
  assert.equal(result.plugins.filter(row => row.id === 'eduwork-search').length, 1)
  assert.equal(result.plugins.find(row => row.id === 'eduwork-search').name, '@chatecnu-work/dsh-tool-browser/search-auto')
  assert.equal(result.patches.find(row => row.id === 'web').config.searchProvider, 'eduwork-search')
  assert.equal(result.patches.some(row => row.insert?.some(entry => entry.id === 'eduwork-search')), false)
  assert.equal(result.skills.find(row => row.name === 'browser').source, 'dsh-skills/browser-upstream')
})

test('browser binds a present desktop resource; missing explicit resources fail', () => {
  assert.equal(browserConfig({}, { DSH_MEDIA_BROWSER: process.execPath }).executablePath, process.execPath)
  assert.equal(browserConfig({}, {}).executablePath, undefined)
  assert.throws(() => browserConfig({ executablePath: '/missing-synthetic-chromium' }, {}), /Chromium/)
  assert.throws(() => browserConfig({ headless: 'false' }, {}), /boolean/)
  assert.throws(() => browserConfig({ toolCallTimeoutMs: 0 }, {}), /toolCallTimeoutMs/)
})
