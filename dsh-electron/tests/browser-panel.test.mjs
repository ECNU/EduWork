import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { BrowserPanel, BROWSER_PANEL_CHANNEL } from '../src/browser-panel.mjs'

function fixture() {
  const handlers = new Map(), messages = [], views = [], external = []
  const main = { mainFrame: { url: 'dsh-app://app/index.html' }, isDestroyed: () => false, send: (...args) => messages.push(args) }
  const window = { webContents: main, isDestroyed: () => false, getContentSize: () => [900, 600],
    contentView: { addChildView: view => views.push(view), removeChildView: view => views.splice(views.indexOf(view), 1) } }
  class View {
    constructor(options) {
      this.options = options
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, { getTitle: () => 'Fixture', getURL: () => 'https://example.test',
        isDestroyed: () => this.destroyed, isLoading: () => false,
        navigationHistory: { canGoBack: () => false, canGoForward: () => false },
        close: () => { this.destroyed = true; this.webContents.emit('destroyed') },
        loadURL: async url => { this.url = url },
      })
    }
    setBounds(bounds) { this.bounds = bounds }
  }
  const panel = new BrowserPanel({ WebContentsView: View, getWindow: () => window, openExternal: async url => external.push(url),
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) } })
  const command = (request, event = { sender: main, senderFrame: main.mainFrame }) => handlers.get(BROWSER_PANEL_CHANNEL)(event, request)
  return { panel, command, views, main, handlers, messages, external }
}
test('only the main trusted frame can command native browser presentation', async () => {
  const { panel, command, main } = fixture()
  assert.throws(() => command({ action: 'capabilities' }, { sender: {}, senderFrame: main.mainFrame }), /sender/)
  assert.throws(() => command({ action: 'capabilities' }, { sender: main, senderFrame: { url: 'dsh-app://app' } }), /sender/)
  main.mainFrame.url = 'https://example.test'
  assert.throws(() => command({ action: 'capabilities' }), /origin/)
  panel.close()
})
test('session changes detach without destroying; stale pane cleanup cannot hide the active pane', async () => {
  const { panel, views, command } = fixture()
  const a = panel.create({ owner: 'a', partition: 'test', mode: 'background' })
  const b = panel.create({ owner: 'b', partition: 'test', mode: 'background' })
  await command({ action: 'select', owner: 'a' })
  const bounds = { x: 700, y: 80, width: 500, height: 1000 }
  await command({ action: 'bounds', owner: 'a', lease: 'first', bounds })
  assert.deepEqual(a.view.bounds, { x: 700, y: 80, width: 200, height: 520 })
  await command({ action: 'bounds', owner: 'a', lease: 'second', bounds })
  await command({ action: 'hide', owner: 'a', lease: 'first' })
  assert.equal(views.length, 1)
  await command({ action: 'select', owner: 'b' })
  assert.equal(views.length, 0)
  assert.equal(Boolean(a.isDestroyed()), false)
  await assert.rejects(command({ action: 'bounds', owner: 'a', lease: 'first', bounds }), /not active/)
  await command({ action: 'bounds', owner: 'b', lease: 'b', bounds })
  assert.equal(views[0], b.view)
  panel.close()
  assert.equal(views.length, 0)
})
test('explicit reveal is monotonic; metadata updates do not request another reveal', async () => {
  const { panel } = fixture()
  const a = panel.create({ owner: 'a', partition: 'test', mode: 'background' })
  assert.equal(panel.snapshot('a').revision, 0)
  panel.present(a, true)
  const first = panel.snapshot('a').revision
  a.webContents.emit('did-navigate')
  assert.equal(panel.snapshot('a').revision, first)
  panel.present(a, true)
  assert.ok(panel.snapshot('a').revision > first)
  panel.close()
})
test('URL and geometry validation reject privileged navigation and nonfinite coordinates', async () => {
  const { panel, command } = fixture()
  panel.create({ owner: 'a', partition: 'test', mode: 'background' })
  await command({ action: 'select', owner: 'a' })
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.test']) {
    await assert.rejects(command({ action: 'navigate', owner: 'a', url }))
  }
  await assert.rejects(command({ action: 'bounds', owner: 'a', lease: 'x', bounds: { x: NaN, y: 0, width: 400, height: 300 } }))
  panel.close()
})

test('web links reveal the session page', async () => {
  const { panel, command, messages } = fixture()
  await assert.rejects(panel.openLink('https://example.test'), /conversation/)
  const a = panel.create({ owner: 'a', partition: 'test', mode: 'background' })
  await command({ action: 'select', owner: 'a' })
  await panel.openLink('https://example.test/report.pdf')
  assert.equal(a.view.url, 'https://example.test/report.pdf')
  assert.ok(panel.snapshot('a').revision > 0)
  await assert.rejects(panel.openLink('https://name:secret@example.test/clip.mp4'))
  await assert.rejects(panel.openLink('file:///clip.mp4'))
  panel.close()
})

test('external opening is explicit, restricted to web URLs and keeps the embedded page', async () => {
  const { panel, command, external } = fixture()
  const surface = panel.create({ owner: 'a', partition: 'test', mode: 'background' })
  await command({ action: 'select', owner: 'a' })
  assert.deepEqual(external, [])
  await command({ action: 'external', owner: 'a' })
  assert.deepEqual(external, ['https://example.test/'])
  assert.equal(panel.pages.get('a'), surface)
  for (const url of ['file:///tmp/test.pdf', 'javascript:alert(1)', 'https://user:password@example.test']) {
    await assert.rejects(command({ action: 'external', owner: 'a', url }))
  }
  await assert.rejects(command({ action: 'external', owner: 'b', url: 'https://example.test' }), /not active/)
  assert.equal(external.length, 1)
  panel.close()
})
