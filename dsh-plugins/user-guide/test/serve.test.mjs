import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { GUIDE_ROOT, ROUTE, createGuideHandler, resolveGuidePath } from '../lib/serve.js'

test('serves files inside guide/ only', () => {
  assert.equal(resolveGuidePath(ROUTE + '/'), join(GUIDE_ROOT, 'index.html'))
  assert.equal(resolveGuidePath(ROUTE + '/index.html'), join(GUIDE_ROOT, 'index.html'))
  for (const bad of [ROUTE + '/../package.json', ROUTE + '/%2e%2e/lib/index.js', ROUTE + '/..%2Flib%2Findex.js', ROUTE + '/.hidden.html',
    ROUTE + '/images/../../lib/serve.js', ROUTE + '/a\\..\\b.html', ROUTE + '/x.js', ROUTE + '/%E0%A4%A', '/other/index.html', ROUTE + '/a%00.html']) {
    assert.equal(resolveGuidePath(bad), null, bad)
  }
})

function call(url, method = 'GET') {
  return new Promise(resolve => {
    const res = { status: 0, headers: {}, body: undefined,
      writeHead(status, headers = {}) { this.status = status; this.headers = headers },
      end(body) { this.body = body; resolve(this) } }
    createGuideHandler()({ url, method }, res)
  })
}

test('handler returns the bundled guide with safe headers', async () => {
  const page = await call(ROUTE + '/')
  assert.equal(page.status, 200)
  assert.match(page.headers['Content-Type'], /text\/html/)
  assert.match(String(page.body), /EduWork 使用教程/)
  assert.match(page.headers['Content-Security-Policy'], /default-src 'none'/)
  assert.equal((await call(ROUTE)).status, 301)
  assert.equal((await call(ROUTE + '/missing.html')).status, 404)
  assert.equal((await call(ROUTE + '/', 'POST')).status, 405)
})

test('the bundled guide loads nothing from the network and opens web links outside', async () => {
  const html = String((await call(ROUTE + '/')).body)
  assert.doesNotMatch(html, /fonts\.googleapis|<script/)
  for (const link of html.match(/<a href="https?:[^>]+>/g) ?? []) assert.match(link, /target="_blank"/)
  assert.doesNotMatch(html, /src="https?:/)
})

test('writes the app theme into <html> only for light or dark', async () => {
  const { withTheme } = await import('../lib/serve.js')
  const page = Buffer.from('<!doctype html>\n<html lang="zh-CN"><body></body></html>')
  assert.match(String(withTheme(page, 'dark')), /<html data-theme="dark" lang="zh-CN">/)
  assert.match(String(withTheme(page, 'light')), /<html data-theme="light" lang/)
  assert.equal(withTheme(page, '"><script>'), page)
  assert.equal(withTheme(page, null), page)
})

test('tour.json reports the distribution settings with defaults', async () => {
  const { tourSettings } = await import('../lib/serve.js')
  const call2 = (tour, method = 'GET') => new Promise(resolve => {
    const res = { writeHead(status, headers = {}) { this.status = status; this.headers = headers }, end(body) { this.body = body; resolve(this) } }
    createGuideHandler({ tour })({ url: ROUTE + '/tour.json', method }, res)
  })
  const page = await call2(() => tourSettings({ productName: 'Campus AI', autoStart: false, steps: [{ id: 'welcome' }] }))
  assert.equal(page.status, 200)
  assert.match(page.headers['Content-Type'], /application\/json/)
  assert.deepEqual(JSON.parse(page.body), { productName: 'Campus AI', autoStart: false, steps: [{ id: 'welcome' }] })
  assert.deepEqual(tourSettings(), { productName: 'EduWork', autoStart: true, steps: [] })
  assert.equal((await call2(() => ({}), 'POST')).status, 405)
})
