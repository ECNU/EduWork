import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { DesktopExit } from '../src/desktop-exit.mjs'
import { DesktopLifecycle } from '../src/lifecycle.mjs'
import { startupFailurePage, updaterStartupError } from '../src/startup-failure.mjs'

const settings = { productName: 'Synthetic EduWork', version: '0.0.0-test', config: 'C:\\Synthetic\\config\\eduwork.jsonc' }
const executable = 'C:\\Synthetic with spaces\\resources\\update\\EduWork-Updater.exe'
const failure = code => updaterStartupError(executable, Object.assign(Error(`spawn ${executable} ${code}`), { code }))

test('permission denial identifies the component, gives recovery steps and copyable diagnostics', () => {
  const page = startupFailurePage({ ...settings, error: failure('EACCES') })
  assert.match(page.html, /Windows 拒绝运行更新组件/)
  for (const text of ['拦截记录', '执行权限', '修复后重试', '复制错误信息', '打开组件目录']) assert.ok(page.html.includes(text))
  assert.ok(!page.html.includes('配置文件：'))
  assert.ok(!page.html.includes(settings.config))
  assert.ok(!page.html.includes('继续启动'))
  assert.match(page.html, /<details><summary>技术详情（EACCES）/)
  for (const text of [settings.productName, settings.version, executable, 'EACCES', `spawn ${executable} EACCES`]) assert.ok(page.diagnostics.includes(text))
})

test('missing and unknown executable failures do not claim an OS denial or proven corruption', () => {
  const missing = startupFailurePage({ ...settings, error: failure('ENOENT') })
  assert.match(missing.html, /系统未找到更新组件/)
  assert.doesNotMatch(missing.html, /Windows 拒绝运行/)
  const unknown = startupFailurePage({ ...settings, error: failure('UNKNOWN') })
  assert.match(unknown.html, /系统未能运行更新组件/)
  assert.doesNotMatch(unknown.html, /文件已损坏|Windows 拒绝运行|系统未找到更新组件/)
})

test('additional rollback errors preserve component-specific guidance and diagnostic context', () => {
  const error = new Error('Synthetic rollback write failed', { cause: failure('EPERM') })
  const page = startupFailurePage({ ...settings, error })
  assert.equal(page.executable, executable)
  assert.match(page.html, /Windows 拒绝运行更新组件/)
  assert.match(page.diagnostics, /Synthetic rollback write failed/)
  assert.match(page.diagnostics, /EPERM/)
})

test('paths, product names and errors are escaped, while copied diagnostics preserve literal text', () => {
  const payload = '<script>alert("synthetic")</script>&'
  const page = startupFailurePage({ ...settings, productName: payload, error: updaterStartupError(executable + payload, Error(payload)) })
  assert.ok(!page.html.includes('<script>'))
  assert.ok(page.html.includes('&lt;script&gt;'))
  assert.ok(page.diagnostics.includes(payload))
})

