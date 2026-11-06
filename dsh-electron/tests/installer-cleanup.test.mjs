import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath, symlink, rename, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { DesktopExit } from '../src/desktop-exit.mjs'
import { DesktopLifecycle } from '../src/lifecycle.mjs'
import { attachAppActivation } from '../src/window-visibility.mjs'
import { tmpdir } from 'node:os'
import { sourceInstaller, draggedInstaller, cleanInstaller, installFromDmg } from '../src/installer-cleanup.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'installer-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const appPath = join(root, 'Applications', 'Example.app'), mount = join(root, 'mounted')
  const source = join(mount, 'Example.app'), imagePath = join(root, 'Example.dmg')
  await mkdir(appPath, { recursive: true }); await mkdir(source, { recursive: true })
  await writeFile(imagePath, 'synthetic-image')
  const images = async () => [{ 'image-path': imagePath, 'system-entities': [{ 'mount-point': mount }] }]
  const identify = async () => 'same-signed-app'
  const calls = []
  const options = { appPath, images, identify, platform: 'darwin', wait: async () => {},
    app: { isPackaged: false, isInApplicationsFolder: () => true, getPath: () => root,
      moveToApplicationsFolder: () => { calls.push('move'); return true }, quit: () => calls.push('quit') },
    shell: { trashItem: async path => calls.push(['trash', path]) },
    dialog: { showMessageBox: async () => calls.push('error') },
    eject: async path => calls.push(['eject', path]), warn: message => calls.push(['warning', message]) }
  return { ...options, options, calls, source, imagePath, mount, statePath: join(root, 'pending-source-dmg-cleanup.json') }
}

test('automatic installation records only its own source before moving; installed startup ejects then trashes without prompting', async t => {
  const f = await fixture(t)
  assert.equal(await sourceInstaller(f.appPath, await f.images(), f.identify), null)
  assert.equal(await installFromDmg({ ...f.options, images: async () => [] }), false)
  assert.deepEqual(f.calls, [])
  assert.equal(await installFromDmg({ ...f.options, appPath: f.source, app: { ...f.app, isInApplicationsFolder: () => false } }), true)
  assert.equal(JSON.parse(await readFile(f.statePath, 'utf8')).imagePath, f.imagePath)
  assert.deepEqual(f.calls, ['move'])
  f.calls.length = 0
  assert.equal(await installFromDmg(f.options), false)
  assert.deepEqual(f.calls, [['eject', f.mount], ['trash', f.imagePath]])
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
})

test('dragged installation cleans its unique signed source once; replacing the application allows discovery again', async t => {
  const f = await fixture(t)
  assert.equal(await installFromDmg(f.options), false)
  assert.deepEqual(f.calls, [['eject', f.mount], ['trash', f.imagePath]])
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
  f.calls.length = 0
  await installFromDmg({ ...f.options, images: async () => assert.fail('A cleaned installation must not scan mounted images') })
  assert.deepEqual(f.calls, [])
  const replacement = join(f.appPath, '..', 'replacement.app')
  await mkdir(replacement)
  await rm(f.appPath, { recursive: true })
  await rename(replacement, f.appPath)
  await installFromDmg(f.options)
  assert.deepEqual(f.calls, [['eject', f.mount], ['trash', f.imagePath]])
})

test('a first startup without a mounted installer retries discovery on the next startup', async t => {
  const f = await fixture(t)
  await installFromDmg({ ...f.options, images: async () => [] })
  assert.deepEqual(f.calls, [])
  await installFromDmg(f.options)
  assert.deepEqual(f.calls, [['eject', f.mount], ['trash', f.imagePath]])
  assert.equal(JSON.parse(await readFile(join(f.app.getPath('userData'), 'dmg-installation.json'), 'utf8')).cleaned, true)
})

test('a receipt written before cleanup by an older version does not prevent discovery', async t => {
  const f = await fixture(t), file = await stat(f.appPath)
  await writeFile(join(f.app.getPath('userData'), 'dmg-installation.json'),
    JSON.stringify({ installation: `${file.dev}:${file.ino}:${file.birthtimeMs}` }))
  await installFromDmg(f.options)
  assert.deepEqual(f.calls, [['eject', f.mount], ['trash', f.imagePath]])
})

test('dragged installation preserves mismatching, invalid, ambiguous, and escaped source applications', async t => {
  const f = await fixture(t), images = await f.images()
  for (const identify of [async path => path === f.appPath ? 'installed' : 'different',
    async path => { if (path !== f.appPath) throw Error('invalid signature'); return 'installed' }]) {
    assert.equal(await draggedInstaller(f.appPath, images, identify), null)
  }
  const otherMount = join(f.mount, '..', 'other-mounted'), otherImage = join(f.mount, '..', 'other.dmg')
  await mkdir(join(otherMount, 'Example.app'), { recursive: true }); await writeFile(otherImage, 'another-image')
  const other = { 'image-path': otherImage, 'system-entities': [{ 'mount-point': otherMount }] }
  assert.equal(await draggedInstaller(f.appPath, [...images, other], f.identify), null)
  const alias = f.imagePath + '.alias.dmg'; await symlink(f.imagePath, alias)
  assert.equal((await draggedInstaller(f.appPath, [...images, { ...images[0], 'image-path': alias }], f.identify)).imagePath, f.imagePath)
  await rm(f.source, { recursive: true }); await symlink(f.appPath, f.source)
  assert.equal(await draggedInstaller(f.appPath, images, f.identify), null)
  assert.deepEqual(f.calls, [])
})

test('dragged cleanup retries a busy volume and preserves its source for later startup, even after ejection', async t => {
  const f = await fixture(t)
  let attempts = 0
  await installFromDmg({ ...f.options, eject: async () => { attempts++; throw Error('busy') } })
  assert.equal(attempts, 25)
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], 'warning')
  await access(f.imagePath); await access(f.statePath)
  const candidate = JSON.parse(await readFile(f.statePath, 'utf8'))
  f.calls.length = 0
  await installFromDmg({ ...f.options, images: async () => [] })
  assert.deepEqual(f.calls, [['trash', f.imagePath]])
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
  await writeFile(f.statePath, JSON.stringify(candidate)); f.calls.length = 0; attempts = 0
  await installFromDmg({ ...f.options, eject: async () => { if (++attempts < 3) throw Error('busy') } })
  assert.equal(attempts, 3); assert.deepEqual(f.calls, [['trash', f.imagePath]])
})

test('a dragged upgrade preserves a previous failed source and discovers its new signed image', async t => {
  const f = await fixture(t)
  await installFromDmg({ ...f.options, eject: async () => { throw Error('busy') } })
  await access(f.statePath)
  const mount = join(f.mount, '..', 'new-mounted'), imagePath = join(f.mount, '..', 'new-version.dmg')
  await mkdir(join(mount, 'Example.app'), { recursive: true }); await writeFile(imagePath, 'new-image')
  const replacement = join(f.appPath, '..', 'replacement.app')
  await mkdir(replacement)
  await rm(f.appPath, { recursive: true })
  await rename(replacement, f.appPath)
  f.calls.length = 0
  await installFromDmg({ ...f.options, identify: async path => path === f.source ? 'same-signed-app' : 'new-signed-app',
    images: async () => [...await f.images(), { 'image-path': imagePath, 'system-entities': [{ 'mount-point': mount }] }] })
  assert.deepEqual(f.calls, [['eject', mount], ['trash', imagePath]])
  await access(f.imagePath)
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
})

