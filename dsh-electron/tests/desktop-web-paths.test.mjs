import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyDesktopRequest } from '../src/desktop-web-paths.mjs'

const classify = url => classifyDesktopRequest({ url })

test('the shell-owned BootPage documents and assets become available before the Host', () => {
  for (const path of ['/', '/index.html', '/favicon.ico', '/favicon.svg', '/manifest.webmanifest',
    '/assets/index.js', '/assets/index.css', '/assets/fonts/ui.woff2']) {
    assert.equal(classify('dsh-app://app' + path).kind, 'static', path)
  }
})

test('Host APIs, plugin bundles and sockets keep the Host readiness boundary', () => {
  for (const path of ['/api/settings/describe', '/plugins/example/client.js', '/socket', '/index.html/extra']) {
    assert.equal(classify('dsh-app://app' + path).kind, 'host', path)
  }
})

test('only the application origin can reach either branch', () => {
  assert.equal(classify('dsh-app://shell/index.html').kind, 'forbidden')
  assert.equal(classify('https://app/index.html').kind, 'forbidden')
  assert.equal(classify('dsh-app://app@evil/index.html').kind, 'forbidden')
  assert.equal(classify('dsh-app://user:secret@app/index.html').kind, 'forbidden')
  assert.equal(classify('not a url').kind, 'forbidden')
})

test('dot segments normalize before classification', () => {
  assert.equal(classify('dsh-app://app/assets/../api/settings/describe').kind, 'host')
  assert.equal(classify('dsh-app://app/api/../index.html').kind, 'static')
})
