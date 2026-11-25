import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { migrationIntentStore } from '../src/first-run-migration-intent.mjs'
import { portableRedirectGate, handlePortableRedirect } from '../src/portable-migrated-redirect.mjs'
import { refreshPortableShortcuts } from '../src/portable-import-shortcuts.mjs'
import { writePortableSourceHint } from '../src/portable-migration-upgrade.mjs'

const root = join(tmpdir(), 'old EduWork')
const intent = { id: 'same', sourceRoot: root, installerVersion: '0.4.15' }
const settings = { portableMigration: true, distribution: 'eduwork' }

test('before activation an opt-out skips all portable migration state', () => {
  const read = () => assert.fail('disabled must not read migration state')
  for (const override of [{ settings: {} }, { platform: 'darwin' }, { testRoot: root }, { settings: { ...settings, dataLayout: 'installed' } }, { settings: { ...settings, sourceAlpha: true } }]) {
    assert.equal(portableRedirectGate({ root, localAppData: root, platform: 'win32', settings, read, ...override }), undefined)
  }
})

test('a portable instance rechecks for a new intent after acquiring the desktop lock', async t => {
  const localAppData = await mkdtemp(join(await realpath(tmpdir()), 'eduwork-redirect-lock-'))
  t.after(() => rm(localAppData, { recursive: true, force: true }))
  const platform = 'win32', sourceRoot = join(localAppData, 'old')
  await mkdir(sourceRoot)
  const store = migrationIntentStore({ localAppData, platform, distribution: settings.distribution })
  const readPortableRedirect = () => portableRedirectGate({ root: sourceRoot, localAppData, platform, settings })
  const earlyPortableRedirect = readPortableRedirect()
  assert.equal(earlyPortableRedirect, undefined)
  const published = await store.write({ sourceRoot, sourceVersion: '0.4.14', installerVersion: '0.4.15' })
  const product = await readFile(new URL('../src/product.mjs', import.meta.url), 'utf8')
  const native = await readFile(new URL('../src/native-desktop.mjs', import.meta.url), 'utf8')
  const resolver = product.slice(product.indexOf('export async function resolvePortableRedirect('), product.indexOf('export async function recordPortableSource('))
  const startup = native.slice(native.indexOf('async function main()'), native.indexOf('  activateEduworkPaths()', native.indexOf('async function main()')))
  const events = []
  await runInNewContext(`${resolver.replace('export ', '')}\n${startup}\n  startOldHost()\n}\nmain()`, {
    earlyPortableRedirect, readPortableRedirect: () => { events.push('recheck'); return readPortableRedirect() }, handlePortableRedirect,
    installEduworkFromDmg: async () => false, isQuitting: () => false, showDesktop() {},
    claimDesktopSingleInstance: () => { events.push('lock'); return true },
    portableMigrationHelper: async ({ mode, intentId }) => { assert.equal(intentId, published.id); events.push(mode) },
    portableRedirectDialogs: () => ({ choose: async () => 'resume', fail: error => { throw error } }),
    resolveInstalledFirstRun: async () => 'reuse', startOldHost: () => events.push('old-host'), app: { quit: () => events.push('quit') },
  })
  assert.deepEqual(events, ['lock', 'recheck', 'probe', 'redirect', 'quit'])
})

test('activation redirects only the canonical source for this distribution', async t => {
  const localAppData = await mkdtemp(join(await realpath(tmpdir()), 'eduwork-redirect-'))
  t.after(() => rm(localAppData, { recursive: true, force: true }))
  const source = join(localAppData, '旧 EduWork'), target = join(localAppData, 'EduWork', 'eduwork')
  await mkdir(source)
  await mkdir(target, { recursive: true })
  const sourceRoot = await realpath(source), path = join(target, '.eduwork-migration.json')
  const options = { root: source, localAppData, settings, platform: 'win32' }
  const receipt = { schemaVersion: 2, distribution: 'eduwork', state: 'imported', sourceRoot: sourceRoot.toUpperCase() }
  await writeFile(path, JSON.stringify(receipt))
  assert.deepEqual(portableRedirectGate(options), { receipt })
  for (const change of [{ distribution: 'other' }, { sourceRoot: target }, { state: 'staged' }, { schemaVersion: 1 }]) {
    await writeFile(path, JSON.stringify({ ...receipt, ...change }))
    assert.equal(portableRedirectGate(options), undefined)
  }
  await writeFile(path, '{')
  assert.equal(portableRedirectGate(options), undefined)
  await writeFile(join(localAppData, 'EduWork', 'eduwork.portable-migration.json'), '{')
  assert.ok(portableRedirectGate(options).error)
})