test('cancelled automatic installation preserves the image for the existing application; a later dragged replacement can clean it', async t => {
  const f = await fixture(t)
  await installFromDmg({ ...f.options, appPath: f.source, app: { ...f.app, isInApplicationsFolder: () => false,
    moveToApplicationsFolder: () => false } })
  assert.deepEqual(f.calls, ['quit'])
  f.calls.length = 0
  await installFromDmg(f.options)
  assert.deepEqual(f.calls, [])
  await access(f.imagePath)
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
  const replacement = join(f.appPath, '..', 'replacement.app')
  await mkdir(replacement)
  await rm(f.appPath, { recursive: true })
  await rename(replacement, f.appPath)
  await installFromDmg(f.options)
  assert.deepEqual(f.calls, [['eject', f.mount], ['trash', f.imagePath]])
})

test('failed installation preserves the image and removes the pending cleanup record', async t => {
  const f = await fixture(t)
  await installFromDmg({ ...f.options, appPath: f.source, app: { ...f.app, isInApplicationsFolder: () => false,
    moveToApplicationsFolder: () => { throw Error('denied') } } })
  assert.deepEqual(f.calls, ['error', 'quit'])
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
  await access(f.imagePath)
})

test('changed signature, malformed record, replaced image, and active source app never get trashed', async t => {
  const f = await fixture(t), candidate = await sourceInstaller(f.source, await f.images(), f.identify)
  const options = { ...f.options, trash: f.shell.trashItem }
  await assert.rejects(cleanInstaller(candidate, { ...options, identify: async () => 'other' }), /来源/)
  await assert.rejects(cleanInstaller({}, options), /来源/)
  await assert.rejects(cleanInstaller(candidate, { ...options, appPath: f.source }), /仍在使用/)
  assert.deepEqual(f.calls, [])
  await assert.rejects(cleanInstaller(candidate, { ...options, eject: async () => writeFile(f.imagePath, 'replacement') }), /已变化/)
  await assert.rejects(cleanInstaller(candidate, options), /已变化/)
  assert.deepEqual(f.calls, [])
})

test('Windows and Electron CLI development runs skip installation and cleanup', async t => {
  const f = await fixture(t)
  for (const options of [{ ...f.options, platform: 'win32' }, { ...f.options, defaultApp: true }]) {
    assert.equal(await installFromDmg(options), false)
  }
  assert.deepEqual(f.calls, [])
})

test('cleanup resolves image aliases and retains a record if trash fails', async t => {
  const f = await fixture(t), candidate = await sourceInstaller(f.source, await f.images(), f.identify)
  const alias = f.imagePath + '.alias'; await symlink(f.imagePath, alias)
  await writeFile(f.statePath, JSON.stringify(candidate))
  await installFromDmg({ ...f.options, images: async () => [{ 'image-path': alias, 'system-entities': [{ 'mount-point': f.mount }] }],
    shell: { trashItem: async () => { throw Error('trash denied') } } })
  assert.deepEqual(f.calls[0], ['eject', f.mount]); assert.equal(f.calls[1][0], 'warning')
  await access(f.statePath); await access(f.imagePath)
  f.calls.length = 0
  await rm(f.imagePath)
  await installFromDmg(f.options)
  await assert.rejects(access(f.statePath), { code: 'ENOENT' })
  assert.deepEqual(f.calls, [])
})

test('replacement requires approval and a running destination is never replaced', async t => {
  const f = await fixture(t)
  for (const [conflict, response, allowed] of [['exists', 1, false], ['exists', 0, true], ['existsAndRunning', 0, false]]) {
    let prompted = false
    const result = await installFromDmg({ ...f.options, appPath: f.source,
      dialog: { showMessageBoxSync: () => { prompted = true; return response } },
      app: { ...f.app, isInApplicationsFolder: () => false, moveToApplicationsFolder: options => {
        assert.equal(options.conflictHandler(conflict), allowed)
        return allowed
      } } })
    assert.equal(result, true)
    assert.equal(prompted, true)
    if (!allowed) await assert.rejects(access(f.statePath), { code: 'ENOENT' })
    await access(f.imagePath)
  }
})

