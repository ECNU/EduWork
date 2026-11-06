import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { DesktopExit } from '../src/desktop-exit.mjs'
import { DesktopLifecycle } from '../src/lifecycle.mjs'
import { startupDiagnostic, startupFailurePage, updaterStartupError } from '../src/startup-failure.mjs'
import { redactDiagnostic } from '../../dsh-host/diagnostics.mjs'
import { ConfigurationFile } from '../../dsh-host/configuration-file.mjs'
import { ContentUpdates } from '../../dsh-host/content-updates.mjs'
import { loadUserConfig } from '../../dsh-host/user-config.mjs'

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

test('publisher bootstrap remains specialized when the error is wrapped', () => {
  const error = new Error('Synthetic startup wrapper', {
    cause: Object.assign(Error('Synthetic offline bootstrap'), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' }),
  })
  const page = startupFailurePage({ ...settings, error })
  assert.equal(page.needsConfiguration, true)
  assert.match(page.html, /重试下载/)
  assert.match(page.html, /导入离线配置包/)
})

test('updater startup remains specialized when the error is wrapped', () => {
  const error = new Error('Synthetic startup wrapper', {
    cause: updaterStartupError(executable, Error('Synthetic updater failure')),
  })
  const page = startupFailurePage({ ...settings, error })
  assert.equal(page.executable, executable)
  assert.match(page.html, /修复后重试/)
  assert.match(page.html, /打开组件目录/)
  assert.doesNotMatch(page.html, /重新启动/)
})

test('aggregate startup diagnostics keep nested reasons and codes but drop private input and Host addresses', () => {
  let jsonError
  try { JSON.parse('{"A":["secret99",]}') } catch (error) { jsonError = error }
  const connection = Object.assign(Error('connect ECONNREFUSED 127.0.0.1:51234'), {
    code: 'ECONNREFUSED', errno: -4078, syscall: 'connect', address: '127.0.0.1', port: 51234,
  })
  const aggregate = new AggregateError([
    Object.assign(Error('Synthetic Host start failure'), { code: 'EHOSTSTART' }),
    Object.assign(Error('Synthetic Host cleanup failure'), { code: 'EHOSTSTOP' }),
    connection,
  ], 'desktop backend startup and cleanup failed', { cause: jsonError })
  const safe = startupDiagnostic(aggregate, text => redactDiagnostic(text))
  assert.ok(safe instanceof AggregateError)
  assert.equal(safe.errors.length, 3)
  assert.equal(safe.errors[0].message, 'Synthetic Host start failure')
  assert.equal(safe.errors[1].message, 'Synthetic Host cleanup failure')
  assert.equal(safe.errors[0].code, 'EHOSTSTART')
  assert.equal(safe.errors[1].code, 'EHOSTSTOP')
  assert.equal(safe.errors[2].code, 'ECONNREFUSED')
  assert.equal(safe.errors[2].errno, -4078)
  assert.equal(safe.errors[2].syscall, 'connect')
  assert.equal('address' in safe.errors[2], false)
  assert.equal('port' in safe.errors[2], false)
  const rendered = [safe.message, ...safe.errors.map(error => error.message)].join('\n')
  assert.match(rendered, /desktop backend startup and cleanup failed/)
  assert.match(rendered, /Synthetic Host start failure/)
  assert.match(rendered, /Synthetic Host cleanup failure/)
  assert.match(rendered, /connect ECONNREFUSED/)
  assert.match(rendered, /is not valid JSON/)
  assert.doesNotMatch(rendered, /secret99/)
  assert.doesNotMatch(rendered, /127\.0\.0\.1|51234/)
  for (const endpoint of ['localhost:3000', '[::1]:3000', '127.0.0.1']) {
    const scrubbed = startupDiagnostic(Error(`connect ECONNREFUSED ${endpoint}`), text => redactDiagnostic(text)).message
    assert.equal(scrubbed, 'connect ECONNREFUSED [Host 地址已隐藏]')
  }
  let truncated, leading
  try { JSON.parse('x' + 'a'.repeat(200) + '{"A":["secret99"]}') } catch (error) { truncated = error.message }
  try { JSON.parse('[' + '1,'.repeat(200) + 'x]') } catch (error) { leading = error.message }
  for (const raw of [truncated, leading]) {
    const scrubbed = startupDiagnostic(Error(raw), text => redactDiagnostic(text)).message
    assert.match(scrubbed, /is not valid JSON/)
    assert.doesNotMatch(scrubbed, /secret99|1,1,1,1|xaaaa/)
    assert.doesNotMatch(scrubbed, /\.\.\./)
  }
})

test('single-quote and backslash JSON token excerpts are hidden', () => {
  let singleQuote, backslash
  try { JSON.parse("'secret99'") } catch (error) { singleQuote = error }
  try { JSON.parse(String.fromCharCode(92) + 'syntheticProbe') } catch (error) { backslash = error }
  assert.match(singleQuote.message, /Unexpected token '''/)
  for (const [error, secret] of [[singleQuote, 'secret99'], [backslash, 'syntheticProbe']]) {
    const safe = startupDiagnostic(error, redactDiagnostic)
    assert.match(safe.message, /Unexpected token/)
    assert.match(safe.message, /is not valid JSON/)
    assert.doesNotMatch(safe.message, new RegExp(secret))
  }
})

test('JSON input scrubbing keeps neighboring quoted context and nested causes', () => {
  let jsonError
  try { JSON.parse('{\n"A":["secret99",]\n}') } catch (error) { jsonError = error }
  const context = 'Host context with a "quoted value", and another line'
  const connection = Object.assign(Error('connect ECONNREFUSED 127.0.0.1:51234'), { code: 'ECONNREFUSED' })
  const child = new Error('Synthetic child failure', { cause: connection })
  const aggregate = new AggregateError([child], 'Synthetic aggregate failure')
  const error = new Error(`${context}\n${jsonError.message}`, { cause: aggregate })
  const safe = startupDiagnostic(error, redactDiagnostic)
  assert.match(safe.message, /Host context with a "quoted value", and another line/)
  assert.match(safe.message, /Synthetic child failure/)
  assert.match(safe.message, /connect ECONNREFUSED/)
  assert.match(safe.message, /is not valid JSON/)
  assert.doesNotMatch(safe.message, /secret99|127\.0\.0\.1|51234/)
})

test('a wrapper message that already contains its cause is shown once', () => {
  const cause = Error('Synthetic cause')
  const wrapped = new Error(`wrapper: ${cause.message}`, { cause })
  assert.equal(startupDiagnostic(wrapped, redactDiagnostic).message, 'wrapper: Synthetic cause')
  const multiline = new Error(`first line\n${cause.message}`, { cause })
  assert.equal(startupDiagnostic(multiline, redactDiagnostic).message, 'first line\nSynthetic cause')
  const aggregate = new AggregateError([cause], 'aggregate summary')
  assert.equal(startupDiagnostic(new Error(`aggregate summary\n${cause.message}`, { cause: aggregate }), redactDiagnostic).message,
    'aggregate summary\nSynthetic cause')
})

test('different component failures keep their own repeated reason lines', () => {
  const host = Error('Synthetic Host start failure\nEPERM: operation not permitted')
  const updater = Error('Synthetic updater start failure\nEPERM: operation not permitted')
  const aggregate = new AggregateError([host, updater], 'desktop backend startup and cleanup failed')
  const wrapped = new Error(`synthetic startup wrapper\n${aggregate.message}`, { cause: aggregate })
  const message = startupDiagnostic(wrapped, redactDiagnostic).message
  assert.match(message, /Synthetic Host start failure/)
  assert.match(message, /Synthetic updater start failure/)
  assert.equal(message.match(/EPERM: operation not permitted/g)?.length, 2)
})

test('wrapped aggregate startup diagnostics expand the concrete causes', () => {
  const aggregate = new AggregateError([
    Error('Synthetic Host start failure'),
    Error('Synthetic Host cleanup failure'),
  ], 'desktop backend startup and cleanup failed')
  const wrapped = new Error(`${aggregate.message}\n内容回退状态未能保存：Synthetic rollback failure`, { cause: aggregate })
  const safe = startupDiagnostic(wrapped, text => redactDiagnostic(text))
  assert.match(safe.message, /desktop backend startup and cleanup failed/)
  assert.match(safe.message, /Synthetic Host start failure/)
  assert.match(safe.message, /Synthetic Host cleanup failure/)
  assert.match(safe.message, /Synthetic rollback failure/)
})

test('the generic configuration page scrubs input excerpts and loopback addresses', () => {
  let jsonError
  try { JSON.parse('{"A":["secret99",]}') } catch (error) { jsonError = error }
  const page = startupFailurePage({ ...settings, error: Error(`${jsonError.message}\nconnect ECONNREFUSED 127.0.0.1:51234`) })
  assert.match(page.html, /is not valid JSON/)
  assert.match(page.html, /connect ECONNREFUSED/)
  assert.doesNotMatch(page.html, /secret99|127\.0\.0\.1|51234/)
})

test('startup diagnostics copy only safe diagnostic fields', () => {
  const valid = Object.assign(Error('Synthetic valid failure'), { code: 'ECONNREFUSED', errno: -4078, syscall: 'connect' })
  const safeValid = startupDiagnostic(valid)
  assert.equal(safeValid.code, 'ECONNREFUSED')
  assert.equal(safeValid.errno, -4078)
  assert.equal(safeValid.syscall, 'connect')
  const error = Object.assign(Error('Synthetic private failure'), {
    code: 'sk-private-code', errno: 51234, syscall: 'connect 127.0.0.1:51234', token: 'sk-private', secret: 'private',
  })
  const safe = startupDiagnostic(error)
  assert.equal(safe.message, 'Synthetic private failure')
  assert.equal(safe.code, undefined)
  assert.equal(safe.errno, undefined)
  assert.equal(safe.syscall, undefined)
  assert.equal('token' in safe, false)
  assert.equal('secret' in safe, false)
  assert.equal(startupDiagnostic('Synthetic string failure').message, 'Synthetic string failure')
})

test('cancelled startup never presents the migration progress', () => {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('function showStartupProgress('), end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, 'showStartupProgress boundary changed')
  const events = [], window = {
    isDestroyed: () => false,
    webContents: { isLoadingMainFrame: () => false, send: () => events.push('boot-brand') },
    show: () => events.push('show'),
  }
  const context = {
    startupCancelled: true, startupMessage: '', mainWindow: window, mainWindowPresented: false,
    isQuitting: () => false, desktopFailureShown: false, desktopBootBrand: () => ({ name: 'Fixture' }),
    process, app: { isHidden: () => false },
  }
  runInNewContext(`${source.slice(start, end + 2)}\nglobalThis.progress = showStartupProgress`, context)
  context.progress('正在迁移旧版历史数据…')
  assert.deepEqual(events, [], 'Cancellation must suppress boot-brand and window presentation')
  assert.equal(context.startupMessage, '')
  context.startupCancelled = false
  context.progress('正在迁移旧版历史数据…')
  assert.deepEqual(events, ['boot-brand', 'show'])
})

function pending() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(setImmediate)

async function contentTrial(t) {
  const root = await mkdtemp(join(tmpdir(), 'startup-content-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const configPath = join(root, 'config/eduwork.jsonc'), dataRoot = join(root, 'data')
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, JSON.stringify({ schemaVersion: 1, features: { visionFallback: false }, organizations: [] }))
  const configurationFile = await new ConfigurationFile(configPath, dataRoot).open()
  const scope = 'c'.repeat(64), key = `1-${'d'.repeat(64)}`
  await configurationFile.apply({ scope, key, patch: { features: { visionFallback: true } }, revision: 1 })
  assert.equal(loadUserConfig(configPath).features.visionFallback, true, 'the trial changes the effective configuration')
  const statePath = join(dataRoot, 'content-updates', scope, 'state.json')
  await mkdir(dirname(statePath), { recursive: true })
  const state = { schemaVersion: 1, active: {}, pending: key, trial: key, trialPhase: 'starting', rejected: [], highest: 1 }
  await writeFile(statePath, JSON.stringify(state))
  const manager = Object.create(ContentUpdates.prototype)
  Object.assign(manager, { state, statePath, view: {}, configurationFile })
  return { root, configPath, statePath, key, manager }
}

function recoveryHarness(t, stage, { rollbackResult = true, rollbackResultOnOtherStages = false, waitForPicker = false, approveRestart = true, errorCode = 'EDUWORK_BOOTSTRAP_REQUIRED', rollbackError, healthError, migrationLaunch, onMigrationHealth, nativeRecovery, contentUpdates, cleanupResolved = false, resourceCloseError, hostStopError, onExitFailure } = {}) {
  const source = readFileSync(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('export async function showDesktopFailure('), end = source.indexOf('\n}\n', start)
  const stopStart = source.indexOf('export async function stopDesktopServices('), stopEnd = source.indexOf('\n}\n', stopStart)
  const quittingStart = source.indexOf('export function isQuitting()'), quittingEnd = source.indexOf('\n', quittingStart)
  assert.ok(start >= 0 && end > start, 'showDesktopFailure boundary changed')
  assert.ok(stopStart >= 0 && stopEnd > stopStart, 'stopDesktopServices boundary changed')
  assert.ok(quittingStart >= 0 && quittingEnd > quittingStart, 'isQuitting boundary changed')
  const events = [], waiting = pending(), operation = pending(), cleanup = pending(), picker = pending(), lifecycle = new DesktopLifecycle()
  if (cleanupResolved) cleanup.resolve()
  lifecycle.trackBridge({ close: () => cleanup.promise })
  if (hostStopError) lifecycle.trackHost({ async stop() { throw hostStopError } })
  const wait = async (step, value) => {
    if (stage === step) { waiting.resolve(); await operation.promise }
    return value
  }
  let window, exit
  const nativeCalls = []
  const app = { quit() {
    if (!exit.complete) { void exit.request(); return }
    events.push('quit')
  } }
  exit = new DesktopExit({ confirm: async () => approveRestart, close: async () => {
    if (waitForPicker) await picker.promise
    await context.stopDesktopServices()
  },
    relaunch: () => events.push('relaunch'), quit: () => app.quit(),
    failed: error => { if (onExitFailure) onExitFailure(error); else assert.fail(error) } })
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
    restartDesktop: options => { events.push('restart'); return exit.restart(options) },
    contentUpdates: contentUpdates ?? { close: () => events.push('content-abort'), rollback: async () => {
      const result = await wait('rollback', stage === 'rollback' ? rollbackResult : rollbackResultOnOtherStages)
      if (rollbackError) throw rollbackError
      return result
    },
      importOffline: () => { events.push('import'); return wait('import') } },
    retryPublisherContent: () => wait('retry'),
    migrationLaunch,
    writeMigrationHealth: async (...args) => { onMigrationHealth?.(...args); if (healthError) throw healthError }, startupFailurePage,
    productUpdateObserver: { dispose() { events.push('observer-dispose') } },
    desktopPet: { close() { if (resourceCloseError) throw resourceCloseError } },
    taskNotifications: { close() {} },
    removeWindowMenu() {}, attachWindowVisibility() {}, tray: undefined, mainWindow: undefined,
    mainWindowPresented: false, startupMessage: '', nativeTheme: { shouldUseDarkColors: true },
    dialog: { showOpenDialog: () => wait('selection', { canceled: false, filePaths: ['/synthetic/offline.json'] }),
      showMessageBox: async () => { events.push('error-dialog') } },
    stat: async () => ({ isFile: () => true, size: 1 }), readFile: async () => Buffer.from('synthetic'),
  }
  runInNewContext(`${source.slice(stopStart, stopEnd + 2).replace('export ', '')}\n${source.slice(quittingStart, quittingEnd).replace('export ', '')}\n${source.slice(start, end + 2).replace('export ', '')}\nglobalThis.recover = showDesktopFailure`, context)
  t.after(async () => { operation.resolve(); picker.resolve(); cleanup.resolve(); await tick(); await exit.pending })
  return {
    events, nativeCalls,
    async begin(error = Error('Synthetic startup failure')) {
      if (errorCode) error.code = errorCode
      const shown = context.recover(error, nativeRecovery ? failure => {
        nativeCalls.push(failure)
        return nativeRecovery(failure)
      } : undefined)
      if (!['rollback', 'show'].includes(stage)) {
        await shown
        if (stage === 'native' || stage === 'special') return
        window.webContents.emit('will-navigate', { preventDefault() {} },
          stage === 'retry' ? 'eduwork-startup://restart/' : 'eduwork-startup://import/')
      }
      await waiting.promise
    },
    async quit() { app.quit(); await tick(); assert.equal(lifecycle.closing, !waitForPicker) },
    async restart(options) { await exit.restart(options); await tick() },
    async finish(error) { if (error) operation.reject(error); else operation.resolve(); await tick() },
    async cleaned() { picker.resolve(); cleanup.resolve(); await exit.pending },
  }
}

test('ordinary startup failure runs migration cleanup before native recovery without creating a page', async t => {
  const order = []
  const f = recoveryHarness(t, 'native', {
    rollbackResult: false,
    errorCode: null,
    onMigrationHealth: () => order.push('migration-cleanup'),
    nativeRecovery: error => {
      order.push('native-recovery')
      assert.equal(error.message, 'Synthetic startup failure')
    },
  })
  await f.begin()
  assert.deepEqual(order, ['migration-cleanup', 'native-recovery'])
  assert.deepEqual(f.events, [])
  assert.equal(f.nativeCalls.length, 1)
})

for (const [name, error] of [
  ['direct bootstrap error', Object.assign(Error('Synthetic bootstrap'), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' })],
  ['wrapped bootstrap error', new Error('Synthetic wrapper', {
    cause: Object.assign(Error('Synthetic bootstrap'), { code: 'EDUWORK_BOOTSTRAP_REQUIRED' }),
  })],
  ['wrapped updater error', new Error('Synthetic wrapper', {
    cause: updaterStartupError(executable, Error('Synthetic updater failure')),
  })],
]) {
  test(`${name} keeps its product recovery page instead of native recovery`, async t => {
    const f = recoveryHarness(t, 'special', { errorCode: null, nativeRecovery: () => assert.fail('specialized failures must not call native recovery') })
    await f.begin(error)
    assert.equal(f.nativeCalls.length, 0)
    assert.ok(f.events.includes('window-created'))
    assert.ok(f.events.includes('window-shown'))
  })
}

test('rollback success restarts without invoking native recovery', async t => {
  const f = recoveryHarness(t, 'rollback', {
    rollbackResult: true,
    errorCode: null,
  })
  // A successful rollback exits through restart before classification.
  await f.begin()
  await f.finish()
  assert.equal(f.nativeCalls.length, 0)
  assert.equal(f.events.includes('restart'), true)
})

test('a failure after migration started records the failed migration marker', async t => {
  const launch = { schemaVersion: 1, marker: 'synthetic-migration' }
  const markers = []
  const f = recoveryHarness(t, 'native', {
    rollbackResult: false,
    errorCode: null,
    migrationLaunch: launch,
    onMigrationHealth: (...args) => markers.push(args),
    nativeRecovery: () => {},
  })
  await f.begin()
  assert.equal(markers.length, 1)
  assert.equal(markers[0][0], launch)
  assert.equal(markers[0][1], 'failed')
  assert.match(markers[0][2], /旧版数据仍保留/)
})

test('a declined rollback restart keeps a native recovery entry', async t => {
  const order = []
  const f = recoveryHarness(t, 'rollback', {
    rollbackResult: true,
    errorCode: null,
    approveRestart: false,
    nativeRecovery: error => {
      order.push('native-recovery')
      assert.equal(error.message, 'Synthetic startup failure')
    },
  })
  await f.begin()
  await f.finish()
  await tick()
  assert.deepEqual(order, ['native-recovery'])
  assert.equal(f.events.includes('restart'), true)
  assert.equal(f.events.includes('relaunch'), false)
  assert.equal(f.events.includes('quit'), false)
})

test('a rollback-success fallback does not write a health marker (baseline)', async t => {
  const markers = []
  const f = recoveryHarness(t, 'rollback', {
    rollbackResult: true,
    errorCode: null,
    approveRestart: false,
    migrationLaunch: { healthFile: 'synthetic-health' },
    onMigrationHealth: (...args) => markers.push(args),
    nativeRecovery: () => {},
  })
  await f.begin()
  await f.finish()
  await tick()
  assert.deepEqual(markers, [])
  assert.equal(f.nativeCalls.length, 1)
})

test('a cleanup failure after lifecycle shutdown keeps a native recovery entry', async t => {
  const cleanupFailure = Error('Synthetic tray cleanup failure')
  const failures = []
  const f = recoveryHarness(t, 'native', {
    rollbackResult: true,
    rollbackResultOnOtherStages: true,
    errorCode: null,
    cleanupResolved: true,
    resourceCloseError: cleanupFailure,
    onExitFailure: error => failures.push(error),
    nativeRecovery: () => {},
  })
  await f.begin()
  assert.equal(failures.length, 1)
  assert.equal(failures[0].resourceOnly, true)
  assert.equal(failures[0].critical, false)
  assert.equal(failures[0].cause, cleanupFailure)
  assert.equal(f.nativeCalls.length, 1)
  assert.equal(f.events.includes('restart'), true)
  assert.equal(f.events.includes('relaunch'), false)
  assert.equal(f.events.includes('quit'), false)
  assert.equal(f.events.includes('window-created'), false, 'Recovery must not open the product page after a failed restart')
})

test('a persistent resource cleanup failure still permits an approved quit', async t => {
  const f = recoveryHarness(t, 'native', {
    rollbackResultOnOtherStages: true,
    errorCode: null,
    cleanupResolved: true,
    resourceCloseError: Error('Synthetic tray cleanup failure'),
    onExitFailure: () => {},
    nativeRecovery: () => {},
  })
  await f.begin()
  assert.equal(f.nativeCalls.length, 1)
  await f.quit()
  assert.equal(f.events.filter(value => value === 'quit').length, 1)
})

test('a persistent resource cleanup failure still permits a recovery restart', async t => {
  const failures = []
  const f = recoveryHarness(t, 'native', {
    rollbackResultOnOtherStages: true,
    errorCode: null,
    cleanupResolved: true,
    resourceCloseError: Error('Synthetic tray cleanup failure'),
    onExitFailure: error => failures.push(error),
    nativeRecovery: () => {},
  })
  await f.begin()
  await f.restart()
  assert.equal(failures.length, 2)
  assert.equal(failures.every(error => error.resourceOnly === true && error.critical === false), true)
  assert.equal(f.events.includes('relaunch'), true)
  assert.equal(f.events.filter(value => value === 'quit').length, 1)
})

test('a critical Host stop failure is not tolerated by a recovery restart', async t => {
  const hostStopFailure = Error('Synthetic Host stop failure')
  const failures = []
  const f = recoveryHarness(t, 'native', {
    rollbackResultOnOtherStages: true,
    errorCode: null,
    cleanupResolved: true,
    hostStopError: hostStopFailure,
    onExitFailure: error => failures.push(error),
    nativeRecovery: () => {},
  })
  await f.begin()
  await f.restart({ strict: true })
  assert.equal(f.nativeCalls.length, 1)
  assert.equal(failures.length, 2)
  assert.equal(failures.every(error => error.critical === true), true)
  assert.equal(f.events.includes('relaunch'), false)
  assert.equal(f.events.includes('quit'), false)
})

test('a real content trial is rolled back through product recovery', async t => {
  const trial = await contentTrial(t)
  const f = recoveryHarness(t, 'native', {
    errorCode: null,
    cleanupResolved: true,
    contentUpdates: trial.manager,
    nativeRecovery: () => assert.fail('A successful trial rollback must restart without native recovery'),
  })
  await f.begin()
  assert.equal(loadUserConfig(trial.configPath).features.visionFallback, false, 'the product recovery restores the previous configuration')
  const journal = JSON.parse(await readFile(trial.statePath, 'utf8'))
  assert.equal(journal.trial, null)
  assert.equal(journal.pending, null)
  assert.deepEqual(journal.rejected, [trial.key])
  assert.equal(f.events.includes('restart'), true)
  assert.equal(f.events.includes('relaunch'), true)
})

test('rollback failure and migration health failure stay in the native diagnostic', async t => {
  const f = recoveryHarness(t, 'native', {
    rollbackResult: false,
    errorCode: null,
    rollbackError: Error('Synthetic rollback marker failure'),
    healthError: Error('Synthetic migration marker failure'),
    nativeRecovery: () => {},
  })
  await f.begin()
  assert.equal(f.nativeCalls.length, 1)
  assert.match(f.nativeCalls[0].message, /Synthetic startup failure/)
  assert.match(f.nativeCalls[0].message, /Synthetic rollback marker failure/)
  assert.match(f.nativeCalls[0].message, /Synthetic migration marker failure/)
  assert.equal(f.events.includes('window-created'), false)
})

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
