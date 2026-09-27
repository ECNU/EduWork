import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ElectronBrowserRuntime } from '../src/browser-runtime.mjs'

function fixture({ wait } = {}) {
  const created = [], session = new EventEmitter()
  session.setPermissionRequestHandler = () => {}
  session.setPermissionCheckHandler = () => {}
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; created.push(this)
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, { session, setWindowOpenHandler() {},
        debugger: { attach() {}, detach() {}, async sendCommand() { return { targetInfo: { targetId: 'owned' } } } } })
    }
    removeMenu() {}
    async loadURL() { await wait; if (this.destroyed) throw Error('Window destroyed') }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  return { runtime: new ElectronBrowserRuntime({ BrowserWindow: Window }), created, session }
}

test('closing during creation leaves no orphan window and rejects future creation', async () => {
  let release
  const wait = new Promise(resolve => { release = resolve })
  const { runtime, created, session } = fixture({ wait })
  const pending = runtime.create()
  runtime.close(); release()
  await assert.rejects(pending, /destroyed/)
  assert.ok(created[0].destroyed)
  assert.equal(runtime.windows.size, 0)
  assert.equal(session.listenerCount('will-download'), 0)
  await assert.rejects(runtime.create(), /closed/)
})

test('target closing and navigation stay within owned web surfaces', async () => {
  const { runtime, created } = fixture()
  const id = await runtime.create()
  assert.equal(runtime.closeTarget('application-window'), false)
  assert.equal(created[0].destroyed, false)
  for (const url of ['file:///secret', 'javascript:alert(1)', 'eduwork://settings']) {
    let prevented = false
    created[0].webContents.emit('will-redirect', { preventDefault() { prevented = true } }, url)
    assert.equal(prevented, true)
  }
  let prevented = false
  created[0].webContents.emit('will-navigate', { preventDefault() { prevented = true } }, 'https://example.test/')
  assert.equal(prevented, false)
  assert.equal(runtime.closeTarget(id), true)
  assert.equal(runtime.windows.size, 0)
  runtime.close()
})