// Exercise the built native entry and its actual single-instance, quit and backend
// controllers. Only Electron, product preparation and the Host are substituted.
const source = process.env.EDUWORK_TEST_NATIVE_SHELL && pathToFileURL(resolve(process.env.EDUWORK_TEST_NATIVE_SHELL, 'src') + '/')
const electron = 'data:text/javascript,export {}'
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : next(specifier, context)
} })
for (const scenario of ['installed', 'application-hidden', 'installer-exit', 'second-instance', 'quit-during-cleanup', 'preparation-visible', 'preparation-hidden', 'preparation-failure', 'host-failure', 'early-host-failure', 'host-start-cleanup-failure', 'early-configuration-failure', 'native-duplicate-renderer', 'native-recovery-rejected', 'renderer-before-page-load', 'web-boot-before-page-load', 'renderer-during-prepare', 'renderer-then-bootstrap', 'renderer-then-updater', 'renderer-before-ready-guard', 'renderer-during-desktop-ready', 'renderer-during-shell', 'renderer-during-sidebar-listen', 'renderer-rollback-cancelled-quit', 'renderer-rollback-cleanup-failure', 'renderer-rollback-persistent-cleanup-exit', 'renderer-rollback-persistent-cleanup-restart', 'renderer-host-stop-failure', 'renderer-host-stop-failure-trial', 'renderer-host-stop-failure-restart', 'quit-during-host', 'quit-host-stop-failure', 'quit-confirmation-dialog-failure', 'quit-during-shell', 'cancelled-quit-during-shell', 'recovery-exit-during-shell', 'recovery-restart-during-shell', 'quit-during-prepare', 'cancelled-quit-during-prepare', 'recovery-exit-during-prepare', 'recovery-restart-during-prepare', 'recovery-restart-stop-failure']) {
  test(`native installer startup: ${scenario}`, { skip: !source }, async t => {
    const calls = [], crashSources = [], crashReports = [], failureCalls = [], dialogOptions = [], exitFailures = [], app = new EventEmitter(), lifecycle = new DesktopLifecycle()
    let rollbackAttempts = 0
    const earlyFailure = scenario.startsWith('early-'), startupError = new Error('synthetic Host failure')
    const rendererError = new Error('Synthetic renderer failure'), cleanupError = new Error('Synthetic Host cleanup failure')
    const resourceError = Object.assign(Error('Synthetic resource cleanup failure'), { critical: false, resourceOnly: true })
    const stopFailureError = Object.assign(Error('Synthetic cleanup failure sk-private-token connect ECONNREFUSED 127.0.0.1:51234'), {
      code: 'ECONNREFUSED', errno: -4078, syscall: 'connect', address: '127.0.0.1', port: 51234,
    })
    const stopFailureLogs = []
    const pendingShell = scenario.endsWith('-shell'), pendingPrepare = scenario.endsWith('-prepare') && scenario !== 'renderer-during-prepare'
    const pendingSidebar = scenario === 'renderer-during-sidebar-listen'
    const specialAfterRenderer = ['renderer-then-bootstrap', 'renderer-then-updater'].includes(scenario)
    const deferredCleanup = ['renderer-before-page-load', 'renderer-before-ready-guard'].includes(scenario)
    const hostStopRestart = scenario === 'renderer-host-stop-failure-restart'
    const hostStopFailure = scenario === 'renderer-host-stop-failure' || hostStopRestart || scenario === 'renderer-host-stop-failure-trial'
    const normalQuitHostStopFailure = scenario === 'quit-host-stop-failure'
    const quitConfirmationDialogFailure = scenario === 'quit-confirmation-dialog-failure'
    const backgroundStopFailure = hostStopFailure || scenario === 'host-start-cleanup-failure'
    const pendingTrial = scenario === 'renderer-host-stop-failure-trial'
    const cleanupRestartFailure = scenario === 'renderer-rollback-cleanup-failure'
    const persistentCleanupFailure = scenario === 'renderer-rollback-persistent-cleanup-exit' || scenario === 'renderer-rollback-persistent-cleanup-restart'
    const rollbackRestart = scenario === 'renderer-rollback-cancelled-quit' || cleanupRestartFailure || persistentCleanupFailure
    const delayedHostFailure = rollbackRestart || hostStopFailure
    const hostStartCleanupFailure = scenario === 'host-start-cleanup-failure'
    const nativeFailure = ['host-failure', 'early-host-failure', 'host-start-cleanup-failure', 'preparation-failure', 'native-duplicate-renderer', 'native-recovery-rejected', 'renderer-before-page-load', 'web-boot-before-page-load', 'renderer-during-prepare', 'renderer-during-shell', 'renderer-during-sidebar-listen', 'renderer-rollback-cancelled-quit', 'renderer-rollback-cleanup-failure', 'renderer-rollback-persistent-cleanup-exit', 'renderer-rollback-persistent-cleanup-restart', 'renderer-host-stop-failure', 'renderer-host-stop-failure-trial', 'renderer-host-stop-failure-restart', 'renderer-before-ready-guard', 'renderer-during-desktop-ready'].includes(scenario) || specialAfterRenderer
    const fatalRecovery = scenario.startsWith('recovery-') || nativeFailure
    const cancelledQuit = scenario.startsWith('cancelled-quit-'), cancelFirstQuit = scenario === 'renderer-rollback-cancelled-quit'
    const restarting = scenario.startsWith('recovery-restart-') || scenario === 'renderer-rollback-cancelled-quit' || scenario === 'renderer-rollback-persistent-cleanup-restart'
    const stopFailure = scenario === 'recovery-restart-stop-failure'
    let closeFailureOnce = cleanupRestartFailure, specialFailureThrown = false
    if (stopFailure) t.mock.method(console, 'error', error => { stopFailureLogs.push(error); calls.push('stop-failure') })
    if (hostStopFailure || hostStartCleanupFailure) t.mock.method(console, 'error', () => {})
    if (scenario === 'early-configuration-failure') startupError.code = 'EDUWORK_BOOTSTRAP_REQUIRED'
    if (scenario === 'renderer-then-bootstrap') startupError.code = 'EDUWORK_BOOTSTRAP_REQUIRED'
    if (scenario === 'renderer-then-updater') startupError.code = 'EDUWORK_UPDATER_START_FAILED'
    const preparationFailure = new Error('Synthetic preparation wrapper', { cause: startupError })
    let guard = async () => true, completed, mainWindow, bridgeOptions, shellSignal, releaseShell, releasePrepare, releaseHostStart, releaseSidebarListen,
      releaseReady, releaseFailureCleanup, releaseRecoveryDialog, startupStarted, hostStartWaiting, hostStopStarted, sidebarListenStarted,
      failureCleanupStarted, readyReturned, crashReported, recoveryDialogShown, preparationCancelled = false
    let quitConfirmCalls = 0
    const done = new Promise(resolve => { completed = resolve })
    const waitingForStartup = new Promise(resolve => { startupStarted = resolve })
    const waitingForHostStart = new Promise(resolve => { hostStartWaiting = resolve })
    const waitingForHostStop = new Promise(resolve => { hostStopStarted = resolve })
    const waitingForSidebarListen = new Promise(resolve => { sidebarListenStarted = resolve })
    const waitingForFailureCleanup = new Promise(resolve => { failureCleanupStarted = resolve })
    const waitingForReadyReturn = new Promise(resolve => { readyReturned = resolve })
    const waitingForCrashReport = new Promise(resolve => { crashReported = resolve })
    const waitingForRecoveryDialog = new Promise(resolve => { recoveryDialogShown = resolve })
    let exitFailureShown
    const waitingForExitFailure = new Promise(resolve => { exitFailureShown = resolve })
    const cancelContentUpdates = () => {
      if (!(pendingPrepare || scenario === 'renderer-during-prepare' || specialAfterRenderer) || preparationCancelled) return
      preparationCancelled = true; calls.push('content-abort'); releasePrepare?.()
    }
    const stopDesktopServices = async () => {
      cancelContentUpdates()
      await lifecycle.close()
      // A tracked Host stop failure is critical; pet/tray cleanup alone is not.
      if (lifecycle.failures.length) {
        throw Object.assign(new Error('Synthetic Host stop failure'), { critical: true, resourceOnly: false })
      }
      // Simulate a tray/pet cleanup failure after the lifecycle has already closed.
      if (closeFailureOnce) { closeFailureOnce = false; throw resourceError }
      if (persistentCleanupFailure) throw resourceError
    }
    const exit = new DesktopExit({ confirm: () => {
      quitConfirmCalls++
      return cancelledQuit || (cancelFirstQuit && quitConfirmCalls === 1) ? Promise.resolve(false) : guard()
    },
      close: stopDesktopServices,
      relaunch: () => { assert.ok(restarting); calls.push('relaunch') }, quit: () => app.quit(),
      failed: error => { exitFailures.push(error); exitFailureShown() } })
    const restartDesktop = options => exit.restart(options)

    t.after(async () => { releaseShell?.(); releasePrepare?.(); releaseHostStart?.(); releaseSidebarListen?.(); releaseReady?.(); releaseFailureCleanup?.(); await new Promise(setImmediate); await exit.pending })
    app.getPath = () => '/unused'
    app.getLocale = () => 'en'
    app.getName = () => 'Fixture'
    app.getVersion = () => '0.0.0'
    app.isHidden = () => { assert.equal(process.platform, 'darwin'); return scenario === 'application-hidden' }
    app.requestSingleInstanceLock = () => { calls.push('lock'); return scenario !== 'second-instance' }
    app.whenReady = async () => { calls.push('ready') }
    app.quit = () => {
      if (!exit.complete) { void exit.request(); return }
      calls.push('quit'); app.emit('will-quit'); completed()
    }
    t.mock.module(electron, { exports: { app, dialog: { showMessageBox: async options => {
      dialogOptions.push(options)
      if (quitConfirmationDialogFailure && options.type !== 'error') throw new Error('Synthetic quit dialog failure')
      if (options.type === 'error') { calls.push('recovery-dialog'); recoveryDialogShown() }
      else calls.push('quit-dialog')
      if (scenario === 'native-recovery-rejected') throw new Error('Synthetic native dialog failure')
      if (specialAfterRenderer) await new Promise(resolve => { releaseRecoveryDialog = resolve })
      const wantsRestart = restarting || stopFailure || hostStopRestart
      return { response: wantsRestart && calls.filter(value => value === 'recovery-dialog').length === 1 ? 1 : 0 }
    } },
      protocol: { registerSchemesAsPrivileged() {}, handle() {} }, powerMonitor: new EventEmitter(), shell: { openPath: async () => '' } } })
    const mock = (file, exports) => t.mock.module(new URL(file, source).href, { exports })
    const pickDirectory = () => assert.fail('Installation startup must not open a directory picker')
    const bootBrand = () => ({ name: 'Synthetic EduWork', logo: '' })
    const { resolveDesktopLocale } = await import(new URL('locale.ts', source))
    const prior = process.env.EDUWORK_LAUNCHER_TEST
    process.env.EDUWORK_LAUNCHER_TEST = 'launcher-owned'
    t.after(() => { if (prior === undefined) delete process.env.EDUWORK_LAUNCHER_TEST; else process.env.EDUWORK_LAUNCHER_TEST = prior })
    mock('login-shell-environment.ts', {
      resolveDesktopLoginShellConfig: () => ({ timeoutMs: 1000 }),
      readDesktopLoginShellEnvironment: async (_environment, _config, { signal }) => {
        if (pendingShell) {
          shellSignal = signal
          calls.push('shell-wait')
          await new Promise(resolve => {
            releaseShell = resolve
            signal.addEventListener('abort', () => { calls.push('shell-abort'); resolve() }, { once: true })
            startupStarted()
          })
        }
        return { environment: { ...process.env,
          PATH: 'synthetic-login-shell-path', EDUWORK_LAUNCHER_TEST: 'shell-value', CHATECNU_UNTRUSTED_TEST: 'shell-value' } }
      },
    })
    mock('product.mjs', {
      configureEduworkPaths() {}, installEduworkFromDmg: async () => {
        calls.push('installer')
        if (scenario === 'quit-during-cleanup') { app.quit(); await exit.pending }
        if (scenario === 'installer-exit') { app.quit(); return true }
        return false
      }, prepareEduworkDesktop: () => lifecycle.prepare(async () => {
        calls.push('prepare')
        if (scenario.startsWith('preparation-')) {
          mainWindow.show()
          if (scenario === 'preparation-hidden') mainWindow.hide()
        }
        if (scenario === 'early-configuration-failure') throw startupError
        if (scenario === 'preparation-failure' || scenario === 'native-recovery-rejected') throw startupError
        if (scenario === 'renderer-during-prepare' || specialAfterRenderer) {
          calls.push('prepare-wait')
          const waiting = new Promise(resolve => { releasePrepare = resolve; startupStarted() })
          mainWindow.webContents.emit('preload-error', {}, 'preload-app.cjs', rendererError)
          await waiting
          if (specialAfterRenderer) { specialFailureThrown = true; throw preparationFailure }
          if (preparationCancelled) throw new Error('Desktop preparation was cancelled')
          lifecycle.check()
          calls.push('prepare-complete')
        }
        if (pendingPrepare) {
          calls.push('prepare-wait')
          await new Promise(resolve => { releasePrepare = resolve; startupStarted() })
          if (preparationCancelled) throw new Error('Desktop preparation was cancelled')
          lifecycle.check()
        }
        return {}
      }), stopDesktopServices, cancelDesktopStartup: () => { cancelContentUpdates() },
      desktopWebRoot: () => '/synthetic/web', desktopStartupWindowPresent: () => false,
      nativeBootstrap() {}, desktopReady: async shouldContinue => {
        calls.push('desktop-ready')
        if (normalQuitHostStopFailure || quitConfirmationDialogFailure) { app.quit(); return }
        if (stopFailure) queueMicrotask(() => bridgeOptions.onBootFailure(Error('Synthetic renderer failure')))
        else if (scenario === 'renderer-during-desktop-ready') {
          queueMicrotask(() => mainWindow.webContents.emit('preload-error', {}, 'preload-app.cjs', rendererError))
          await new Promise(resolve => { releaseReady = resolve })
          calls.push(shouldContinue() ? 'desktop-ready-committed' : 'desktop-ready-blocked')
          readyReturned()
        }
        else setTimeout(completed, 0)
      },
      trackHost: host => lifecycle.trackHost(host), desktopHostLog() {}, isQuitting: () => exit.closing || lifecycle.closing,
      isShutdownFailed: () => Boolean(exit.failure) && exit.pending === undefined && !exit.closing && !exit.complete,
      recordStartupStopFailureHealth: async () => { if (pendingTrial) return false; calls.push('health-failed'); return true },
      attachDesktopWindow() {}, configureWindowNavigation() {}, showDesktopFailure: async (error, nativeRecovery) => {
        rollbackAttempts++
        failureCalls.push(error)
        if (deferredCleanup) {
          calls.push('failure-cleanup-start')
          failureCleanupStarted()
          await new Promise(resolve => { releaseFailureCleanup = resolve })
          calls.push('failure-cleanup-finished')
        }
        if (rollbackRestart) {
          calls.push('failure-cleanup-start'); failureCleanupStarted()
          await new Promise(resolve => { releaseFailureCleanup = resolve })
          calls.push('failure-cleanup-finished')
          await restartDesktop({ strict: true })
          if (!exit.complete && !exit.closing) { calls.push('native-recovery'); await nativeRecovery(error) }
          return
        }
        if (error?.code === 'EDUWORK_BOOTSTRAP_REQUIRED' || error?.code === 'EDUWORK_UPDATER_START_FAILED') {
          calls.push('recovery-page')
          if (!earlyFailure) completed()
          return
        }
        calls.push('native-recovery')
        await nativeRecovery(error)
      }, showDesktop: () => calls.push('activate-current-window'),
      checkProductUpdates() {}, setDesktopQuitGuard: value => { guard = value }, restartDesktop,
      pickDesktopDirectory: pickDirectory,
      desktopBootBrand: bootBrand,
      productUpdateObserver: { dispose() {}, subscribe: () => () => {}, status: async () => undefined,
        presentation: async () => ({ phase: 'idle' }), record() {} },
    })
    mock('eduwork-host-process.mjs', { staticDesktopResponse: () => undefined, DesktopHostProcess: class {
      constructor(node, profile, inspect, options) {
        assert.equal(options.environment.PATH, 'synthetic-login-shell-path')
        assert.equal(options.environment.EDUWORK_LAUNCHER_TEST, 'launcher-owned')
        assert.equal(options.environment.CHATECNU_UNTRUSTED_TEST, undefined)
        assert.equal(options.environment.EDUWORK_SIDEBAR_BROWSER_SECRET, 'synthetic-secret')
      }
      async start() {
        calls.push('host')
        if (delayedHostFailure) {
          mainWindow.webContents.emit('preload-error', {}, 'preload-app.cjs', rendererError)
          mainWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
          await new Promise(resolve => { releaseHostStart = resolve; hostStartWaiting() })
          calls.push('host-ready')
          return
        }
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(calls.includes('window-show'), scenario.startsWith('preparation-'), 'only first-run preparation may present before the Host is ready')
        app.emit('second-instance')
        assert.equal(calls.at(-1), 'activate-current-window', 'repeated launch must use the shared window selection')
        assert.equal(calls.includes('window-show'), scenario.startsWith('preparation-'))
        if (scenario === 'host-failure' || scenario === 'early-host-failure' || hostStartCleanupFailure) throw startupError
        if (scenario === 'quit-during-host') app.quit()
        if (scenario === 'renderer-before-ready-guard' || scenario === 'native-duplicate-renderer') {
          mainWindow.webContents.emit('preload-error', {}, 'preload-app.cjs', rendererError)
          if (scenario === 'native-duplicate-renderer') mainWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
        }
        calls.push('host-ready')
      }
      async inspectQuit() {
        return quitConfirmationDialogFailure
          ? { activeTasks: true, scheduledTasks: false }
          : { activeTasks: false, scheduledTasks: false }
      }
      async stop() {
        calls.push('stop')
        if (delayedHostFailure) hostStopStarted()
        if (hostStopFailure || hostStartCleanupFailure || normalQuitHostStopFailure) throw cleanupError
        if (stopFailure) throw stopFailureError
      }
    } })
    const sidebarBrowser = { listen: async () => {
      if (pendingSidebar) {
        calls.push('sidebar-wait')
        await new Promise(resolve => { releaseSidebarListen = resolve; sidebarListenStarted() })
      }
      return { EDUWORK_SIDEBAR_BROWSER_SECRET: 'synthetic-secret' }
    }, close() {} }
    mock('sidebar-browser.mjs', { createSidebarBrowser: () => sidebarBrowser })
    mock('native-desktop-bridge.mjs', { installNativeDesktopBridge: options => {
      bridgeOptions = options
      assert.equal(options.pickDirectory, pickDirectory)
      assert.equal(options.bootBrand, bootBrand)
      assert.equal(options.sidebarBrowser, sidebarBrowser)
      assert.equal(typeof options.updates?.dispose, 'function')
      return { attach() {}, dispose() {}, async disposeFileDrags() {}, locale: () => resolveDesktopLocale('en'), async probeUserGuide() {
        calls.push('probe-guide')
        // The production probe joins waitForHost(), which also starts the Host
        // when called early. Preserve that behavior instead of a no-op stub.
        await options.waitForHost()
        return false
      } }
    } })
    mock('crash-report.ts', { pruneCrashReports: async () => {}, writeCrashReport: async (_path, report) => {
      crashSources.push(report.source); crashReports.push(report); calls.push('crash-report'); crashReported()
    } })
    mock('main.ts', { createWindow: (_preload, _show, _primary, locale) => {
      assert.equal(typeof locale, 'function')
      calls.push('window')
      return mainWindow = Object.assign(new EventEmitter(), { webContents: new EventEmitter(), loadURL: async () => {
        if (scenario === 'renderer-before-page-load' || scenario === 'web-boot-before-page-load') {
          if (scenario === 'renderer-before-page-load') mainWindow.webContents.emit('preload-error', {}, 'preload-app.cjs', rendererError)
          else bridgeOptions.onBootFailure(rendererError)
          await assert.rejects(bridgeOptions.waitForHost(), error => error === rendererError)
        }
        if (earlyFailure) {
          const boot = bridgeOptions.waitForHost(), locale = bridgeOptions.waitForHost()
          for (const request of [boot, locale]) await assert.rejects(request, error => error === startupError)
          bridgeOptions.onBootFailure(new Error(startupError.message))
          setTimeout(completed, 0)
          if (scenario === 'early-configuration-failure') throw new Error('synthetic aborted navigation')
        } else {
          await new Promise(resolve => setImmediate(resolve))
          assert.equal(calls.includes('host'), false, 'navigation must settle before the main entry starts the Host')
        }
        calls.push('page-loaded')
      }, isDestroyed: () => false, isMinimized: () => false,
        show() { calls.push('window-show'); this.emit('show') },
        hide() { calls.push('window-hide') },
        focus() { calls.push('window-focus') } })
    } })
    await import(new URL(`native-desktop.mjs?scenario=${scenario}`, source))
    const deadline = new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup did not settle')), 3000)
      t.after(() => clearTimeout(timer))
    })
    if (pendingSidebar) {
      await Promise.race([waitingForSidebarListen, deadline])
      mainWindow.webContents.emit('preload-error', {}, 'preload-app.cjs', rendererError)
      await new Promise(setImmediate)
      assert.equal(calls.includes('host'), false, 'A failed startup must not create a Host while sidebar setup is pending')
      assert.equal(calls.includes('recovery-dialog'), false, 'Recovery waits for preparation to settle')
      releaseSidebarListen()
      await Promise.race([waitingForRecoveryDialog, deadline])
      assert.equal(calls.includes('host'), false)
      await Promise.race([done, deadline])
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.includes('desktop-ready'), false)
      assert.equal(calls.includes('window-show'), false)
    } else if (scenario === 'renderer-during-prepare') {
      await Promise.race([waitingForCrashReport, deadline])
      await Promise.race([waitingForRecoveryDialog, deadline])
      assert.equal(calls.includes('prepare-complete'), false)
      assert.equal(calls.includes('host'), false)
      assert.equal(calls.includes('failure-cleanup-start'), false)
      assert.ok(calls.indexOf('content-abort') < calls.indexOf('native-recovery'), 'Preparation is cancelled before recovery')
      await Promise.race([done, deadline])
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.includes('host'), false)
      assert.equal(calls.includes('desktop-ready'), false)
    } else if (specialAfterRenderer) {
      await Promise.race([waitingForStartup, deadline])
      await Promise.race([waitingForCrashReport, deadline])
      await Promise.race([waitingForRecoveryDialog, deadline])
      await new Promise(setImmediate)
      assert.equal(calls.includes('recovery-page'), false)
      assert.equal(calls.includes('host'), false)
      assert.equal(preparationCancelled, true, 'The first failure must cancel the pending preparation')
      assert.equal(specialFailureThrown, true, 'The later configuration/updater error must actually occur')
      releaseRecoveryDialog()
      await Promise.race([done, deadline])
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.includes('recovery-page'), false)
      assert.equal(calls.filter(value => value === 'native-recovery').length, 1)
      assert.equal(calls.includes('host'), false)
    } else if (deferredCleanup) {
      await Promise.race([waitingForFailureCleanup, deadline])
      await new Promise(setImmediate)
      mainWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
      await new Promise(setImmediate)
      assert.equal(calls.includes('crash-report'), false, 'Recovery must remain pending during product cleanup')
      assert.equal(calls.includes('probe-guide'), false, 'Failed startup must not complete')
      assert.equal(calls.includes('window-show'), false, 'Failed startup must not present the main window')
      assert.equal(calls.includes('desktop-ready'), false)
      if (scenario === 'renderer-before-page-load') assert.equal(calls.includes('prepare'), false)
      else assert.ok(calls.indexOf('stop') < calls.indexOf('failure-cleanup-start'), 'The starting Host stops before product cleanup')
      releaseFailureCleanup()
    } else if (scenario === 'renderer-during-desktop-ready') {
      await Promise.race([waitingForCrashReport, deadline])
      mainWindow.webContents.emit('render-process-gone', {}, { reason: 'crashed' })
      releaseReady()
      await Promise.race([waitingForReadyReturn, deadline])
      assert.ok(calls.includes('desktop-ready-blocked'))
      assert.equal(calls.includes('failure-cleanup-start'), false, 'Running failures must not race product rollback')
      assert.equal(calls.includes('window-show'), false)
    } else if (quitConfirmationDialogFailure) {
      await Promise.race([waitingForExitFailure, deadline])
      await new Promise(setImmediate)
      assert.equal(exit.complete, false)
      assert.equal(exit.closing, false)
      assert.equal(lifecycle.closing, false)
      assert.equal(calls.includes('stop'), false)
      assert.equal(calls.includes('quit'), false)
      assert.equal(exitFailures.length, 1)
      assert.match(exitFailures[0].message, /quit dialog failure/)
    } else if (normalQuitHostStopFailure) {
      await Promise.race([done, deadline])
      assert.equal(calls.filter(value => value === 'quit').length, 1)
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 0)
      assert.equal(exit.complete, true)
      assert.equal(exitFailures.length, 1)
      assert.equal(exitFailures[0].critical, true)
    } else if (hostStopFailure) {
      await Promise.race([waitingForHostStop, deadline])
      assert.equal(calls.includes('failure-cleanup-start'), false, 'A Host stop failure must not start product rollback')
      releaseHostStart()
      await Promise.race([waitingForRecoveryDialog, deadline])
      assert.equal(failureCalls.length, 0, 'A Host stop failure must not call showDesktopFailure')
      assert.equal(rollbackAttempts, 0, 'A Host stop failure must not start content rollback even with a pending trial')
      await Promise.race([done, deadline])
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, hostStopRestart ? 2 : 1)
      assert.equal(calls.filter(value => value === 'crash-report').length, 1, 'Native recovery still reports the combined failure')
      assert.equal(calls.includes('desktop-ready'), false)
      assert.equal(calls.includes('window-show'), false)
      assert.equal(calls.includes('relaunch'), false, 'A rejected restart must not relaunch while the Host state is unknown')
      assert.equal(exit.complete, true)
      assert.equal(calls.filter(value => value === 'health-failed').length, pendingTrial ? 0 : 1, 'A pending content trial stays for the next launch')
      if (!pendingTrial) assert.ok(calls.indexOf('health-failed') < calls.indexOf('crash-report'))
      const report = crashReports[0]?.error
      assert.ok(report instanceof AggregateError)
      assert.equal(report.errors[0].message, 'Synthetic renderer failure')
      assert.equal(report.errors[1].message, 'Synthetic Host cleanup failure')
    } else if (rollbackRestart) {
      await Promise.race([waitingForHostStop, deadline])
      assert.equal(calls.includes('failure-cleanup-start'), false, 'The Host must stop before rollback starts')
      assert.equal(calls.includes('host-ready'), false, 'A failed startup must not publish Host readiness')
      releaseHostStart()
      await Promise.race([waitingForFailureCleanup, deadline])
      assert.ok(calls.indexOf('host-ready') < calls.indexOf('failure-cleanup-start'), 'Host readiness during rollback cannot resume startup')
      assert.ok(calls.indexOf('stop') < calls.indexOf('failure-cleanup-start'), 'Stop precedes product cleanup')
      assert.equal(calls.includes('desktop-ready'), false)
      assert.equal(calls.includes('window-show'), false)
      releaseFailureCleanup()
      await Promise.race([waitingForRecoveryDialog, deadline])
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1, 'A failed restart falls back to native recovery')
      await Promise.race([done, deadline])
      assert.equal(exit.complete, true)
      if (cleanupRestartFailure) {
        assert.deepEqual(exitFailures, [resourceError])
        for (const [event, count] of [['host', 1], ['stop', 1], ['relaunch', 0], ['quit', 1]]) {
          assert.equal(calls.filter(value => value === event).length, count, event)
        }
      } else if (persistentCleanupFailure) {
        assert.equal(exitFailures.length, 2)
        assert.equal(exitFailures[0], resourceError)
        assert.equal(exitFailures[1], resourceError)
        const relaunch = scenario === 'renderer-rollback-persistent-cleanup-restart' ? 1 : 0
        for (const [event, count] of [['host', 1], ['stop', 1], ['relaunch', relaunch], ['quit', 1]]) {
          assert.equal(calls.filter(value => value === event).length, count, event)
        }
      } else {
        for (const [event, count] of [['host', 1], ['stop', 1], ['relaunch', 1], ['quit', 1], ['quit-dialog', 0]]) {
          assert.equal(calls.filter(value => value === event).length, count, event)
        }
      }
    }
    if (pendingShell || pendingPrepare) {
      await Promise.race([waitingForStartup, deadline])
      if (fatalRecovery) bridgeOptions.onBootFailure(rendererError)
      else app.quit()
      if (cancelledQuit) {
        await exit.pending
        assert.equal(lifecycle.closing, false)
        assert.equal(pendingShell ? shellSignal.aborted : preparationCancelled, false, 'A cancelled quit must preserve the pending startup')
        releaseShell?.(); releasePrepare?.()
      } else {
        await new Promise(setImmediate)
        assert.equal(pendingShell ? shellSignal.aborted : preparationCancelled, true, 'Teardown must cancel preparation before waiting for startup')
      }
    }
    if (!quitConfirmationDialogFailure) await Promise.race([done, deadline])
    const probes = calls.filter(value => value === 'probe-guide')
    if (calls.includes('desktop-ready') && !scenario.startsWith('renderer-') && scenario !== 'native-duplicate-renderer'
      && !stopFailure && !normalQuitHostStopFailure && !quitConfirmationDialogFailure) {
      assert.equal(probes.length, 1, 'Discover the optional guide once after normal startup')
      assert.ok(calls.indexOf('probe-guide') > calls.indexOf('desktop-ready'), 'Menu discovery must not initiate startup')
    } else if (!normalQuitHostStopFailure && !quitConfirmationDialogFailure) {
      assert.equal(probes.length, 0, 'Failed or cancelled startup must not probe an optional guide')
    }
    // Keep the original lifecycle expectations separate from menu discovery.
    const startupCalls = calls.filter(value => value !== 'probe-guide')
    if (scenario === 'installed' || scenario === 'application-hidden') {
      const hidden = process.platform === 'darwin' && scenario === 'application-hidden'
      assert.deepEqual(startupCalls, ['ready', 'installer', 'lock', 'window', 'page-loaded', 'prepare', 'host', 'activate-current-window', 'host-ready', 'desktop-ready', ...hidden ? [] : ['window-show']])
      app.emit('second-instance')
      assert.equal(calls.at(-1), 'activate-current-window')
    } else if (scenario === 'preparation-visible' || scenario === 'preparation-hidden') {
      assert.deepEqual(startupCalls, ['ready', 'installer', 'lock', 'window', 'page-loaded', 'prepare', 'window-show',
        ...scenario === 'preparation-hidden' ? ['window-hide'] : [], 'host', 'activate-current-window', 'host-ready', 'desktop-ready'])
      if (scenario === 'preparation-hidden') {
        attachAppActivation({ app, platform: 'darwin', windows: () => [mainWindow] })
        app.emit('activate')
        assert.deepEqual(calls.slice(-2), ['window-show', 'window-focus'])
      }
    } else if (stopFailure) {
      for (const [event, count] of [['host', 1], ['stop', 1], ['recovery-dialog', 2], ['stop-failure', 2], ['relaunch', 0], ['quit', 1]]) {
        assert.equal(calls.filter(value => value === event).length, count, event)
      }
      for (const error of stopFailureLogs) assert.doesNotMatch(error.message, /sk-private-token|127\.0\.0\.1|51234/)
      const details = dialogOptions.filter(value => value.type === 'error').map(value => value.detail ?? value.message).join('\n')
      assert.match(details, /ECONNREFUSED/)
      assert.doesNotMatch(details, /sk-private-token|127\.0\.0\.1|51234/)
    } else if (pendingShell || pendingPrepare) {
      const started = ['ready', 'installer', 'lock', 'window', 'page-loaded', 'prepare', pendingShell ? 'shell-wait' : 'prepare-wait']
      assert.deepEqual(startupCalls, cancelledQuit
        ? [...started, 'host', 'activate-current-window', 'host-ready', 'desktop-ready', 'window-show']
        : [...started, pendingShell ? 'shell-abort' : 'content-abort', ...fatalRecovery ? ['native-recovery', 'crash-report', 'recovery-dialog'] : [], ...restarting ? ['relaunch'] : [], 'quit'])
    } else if (earlyFailure) {
      const expected = scenario === 'early-host-failure'
        ? ['ready', 'installer', 'lock', 'window', 'prepare', 'host', 'activate-current-window', 'stop', 'native-recovery', 'crash-report', 'page-loaded', 'recovery-dialog']
        : ['ready', 'installer', 'lock', 'window', 'prepare', 'recovery-page']
      assert.deepEqual(startupCalls.slice(0, expected.length), expected)
      assert.deepEqual(startupCalls.slice(expected.length).filter(value => value !== 'quit'), [], 'Early failure must not emit extra recovery or startup events')
    } else if (scenario === 'preparation-failure') {
      assert.deepEqual(startupCalls, ['ready', 'installer', 'lock', 'window', 'page-loaded', 'prepare', 'window-show',
        'native-recovery', 'crash-report', 'recovery-dialog', 'quit'])
    } else if (hostStartCleanupFailure) {
      assert.deepEqual(startupCalls, ['ready', 'installer', 'lock', 'window', 'page-loaded', 'prepare', 'host',
        'activate-current-window', 'stop', 'health-failed', 'crash-report', 'recovery-dialog', 'quit'])
      assert.equal(failureCalls.length, 0, 'A Host stop failure must skip product rollback')
      const report = crashReports[0]?.error
      assert.ok(report instanceof AggregateError)
      assert.match(report.message, /desktop backend startup and cleanup failed/)
      assert.equal(report.errors[0].message, 'synthetic Host failure')
      assert.equal(report.errors[1].message, 'Synthetic Host cleanup failure')
      const errorDialog = dialogOptions.find(value => value.type === 'error')
      assert.match(errorDialog.detail, /synthetic Host failure/)
      assert.match(errorDialog.detail, /Synthetic Host cleanup failure/)
    } else if (scenario === 'native-duplicate-renderer') {
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.filter(value => value === 'native-recovery').length, 1)
      assert.equal(calls.filter(value => value === 'crash-report').length, 1)
      assert.equal(calls.filter(value => value === 'stop').length, 1, 'A failed startup stops the starting Host once')
      assert.equal(calls.includes('recovery-page'), false)
      assert.equal(calls.includes('desktop-ready'), false)
    } else if (scenario === 'native-recovery-rejected') {
      assert.deepEqual(startupCalls, ['ready', 'installer', 'lock', 'window', 'page-loaded', 'prepare', 'native-recovery',
        'crash-report', 'recovery-dialog', 'quit'])
      assert.equal(exit.complete, true)
      assert.equal(lifecycle.closing, true)
      assert.equal(calls.filter(value => value === 'quit').length, 1)
    } else if (scenario === 'web-boot-before-page-load') {
      assert.equal(calls.filter(value => value === 'native-recovery').length, 1)
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.includes('prepare'), false)
    } else if (specialAfterRenderer) {
      assert.equal(calls.includes('desktop-ready'), false)
      assert.equal(calls.includes('recovery-page'), false)
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.filter(value => value === 'native-recovery').length, 1)
      assert.equal(crashReports.length, 1)
      assert.equal(crashReports[0].error.message, 'Synthetic renderer failure', 'The first failure owns the final report')
    } else if (scenario === 'renderer-during-prepare') {
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.includes('host'), false)
      assert.equal(calls.includes('desktop-ready'), false)
      assert.ok(calls.indexOf('content-abort') < calls.indexOf('native-recovery'), 'Preparation is cancelled before recovery')
    } else if (scenario === 'renderer-during-sidebar-listen') {
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.includes('host'), false)
      assert.equal(calls.includes('desktop-ready'), false)
      assert.ok(calls.indexOf('sidebar-wait') < calls.indexOf('recovery-dialog'))
    } else if (scenario === 'renderer-during-desktop-ready') {
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.filter(value => value === 'crash-report').length, 1)
      assert.equal(calls.includes('native-recovery'), false)
      assert.equal(calls.includes('desktop-ready-committed'), false)
    } else if (quitConfirmationDialogFailure) {
      assert.equal(calls.includes('quit'), false)
      assert.equal(calls.includes('stop'), false)
    } else if (normalQuitHostStopFailure) {
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 0)
      assert.equal(calls.filter(value => value === 'quit').length, 1)
    } else if (hostStopFailure) {
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, hostStopRestart ? 2 : 1)
      assert.equal(calls.filter(value => value === 'quit').length, 1)
      assert.equal(calls.includes('desktop-ready'), false)
      assert.equal(calls.includes('window-show'), false)
      assert.equal(calls.includes('relaunch'), false)
    } else if (rollbackRestart) {
      assert.equal(calls.includes('desktop-ready'), false)
      assert.equal(calls.includes('window-show'), false)
      assert.equal(calls.includes('recovery-page'), false)
    } else if (deferredCleanup) {
      assert.equal(calls.filter(value => value === 'failure-cleanup-start').length, 1)
      assert.equal(calls.filter(value => value === 'native-recovery').length, 1)
      assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
      assert.equal(calls.includes('desktop-ready-committed'), false)
    } else if (scenario === 'host-failure' || scenario === 'quit-during-host') {
      assert.equal(calls.includes('window-show'), false)
      assert.equal(calls.includes('desktop-ready'), false)
      assert.ok(calls.includes(scenario === 'host-failure' ? 'native-recovery' : 'quit'))
      if (scenario === 'host-failure') assert.equal(calls.filter(value => value === 'recovery-dialog').length, 1)
    } else if (scenario === 'second-instance') {
      assert.deepEqual(calls, ['ready', 'installer', 'lock', 'quit'])
    } else {
      assert.deepEqual(calls, ['ready', 'installer', 'quit'])
      assert.equal(exit.complete, true)
    }
    const expectsShowDesktopFailure = (nativeFailure || scenario === 'early-configuration-failure')
      && scenario !== 'renderer-during-desktop-ready' && !hostStopFailure && !hostStartCleanupFailure
    if (quitConfirmationDialogFailure) {
      assert.equal(exitFailures.length, 1)
      assert.match(exitFailures[0].message, /quit dialog failure/)
    } else if (normalQuitHostStopFailure) {
      assert.equal(exitFailures.length, 1)
      assert.equal(exitFailures[0].critical, true)
    } else if (hostStopFailure || hostStartCleanupFailure || stopFailure) {
      assert.equal(exitFailures.length, 1)
      assert.equal(exitFailures[0].critical, true)
    } else {
      const expectedExitFailures = cleanupRestartFailure ? [resourceError]
        : persistentCleanupFailure ? [resourceError, resourceError] : []
      assert.deepEqual(exitFailures, expectedExitFailures, 'Only simulated resource failures may fail an exit attempt')
    }
    if (expectsShowDesktopFailure) {
      assert.equal(failureCalls.length, 1, 'Each startup failure is handled once')
      if (hostStartCleanupFailure) {
        assert.ok(failureCalls[0] instanceof AggregateError)
        assert.match(failureCalls[0].message, /desktop backend startup and cleanup failed/)
      } else {
        const expectedFailure = ['host-failure', 'early-host-failure', 'preparation-failure', 'native-recovery-rejected', 'early-configuration-failure'].includes(scenario) ? startupError : rendererError
        assert.equal(failureCalls[0], expectedFailure)
      }
    }
    const dialogErrors = dialogOptions.filter(value => value.type === 'error')
    if (dialogErrors.length) {
      const expectedSource = {
        'preparation-failure': 'main', 'native-recovery-rejected': 'main',
        'host-failure': 'host', 'early-host-failure': 'host', 'host-start-cleanup-failure': 'host',
        'web-boot-before-page-load': 'web-boot', 'renderer-during-shell': 'web-boot',
        'recovery-exit-during-shell': 'web-boot', 'recovery-restart-during-shell': 'web-boot',
        'recovery-exit-during-prepare': 'web-boot', 'recovery-restart-during-prepare': 'web-boot',
        'recovery-restart-stop-failure': 'web-boot',
      }[scenario] ?? 'renderer'
      assert.deepEqual(crashSources, [expectedSource])
    } else {
      assert.deepEqual(crashSources, [])
    }
  })
}

