import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { join } from 'node:path'
import { DesktopLifecycle } from '../src/lifecycle.mjs'

const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
function body(name) {
  const start = source.indexOf(`async function ${name}(`), end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start)
  return source.slice(start, end + 2)
}

test('installed startup claims W before creating any browser profile or log directory', async () => {
  const calls = []
  const context = { settings: undefined, paths: undefined, join, process: { platform: 'win32', env: {} },
    app: { getAppPath: () => '/synthetic/program/resources/app' },
    readFileSync: () => JSON.stringify({ schemaVersion: 1, shell: 'electron', appId: 'org.eduwork.example.electron' }),
    desktopPaths: () => ({ layout: 'installed', writableRoot: '/synthetic/W', userData: '/synthetic/W/browser' }),
    claimInstalledData: async () => { calls.push('claim') },
    mkdirSync: () => { calls.push('mkdir'); throw new Error('boundary reached') },
  }
  runInNewContext(`${body('configureEduworkPaths')}\nglobalThis.run = configureEduworkPaths`, context)
  await assert.rejects(context.run(), /boundary reached/)
  assert.deepEqual(calls, ['claim', 'mkdir'])
})

test('a busy W focuses its existing application or stops without writing into W', async () => {
  for (const running of [true, false]) {
    const calls = []
    const context = { settings: undefined, paths: undefined, join, process: { platform: 'win32', env: {} },
      app: { getAppPath: () => '/synthetic/program/resources/app', setPath: () => calls.push('path'),
        requestSingleInstanceLock: () => !running, releaseSingleInstanceLock: () => calls.push('release-instance'), exit: code => calls.push(['exit', code]) },
      readFileSync: () => JSON.stringify({ schemaVersion: 1, shell: 'electron', appId: 'org.eduwork.example.electron' }),
      desktopPaths: () => ({ layout: 'installed', writableRoot: '/synthetic/W', userData: '/synthetic/W/browser' }),
      claimInstalledData: async () => { throw new Error('W busy') },
      existsSync: () => true, mkdirSync: assert.fail,
    }
    runInNewContext(`${body('configureEduworkPaths')}\nglobalThis.run = configureEduworkPaths`, context)
    if (running) { await context.run(); assert.deepEqual(calls, ['path', ['exit', 0]]) }
    else { await assert.rejects(context.run(), /W busy/); assert.deepEqual(calls, ['path', 'release-instance']) }
  }
})

test('quitting during lease acquisition waits for it and releases the acquired W lease', async () => {
  const lifecycle = new DesktopLifecycle(), calls = []
  let acquired
  const acquisition = new Promise(resolve => { acquired = resolve })
  const context = { lifecycle, settings: { distribution: 'example' }, paths: { layout: 'installed', writableRoot: '/synthetic/W' }, dataLease: undefined,
    claimWritableRoot: () => acquisition, releaseInstanceMutex: async lease => calls.push(lease),
    currentVault: undefined, contentUpdates: undefined, productUpdateObserver: { dispose() {} },
  }
  runInNewContext(`${body('claimInstalledData')}\n${body('stopDesktopServices')}\nglobalThis.claim = claimInstalledData; globalThis.stop = stopDesktopServices`, context)
  const claim = context.claim()
  await Promise.resolve()
  const stopped = context.stop()
  acquired({ lease: 'owned-lease' })
  await assert.rejects(claim, /shutting down/)
  await stopped
  assert.deepEqual(calls, ['owned-lease'])
})
