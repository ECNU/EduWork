import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath, symlink, rename, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { DesktopExit } from '../src/desktop-exit.mjs'
import { DesktopLifecycle } from '../src/lifecycle.mjs'
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

// Exercise the built rc.2 entry and its actual single-instance, quit and backend
// controllers. Only Electron, product preparation and the Host are substituted.
const source = process.env.EDUWORK_TEST_NATIVE_SHELL && pathToFileURL(resolve(process.env.EDUWORK_TEST_NATIVE_SHELL, 'src') + '/')
const electron = 'data:text/javascript,export {}'
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'electron' ? { url: electron, shortCircuit: true } : next(specifier, context)
} })
for (const scenario of ['installed', 'installer-exit', 'second-instance', 'quit-during-cleanup']) {
  test(`native installer startup: ${scenario}`, { skip: !source }, async t => {
    const calls = [], app = new EventEmitter(), lifecycle = new DesktopLifecycle()
    let guard = async () => true, completed
    const done = new Promise(resolve => { completed = resolve })
    const exit = new DesktopExit({ confirm: () => guard(), close: () => lifecycle.close(),
      relaunch: () => assert.fail('Installer restart belongs to Electron'), quit: () => app.quit(), failed: assert.fail })
    app.getPath = () => '/unused'
    app.getLocale = () => 'en'
    app.requestSingleInstanceLock = () => { calls.push('lock'); return scenario !== 'second-instance' }
    app.whenReady = async () => { calls.push('ready') }
    app.quit = () => {
      if (!exit.complete) { void exit.request(); return }
      calls.push('quit'); app.emit('will-quit'); completed()
    }
    t.mock.module(electron, { exports: { app, dialog: { showMessageBox: () => assert.fail('No tasks exist during installation') },
      protocol: { registerSchemesAsPrivileged() {}, handle() {} }, powerMonitor: new EventEmitter() } })
    const mock = (file, exports) => t.mock.module(new URL(file, source).href, { exports })
    const pickDirectory = () => assert.fail('Installation startup must not open a directory picker')
    const prior = process.env.EDUWORK_LAUNCHER_TEST
    process.env.EDUWORK_LAUNCHER_TEST = 'launcher-owned'
    t.after(() => { if (prior === undefined) delete process.env.EDUWORK_LAUNCHER_TEST; else process.env.EDUWORK_LAUNCHER_TEST = prior })
    mock('login-shell-environment.ts', {
      resolveDesktopLoginShellConfig: () => ({ timeoutMs: 1000 }),
      readDesktopLoginShellEnvironment: async () => ({ environment: { ...process.env,
        PATH: 'synthetic-login-shell-path', EDUWORK_LAUNCHER_TEST: 'shell-value', CHATECNU_UNTRUSTED_TEST: 'shell-value' } }),
    })
    mock('product.mjs', {
      configureEduworkPaths() {}, installEduworkFromDmg: async () => {
        calls.push('installer')
        if (scenario === 'quit-during-cleanup') { app.quit(); await exit.pending }
        if (scenario === 'installer-exit') { app.quit(); return true }
        return false
      }, prepareEduworkDesktop: async () => { calls.push('prepare'); return {} },
      nativeBootstrap() {}, desktopReady: async () => { calls.push('desktop-ready'); completed() },
      trackHost: host => lifecycle.trackHost(host), desktopHostLog() {}, isQuitting: () => lifecycle.closing,
      attachDesktopWindow() {}, configureWindowNavigation() {}, showDesktopFailure: assert.fail,
      checkProductUpdates() {}, setDesktopQuitGuard: value => { guard = value }, restartDesktop: () => exit.restart(),
      pickDesktopDirectory: pickDirectory,
    })
    mock('eduwork-host-process.mjs', { DesktopHostProcess: class {
      constructor(node, profile, inspect, options) {
        assert.equal(options.environment.PATH, 'synthetic-login-shell-path')
        assert.equal(options.environment.EDUWORK_LAUNCHER_TEST, 'launcher-owned')
        assert.equal(options.environment.CHATECNU_UNTRUSTED_TEST, undefined)
      }
      async start() { calls.push('host') }
      async stop() { calls.push('stop') }
    } })
    mock('native-desktop-bridge.mjs', { installNativeDesktopBridge: options => {
      assert.equal(options.pickDirectory, pickDirectory)
      return { attach() {}, dispose() {} }
    } })
    mock('crash-report.ts', { pruneCrashReports: async () => {}, writeCrashReport: assert.fail })
    mock('main.ts', { createWindow: () => {
      calls.push('window')
      return Object.assign(new EventEmitter(), { webContents: new EventEmitter(), loadURL: async () => {}, isDestroyed: () => false, show() {} })
    } })
    await import(new URL(`native-desktop.mjs?scenario=${scenario}`, source))
    await Promise.race([done, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup did not settle')), 3000)
      t.after(() => clearTimeout(timer))
    })])
    if (scenario === 'installed') {
      assert.deepEqual(calls, ['ready', 'installer', 'lock', 'prepare', 'host', 'window', 'desktop-ready'])
    } else if (scenario === 'second-instance') {
      assert.deepEqual(calls, ['ready', 'installer', 'lock', 'quit'])
    } else {
      assert.deepEqual(calls, ['ready', 'installer', 'quit'])
      assert.equal(exit.complete, true)
    }
  })
}
