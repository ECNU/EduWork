import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DesktopDirectoryPicker } from '../src/directory-picker.mjs'
import { startNativeBridge } from '../src/native-vault.mjs'
import { pickDesktopDirectory } from '../../dsh-plugins/desktop-services/lib/directory-request.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(), isDestroyed: () => false, isMinimized: () => true,
    restore() {}, show() {}, focus() {},
  })
  const calls = []
  const picker = new DesktopDirectoryPicker({ getWindow: () => window, showOpenDialog: (parent, options) => {
    assert.equal(parent, window)
    assert.deepEqual(options.properties, ['openDirectory', 'createDirectory'])
    return new Promise((resolve, reject) => calls.push({ resolve, reject }))
  } })
  return { picker, window, calls }
}

test('cross-entry concurrency delivers a selection to exactly one caller', async t => {
  const { picker, calls } = fixture()
  const bridge = await startNativeBridge({ vault: { flush: async () => {} }, pickDirectory: signal => picker.pick(signal) })
  t.after(() => bridge.close())
  const first = pickDesktopDirectory(bridge.bootstrap.nativeBridge)
  while (!calls.length) await tick()
  assert.equal(await picker.pick(), null, 'IPC must not adopt the Host import selection')
  assert.equal(await pickDesktopDirectory(bridge.bootstrap.nativeBridge), null, 'a second Host flow must not adopt it either')
  assert.equal(calls.length, 1)
  calls[0].resolve({ canceled: false, filePaths: ['/synthetic/目录 with spaces'] })
  assert.equal(await first, '/synthetic/目录 with spaces')
  const next = picker.pick()
  await tick(); calls[1].resolve({ canceled: true, filePaths: [] })
  assert.equal(await next, null)
})

test('cancel and dialog failure both release the lock for a retry', async () => {
  const { picker, calls, window } = fixture()
  for (const error of [false, true]) {
    const result = picker.pick(); await tick()
    const call = calls.at(-1)
    if (error) { call.reject(new Error('OS dialog failure')); await assert.rejects(result, /OS dialog failure/) }
    else { call.resolve({ canceled: true, filePaths: [] }); assert.equal(await result, null) }
    assert.equal(picker.pending, undefined)
    assert.equal(window.listenerCount('closed'), 0)
    assert.equal(window.webContents.listenerCount('did-start-navigation'), 0)
  }
})

test('disconnect discards a stale choice and retains the lock until the OS closes', async t => {
  const { picker, calls } = fixture()
  const bridge = await startNativeBridge({ vault: { flush: async () => {} }, pickDirectory: signal => picker.pick(signal) })
  t.after(() => bridge.close())
  const controller = new AbortController()
  const request = pickDesktopDirectory(bridge.bootstrap.nativeBridge, controller.signal)
  while (!calls.length) await tick()
  controller.abort(); await assert.rejects(request, { name: 'AbortError' })
  // A disconnected HTTP response propagates cancellation to the main process.
  for (let n = 0; n < 100 && !picker.pending.abandoned; n++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(picker.pending.abandoned, true)
  assert.equal(await picker.pick(), null)
  calls[0].resolve({ canceled: false, filePaths: ['/synthetic/stale'] }); await tick()
  assert.equal(picker.pending, undefined)
  const retry = picker.pick(); await tick()
  calls[1].resolve({ canceled: false, filePaths: ['/synthetic/retry'] })
  assert.equal(await retry, '/synthetic/retry')
})

for (const reason of ['reload', 'closed', 'dispose']) test(`${reason} abandons the request without adopting a late result`, async () => {
  const { picker, window, calls } = fixture()
  const result = picker.pick(); await tick()
  if (reason === 'reload') window.webContents.emit('did-start-navigation', {}, 'dsh-app://app/', false, true)
  if (reason === 'closed') { window.isDestroyed = () => true; window.emit('closed') }
  if (reason === 'dispose') picker.dispose()
  assert.equal(await result, null)
  calls[0].resolve({ canceled: false, filePaths: ['/synthetic/late'] }); await tick()
  assert.equal(picker.pending, undefined)
})

test('unauthorized and malformed bridge requests never open a native dialog', async t => {
  let calls = 0
  const bridge = await startNativeBridge({ vault: { flush: async () => {} }, pickDirectory: async () => { calls++; return null } })
  t.after(() => bridge.close())
  const { baseURL, token } = bridge.bootstrap.nativeBridge
  const request = (body, headers = {}) => fetch(baseURL + '/v1/desktop/pick-directory', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, ...headers }, body: JSON.stringify(body),
  })
  assert.equal((await request({}, { authorization: 'Bearer invalid' })).status, 403)
  assert.equal((await request({}, { origin: 'https://foreign.invalid' })).status, 403)
  for (const body of [null, [], { path: '/synthetic' }]) assert.equal((await request(body)).status, 400)
  assert.equal(calls, 0)
})
