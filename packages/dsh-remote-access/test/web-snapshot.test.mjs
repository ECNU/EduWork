import assert from 'node:assert/strict'
import test from 'node:test'

import { snapshotUrls } from '../src/web-snapshot.js'

test('collects every URL source the boot page uses', () => {
  const html = [
    '<script type="module" crossorigin src="./assets/index-abc.js"></script>',
    '<link rel="stylesheet" href="/assets/index-abc.css">',
    '<script src="/plugins/one/client.js?rev=11"></script>',
    '<script>window.__DSH_BOOT__={"bundles":["/plugins/two/client.js?rev=12"]}</script>',
  ].join('\n')
  const rows = [
    { kind: 'script-src', src: '/plugins/three/client.js?rev=13' },
    { kind: 'script', code: 'window.__ModuleLoader__ = {}' },
  ]

  const urls = snapshotUrls(html, rows)

  for (const expected of [
    './assets/index-abc.js',
    '/assets/index-abc.css',
    '/plugins/one/client.js?rev=11',
    '/plugins/two/client.js?rev=12',
    '/plugins/three/client.js?rev=13',
  ]) {
    assert.ok(urls.includes(expected), `missing ${expected}`)
  }
})

test('collects bundle URLs embedded in the boot graph JSON', () => {
  const html = '<script>globalThis["__DSH_BOOT__"] = {"entries":[{"id":"x","url":"plugins/??@scope/x/client.js&rev=7"}]}</script>'
  const urls = snapshotUrls(html)
  assert.ok(urls.includes('plugins/??@scope/x/client.js&rev=7'))
})

test('decodes HTML entities in attributes before they are fetched', () => {
  const urls = snapshotUrls('<script src="plugins/??a,b&amp;rev=1"></script>')
  assert.ok(urls.includes('plugins/??a,b&rev=1'))
  assert.equal(urls.includes('plugins/??a,b&amp;rev=1'), false)
})

test('does not repeat a URL that appears in both the page and the rows', () => {
  const urls = snapshotUrls('<script src="/plugins/same/client.js"></script>', [
    { kind: 'script-src', src: '/plugins/same/client.js' },
  ])
  assert.equal(urls.filter(url => url === '/plugins/same/client.js').length, 1)
})