test('a receipt outranks a pending intent; a matching pending intent opens installed or can be withdrawn', async () => {
  const calls = []
  const params = { gate: { receipt: true, intent }, launch: async request => calls.push(['launch', request]),
    canResume: async () => true, choose: async () => 'resume', withdraw: async () => calls.push(['withdraw']),
    fail: async error => calls.push(['error', error.message]) }
  assert.equal(await handlePortableRedirect(params), 'exit')
  assert.deepEqual(calls.splice(0), [['launch', { mode: 'redirect' }]])
  params.gate = { intent }
  assert.equal(await handlePortableRedirect(params), 'exit')
  assert.deepEqual(calls.splice(0), [['launch', { mode: 'redirect', intentId: 'same' }]])
  assert.equal(await handlePortableRedirect({ ...params, canResume: async () => false, choose: async () => 'withdraw' }), 'relaunch')
  assert.deepEqual(calls.splice(0), [['withdraw']])
  assert.equal(await handlePortableRedirect({ ...params, canResume: async () => false, choose: async () => 'exit' }), 'exit')
  assert.deepEqual(calls, [])
  assert.equal(await handlePortableRedirect({ ...params, gate: { receipt: true }, launch: async () => { throw Error('uninstalled') } }), 'exit')
  assert.deepEqual(calls, [['error', 'uninstalled']])
})

test('desktop refresh touches only existing .lnk targets in the source root and preserves unrelated links', async t => {
  const desktop = await mkdtemp(join(tmpdir(), 'eduwork-migration-links-'))
  t.after(() => rm(desktop, { recursive: true, force: true }))
  const target = join(desktop, 'installed', 'EduWork-Electron.exe')
  const links = new Map([['old.LNK', join(root, 'EduWork.exe')], ['second.lnk', join(root, 'ChatECNU-Work.exe')],
    ['other.lnk', join(root + '-backup', 'EduWork.exe')], ['tool.lnk', join(root, 'Node.exe')], ['external.url', join(root, 'EduWork.exe')]])
  for (const name of links.keys()) await writeFile(join(desktop, name), '')
  const writes = [], failures = []
  await refreshPortableShortcuts({ desktop, sourceRoot: root, executable: target, appId: 'org.eduwork.eduwork.electron',
    read: path => ({ target: links.get(path.split(/[\\/]/).at(-1)) }),
    write: (path, operation, options) => { writes.push([path, operation, options]); return !path.endsWith('second.lnk') }, warn: error => failures.push(error) })
  assert.deepEqual(writes.map(([path]) => path.split(/[\\/]/).at(-1)).sort(), ['old.LNK', 'second.lnk'])
  assert.equal(writes[0][1], 'update')
  assert.deepEqual(writes[0][2], { target, cwd: join(desktop, 'installed'), args: '', icon: target, iconIndex: 0, appUserModelId: 'org.eduwork.eduwork.electron' })
  assert.equal(failures.length, 1)
})

test('new source hints retain the historical format and do not write in the portable root', async t => {
  const localAppData = await mkdtemp(join(tmpdir(), 'eduwork-migration-hint-'))
  t.after(() => rm(localAppData, { recursive: true, force: true }))
  const path = await writePortableSourceHint({ localAppData, distribution: 'eduwork', root, version: '0.4.15' })
  assert.equal(path, join(localAppData, 'EduWork', 'eduwork.portable-source.json'))
  assert.equal(JSON.parse(await readFile(path, 'utf8')).root, root)
  assert.equal(await writePortableSourceHint({ localAppData, distribution: '../wrong', root, version: '0.4.15' }), undefined)
})
