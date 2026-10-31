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
for (const scenario of ['installed', 'installer-exit', 'second-instance', 'quit-during-cleanup', 'preparation-visible', 'preparation-hidden', 'host-failure', 'early-host-failure', 'early-configuration-failure', 'quit-during-host', 'quit-during-shell', 'cancelled-quit-during-shell', 'recovery-exit-during-shell', 'recovery-restart-during-shell', 'quit-during-prepare', 'cancelled-quit-during-prepare', 'recovery-exit-during-prepare', 'recovery-restart-during-prepare', 'recovery-restart-stop-failure']) {
  test(`native installer startup: ${scenario}`, { skip: !source }, async t => {
    const calls = [], app = new EventEmitter(), lifecycle = new DesktopLifecycle()
    const earlyFailure = scenario.startsWith('early-'), startupError = new Error('synthetic Host failure')
    const pendingShell = scenario.endsWith('-shell'), pendingPrepare = scenario.endsWith('-prepare'), fatalRecovery = scenario.startsWith('recovery-')
    const cancelledQuit = scenario.startsWith('cancelled-quit-'), restarting = scenario.startsWith('recovery-restart-')
    const stopFailure = scenario === 'recovery-restart-stop-failure'
    if (stopFailure) t.mock.method(console, 'error', error => { assert.equal(error, startupError); calls.push('stop-failure') })
    if (scenario === 'early-configuration-failure') startupError.code = 'EDUWORK_BOOTSTRAP_REQUIRED'
    let guard = async () => true, completed, mainWindow, bridgeOptions, shellSignal, releaseShell, releasePrepare, startupStarted, preparationCancelled = false
    const done = new Promise(resolve => { completed = resolve })
    const waitingForStartup = new Promise(resolve => { startupStarted = resolve })
    const cancelContentUpdates = () => {
      if (!pendingPrepare || preparationCancelled) return
      preparationCancelled = true; calls.push('content-abort'); releasePrepare?.()
    }
    const stopDesktopServices = () => { cancelContentUpdates(); return lifecycle.close() }
    const exit = new DesktopExit({ confirm: () => cancelledQuit ? Promise.resolve(false) : guard(),
      close: stopDesktopServices,
      relaunch: () => { assert.ok(restarting); calls.push('relaunch') }, quit: () => app.quit(), failed: assert.fail })
    t.after(async () => { releaseShell?.(); releasePrepare?.(); await new Promise(setImmediate); await exit.pending })
    app.getPath = () => '/unused'
    app.getLocale = () => 'en'
    app.getName = () => 'Fixture'
    app.getVersion = () => '0.0.0'
    app.requestSingleInstanceLock = () => { calls.push('lock'); return scenario !== 'second-instance' }
    app.whenReady = async () => { calls.push('ready') }
    app.quit = () => {
      if (!exit.complete) { void exit.request(); return }
      calls.push('quit'); app.emit('will-quit'); completed()
    }
    t.mock.module(electron, { exports: { app, dialog: { showMessageBox: async options => {
      assert.ok(fatalRecovery); assert.equal(options.type, 'error'); calls.push('recovery-dialog')
      return { response: restarting && (!stopFailure || calls.filter(value => value === 'recovery-dialog').length === 1) ? 1 : 0 }
    } },
      protocol: { registerSchemesAsPrivileged() {}, handle() {} }, powerMonitor: new EventEmitter() } })
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
        if (pendingPrepare) {
          calls.push('prepare-wait')
          await new Promise(resolve => { releasePrepare = resolve; startupStarted() })
          lifecycle.check()
        }
        return {}
      }), stopDesktopServices,
      desktopWebRoot: () => '/synthetic/web', desktopStartupWindowPresent: () => false,
      nativeBootstrap() {}, desktopReady: async () => {
        calls.push('desktop-ready')
        if (stopFailure) queueMicrotask(() => bridgeOptions.onBootFailure(Error('Synthetic renderer failure')))
        else setTimeout(completed, 0)
      },
      trackHost: host => lifecycle.trackHost(host), desktopHostLog() {}, isQuitting: () => exit.closing || lifecycle.closing, deferReopenWhileQuitting: () => false,
      attachDesktopWindow() {}, configureWindowNavigation() {}, showDesktopFailure: error => {
        assert.ok(scenario === 'host-failure' || earlyFailure)
        assert.equal(error, startupError)
        calls.push('recovery')
        if (!earlyFailure) completed()
      }, showDesktop: () => calls.push('activate-current-window'),
      checkProductUpdates() {}, setDesktopQuitGuard: value => { guard = value }, restartDesktop: () => exit.restart(),
      pickDesktopDirectory: pickDirectory,
      desktopBootBrand: bootBrand,
    })
    mock('eduwork-host-process.mjs', { staticDesktopResponse: () => undefined, DesktopHostProcess: class {
      constructor(node, profile, inspect, options) {
        assert.equal(options.environment.PATH, 'synthetic-login-shell-path')
        assert.equal(options.environment.EDUWORK_LAUNCHER_TEST, 'launcher-owned')
        assert.equal(options.environment.CHATECNU_UNTRUSTED_TEST, undefined)
      }
      async start() {
        calls.push('host')
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(calls.includes('window-show'), scenario.startsWith('preparation-'), 'only first-run preparation may present before the Host is ready')
        app.emit('second-instance')
        assert.equal(calls.at(-1), 'activate-current-window', 'repeated launch must use the shared window selection')
        assert.equal(calls.includes('window-show'), scenario.startsWith('preparation-'))
        if (scenario === 'host-failure' || scenario === 'early-host-failure') throw startupError
        if (scenario === 'quit-during-host') app.quit()
        calls.push('host-ready')
      }
      async stop() { calls.push('stop'); if (stopFailure) throw startupError }
    } })
    mock('native-desktop-bridge.mjs', { installNativeDesktopBridge: options => {
      bridgeOptions = options
      assert.equal(options.pickDirectory, pickDirectory)
      assert.equal(options.bootBrand, bootBrand)
      return { attach() {}, dispose() {}, locale: () => resolveDesktopLocale('en'), async probeUserGuide() {
        calls.push('probe-guide')
        // The production probe joins waitForHost(), which also starts the Host
        // when called early. Preserve that behavior instead of a no-op stub.
        await options.waitForHost()
        return false
      } }
    } })
    mock('crash-report.ts', { pruneCrashReports: async () => {}, writeCrashReport: async () => {
      assert.ok(fatalRecovery, 'Startup failure must use product recovery'); calls.push('crash-report')
    } })
    mock('main.ts', { createWindow: (_preload, _show, _primary, locale) => {
      assert.equal(typeof locale, 'function')
      calls.push('window')
      return mainWindow = Object.assign(new EventEmitter(), { webContents: new EventEmitter(), loadURL: async () => {
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
    if (pendingShell || pendingPrepare) {
      await Promise.race([waitingForStartup, deadline])
      if (fatalRecovery) bridgeOptions.onBootFailure(new Error('synthetic renderer failure'))
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
    await Promise.race([done, deadline])
    const probes = calls.filter(value => value === 'probe-guide')
    if (calls.includes('desktop-ready')) {
      assert.equal(probes.length, 1, 'Discover the optional guide once after normal startup')
      assert.ok(calls.indexOf('probe-guide') > calls.indexOf('desktop-ready'), 'Menu discovery must not initiate startup')
    } else {
      assert.equal(probes.length, 0, 'Failed or cancelled startup must not probe an optional guide')
    }
    // Keep the original lifecycle expectations separate from menu discovery.
    const startupCalls = calls.filter(value => value !== 'probe-guide')
    if (scenario === 'installed') {
      assert.deepEqual(startupCalls, ['ready', 'installer', 'lock', 'window', 'page-loaded', 'prepare', 'host', 'activate-current-window', 'host-ready', 'desktop-ready', 'window-show'])
      app.emit('second-instance')
      assert.equal(calls.at(-1), 'activate-current-window')
    } else if (scenario.startsWith('preparation-')) {
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
    } else if (pendingShell || pendingPrepare) {
      const started = ['ready', 'installer', 'lock', 'window', 'page-loaded', 'prepare', pendingShell ? 'shell-wait' : 'prepare-wait']
      assert.deepEqual(startupCalls, cancelledQuit
        ? [...started, 'host', 'activate-current-window', 'host-ready', 'desktop-ready', 'window-show']
        : [...started, ...fatalRecovery ? ['crash-report', 'recovery-dialog'] : [], pendingShell ? 'shell-abort' : 'content-abort', ...restarting ? ['relaunch'] : [], 'quit'])
    } else if (earlyFailure) {
      assert.deepEqual(startupCalls, scenario === 'early-host-failure'
        ? ['ready', 'installer', 'lock', 'window', 'prepare', 'host', 'activate-current-window', 'stop', 'recovery', 'page-loaded']
        : ['ready', 'installer', 'lock', 'window', 'prepare', 'recovery'])
    } else if (scenario === 'host-failure' || scenario === 'quit-during-host') {
      assert.equal(calls.includes('window-show'), false)
      assert.equal(calls.includes('desktop-ready'), false)
      assert.ok(calls.includes(scenario === 'host-failure' ? 'recovery' : 'quit'))
    } else if (scenario === 'second-instance') {
      assert.deepEqual(calls, ['ready', 'installer', 'lock', 'quit'])
    } else {
      assert.deepEqual(calls, ['ready', 'installer', 'quit'])
      assert.equal(exit.complete, true)
    }
  })
}
