import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { startupHintMessage } from '../src/startup-hint.mjs'

const source = readFileSync(new URL('../src/boot-hint-preload.cjs', import.meta.url), 'utf8')
function boot({ logs = '/logs', root = true } = {}) {
  const page = { root, now: 0, appended: [], tick: null, cleared: false }
  const ipcRenderer = { sendSync: channel => (assert.equal(channel, 'eduwork:boot-hint'), startupHintMessage(logs)) }
  runInNewContext(source, {
    process: { isMainFrame: true }, location: { protocol: 'dsh-app:', host: 'app' },
    require: name => (assert.equal(name, 'electron'), { ipcRenderer }),
    Date: { now: () => page.now },
    document: {
      querySelector: () => (page.root ? {} : null),
      createElement: () => ({ style: {}, textContent: '', remove() { page.removed = true } }),
      body: { append: element => page.appended.push(element) },
    },
    setInterval: fn => { page.tick = fn; return 1 }, clearInterval: () => { page.cleared = true },
    addEventListener: () => {},
  })
  return page
}

test('the BootPage stays quiet before the threshold', () => {
  const page = boot()
  page.now = 10_000; page.tick()
  assert.equal(page.appended.length, 0)
})

test('after the threshold it shows elapsed time and the log folder', () => {
  const logs = 'C:\\Users\\a\\AppData\\Local\\eduwork-electron\\logs'
  const page = boot({ logs })
  page.now = 95_000; page.tick()
  assert.equal(page.appended.length, 1)
  assert.match(page.appended[0].textContent, /^已等待 95 秒。/u)
  assert.ok(page.appended[0].textContent.endsWith(logs))
})

test('the hint goes away with the BootPage', () => {
  const page = boot()
  page.now = 40_000; page.tick()
  page.root = false; page.tick()
  assert.equal(page.removed, true)
  assert.equal(page.cleared, true)
})