test('native startup diagnostics keep wrapped reasons and drop private input and Host addresses', { skip: !source }, async () => {
  const { startupDiagnostic } = await import(new URL('startup-failure.mjs?diagnostic', source))
  const { redactDiagnostic } = await import(new URL('diagnostics.mjs', source))
  const { desktopErrorState } = await import(new URL('startup-error.ts', source))
  const { renderCrashReport } = await import(new URL('crash-report.ts', source))
  let jsonError, singleQuoteError, backslashError
  try { JSON.parse('{"A":["secret99",]}') } catch (error) { jsonError = error }
  try { JSON.parse("'single-secret-99'") } catch (error) { singleQuoteError = error }
  try { JSON.parse(String.fromCharCode(92) + 'backslash-secret-99') } catch (error) { backslashError = error }
  const connection = Object.assign(Error('connect ECONNREFUSED 127.0.0.1:51234'), {
    code: 'ECONNREFUSED', errno: -4078, syscall: 'connect', address: '127.0.0.1', port: 51234,
  })
  const child = new Error('Synthetic nested child failure', { cause: connection })
  const context = 'Host context with a "quoted value", and another line'
  const aggregate = new AggregateError([
    Object.assign(Error('Synthetic Host start failure'), { code: 'EHOSTSTART' }),
    Object.assign(Error('Synthetic Host cleanup failure'), { code: 'EHOSTSTOP' }),
    child,
    singleQuoteError,
    backslashError,
  ], 'desktop backend startup and cleanup failed', { cause: jsonError })
  const error = new Error(`${context}\n${aggregate.message}\n内容回退状态未能保存：Synthetic rollback failure`, { cause: aggregate })
  const safe = startupDiagnostic(error, text => redactDiagnostic(text))
  const dialog = desktopErrorState(safe).message
  assert.match(dialog, /Host context with a "quoted value", and another line/)
  assert.match(dialog, /desktop backend startup and cleanup failed/)
  assert.match(dialog, /Synthetic Host start failure/)
  assert.match(dialog, /Synthetic Host cleanup failure/)
  assert.match(dialog, /Synthetic nested child failure/)
  assert.match(dialog, /Synthetic rollback failure/)
  assert.match(dialog, /connect ECONNREFUSED/)
  assert.doesNotMatch(dialog, /secret99|single-secret-99|backslash-secret-99|127\.0\.0\.1|51234/)
  const report = renderCrashReport({
    source: 'host', phase: 'startup', error: safe, rendererConsole: [], time: new Date('2026-01-01T00:00:00Z'),
    app: { name: 'Fixture', version: '0.0.0', platform: 'win32', arch: 'x64', electron: '44.0.0', node: '24.22.1', locale: 'en' },
  })
  assert.match(report, /Host context with a "quoted value", and another line/)
  assert.match(report, /Synthetic Host start failure/)
  assert.match(report, /Synthetic Host cleanup failure/)
  assert.match(report, /Synthetic nested child failure/)
  assert.match(report, /Synthetic rollback failure/)
  assert.match(report, /connect ECONNREFUSED/)
  assert.doesNotMatch(report, /secret99|single-secret-99|backslash-secret-99|127\.0\.0\.1|51234/)
})