test('publisher bootstrap retains retry/import actions; generic configuration errors retain their original details', () => {
  const error = Object.assign(Error('Synthetic offline bootstrap'), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' })
  const bootstrap = startupFailurePage({ ...settings, error })
  assert.equal(bootstrap.needsConfiguration, true)
  assert.match(bootstrap.html, /正在等待发行配置/)
  assert.match(bootstrap.html, /eduwork-startup:\/\/import\//)
  assert.match(bootstrap.html, /重试下载/)
  const generic = startupFailurePage({ ...settings, error: Error('Synthetic invalid configuration') })
  assert.match(generic.html, /Synthetic invalid configuration/)
  assert.ok(generic.html.includes(settings.config))
  for (const page of [bootstrap, generic]) {
    assert.equal(page.executable, undefined)
    assert.equal(page.diagnostics, undefined)
    assert.doesNotMatch(page.html, /eduwork-startup:\/\/(copy|component)\//)
  }
})

function pending() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(setImmediate)

function recoveryHarness(t, stage, { rollbackResult = true, waitForPicker = false } = {}) {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('export async function showDesktopFailure('), end = source.indexOf('\n}\n', start)
  const stopStart = source.indexOf('export function stopDesktopServices('), stopEnd = source.indexOf('\n}\n', stopStart)
  const quittingStart = source.indexOf('export function isQuitting()'), quittingEnd = source.indexOf('\n', quittingStart)
  assert.ok(start >= 0 && end > start, 'showDesktopFailure boundary changed')
  assert.ok(stopStart >= 0 && stopEnd > stopStart, 'stopDesktopServices boundary changed')
  assert.ok(quittingStart >= 0 && quittingEnd > quittingStart, 'isQuitting boundary changed')
  const events = [], waiting = pending(), operation = pending(), cleanup = pending(), picker = pending(), lifecycle = new DesktopLifecycle()
  lifecycle.trackBridge({ close: () => cleanup.promise })
  const wait = async (step, value) => {
    if (stage === step) { waiting.resolve(); await operation.promise }
    return value
  }
  let window, exit
  const app = { quit() {
    if (!exit.complete) { void exit.request(); return }
    events.push('quit')
  } }
  exit = new DesktopExit({ confirm: async () => true, close: async () => {
    if (waitForPicker) await picker.promise
    await context.stopDesktopServices()
  },
    relaunch: () => events.push('relaunch'), quit: () => app.quit(), failed: assert.fail })
  class BrowserWindow {
    constructor() { window = this; this.webContents = new EventEmitter(); events.push('window-created') }
    isDestroyed() { return false }
    setSize() {}
    loadURL() { return wait('show') }
    show() { events.push('window-shown') }
  }
  const context = {
    app, BrowserWindow, lifecycle, desktopExit: exit, desktopFailureShown: false, progressWindow: undefined,
    settings, paths: { config: settings.config },
    restartDesktop: () => { events.push('restart'); exit.restart() },
    contentUpdates: { close: () => events.push('content-abort'), rollback: () => wait('rollback', stage === 'rollback' && rollbackResult),
      importOffline: () => { events.push('import'); return wait('import') } },
    retryPublisherContent: () => wait('retry'),
    migrationLaunch: undefined, writeMigrationHealth: async () => {}, startupFailurePage,
    removeWindowMenu() {}, attachWindowVisibility() {}, tray: undefined, mainWindow: undefined,
    mainWindowPresented: false, startupMessage: '', nativeTheme: { shouldUseDarkColors: true },
    dialog: { showOpenDialog: () => wait('selection', { canceled: false, filePaths: ['/synthetic/offline.json'] }),
      showMessageBox: async () => { events.push('error-dialog') } },
    stat: async () => ({ isFile: () => true, size: 1 }), readFile: async () => Buffer.from('synthetic'),
  }
  runInNewContext(`${source.slice(stopStart, stopEnd + 2).replace('export ', '')}\n${source.slice(quittingStart, quittingEnd).replace('export ', '')}\n${source.slice(start, end + 2).replace('export ', '')}\nglobalThis.recover = showDesktopFailure`, context)
  t.after(async () => { operation.resolve(); picker.resolve(); cleanup.resolve(); await tick(); await exit.pending })
  return {
    events,
    async begin() {
      const shown = context.recover(Object.assign(Error('Synthetic startup failure'), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' }))
      if (!['rollback', 'show'].includes(stage)) {
        await shown
        window.webContents.emit('will-navigate', { preventDefault() {} },
          stage === 'retry' ? 'eduwork-startup://restart/' : 'eduwork-startup://import/')
      }
      await waiting.promise
    },
    async quit() { app.quit(); await tick(); assert.equal(lifecycle.closing, !waitForPicker) },
    async finish(error) { if (error) operation.reject(error); else operation.resolve(); await tick() },
    async cleaned() { picker.resolve(); cleanup.resolve(); await exit.pending },
  }
}

for (const stage of ['rollback', 'retry', 'import']) {
  test(`quitting during ${stage} recovery does not turn the exit into a restart`, async t => {
    const f = recoveryHarness(t, stage)
    await f.begin(); await f.quit(); await f.finish(); await f.cleaned()
    assert.equal(f.events.includes('restart'), false)
    assert.equal(f.events.includes('relaunch'), false)
    assert.equal(f.events.filter(value => value === 'quit').length, 1)
  })
}

for (const stage of ['rollback', 'import']) {
  test(`accepted exit still blocks late ${stage} recovery while a native picker closes`, async t => {
    const f = recoveryHarness(t, stage, { waitForPicker: true })
    await f.begin(); await f.quit(); await f.finish(); await f.cleaned()
    assert.equal(f.events.includes('restart'), false)
    assert.equal(f.events.includes('relaunch'), false)
    assert.equal(f.events.filter(value => value === 'quit').length, 1)
  })
}

for (const stage of ['retry', 'import']) {
  test(`${stage} recovery still restarts after success`, async t => {
    const f = recoveryHarness(t, stage)
    await f.begin(); await f.finish(); await f.cleaned()
    assert.equal(f.events.filter(value => value === 'restart').length, 1)
    assert.equal(f.events.filter(value => value === 'relaunch').length, 1)
  })
  for (const quitting of [false, true]) {
    test(`${stage} recovery error ${quitting ? 'stays silent after exit starts' : 'remains visible while running'}`, async t => {
      const f = recoveryHarness(t, stage)
      await f.begin()
      if (quitting) await f.quit()
      await f.finish(Error('Synthetic cancelled recovery'))
      assert.equal(f.events.includes('error-dialog'), !quitting)
      assert.equal(f.events.includes('restart'), false)
    })
  }
}

test('a file selection completed after exit does not start an offline import', async t => {
  const f = recoveryHarness(t, 'selection')
  await f.begin(); await f.quit(); await f.finish()
  assert.equal(f.events.includes('import'), false)
  assert.equal(f.events.includes('restart'), false)
})

for (const stage of ['rollback', 'show']) {
  test(`startup recovery does not show a late window after quitting during ${stage}`, async t => {
    const f = recoveryHarness(t, stage, { rollbackResult: false })
    await f.begin(); await f.quit(); await f.finish()
    assert.equal(f.events.includes('window-shown'), false)
    if (stage === 'rollback') assert.equal(f.events.includes('window-created'), false)
  })
}
