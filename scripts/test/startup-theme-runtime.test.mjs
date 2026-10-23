import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { patchStartupThemeRuntime, patchStartupThemeSource, startupThemePatch } from '../patch-startup-theme-runtime.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const originalPath = runtime && join(runtime, 'node_modules', startupThemePatch.package, startupThemePatch.file)

function themeFixture(source, { preference, systemDark = false, dom = true, hostPreference } = {}) {
  let ThemeRuntime, value
  const subscribers = new Set(), mediaListeners = new Set(), writes = [], events = []
  const section = preference => ({ preference, fontSize: 14, codeFontSize: 11, terminalFontSize: 13,
    textFontFamily: '', codeFontFamily: '', terminalFontFamily: '' })
  if (hostPreference !== undefined) value = section(hostPreference)
  const host = {
    getSnapshot: () => ({ value }),
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener) },
    async set(field, next) {
      writes.push([field, next])
      value = { ...section('system'), ...value, [field]: next }
      for (const listener of subscribers) listener()
      return true
    },
  }
  const media = { matches: systemDark,
    addEventListener: (_event, listener) => mediaListeners.add(listener),
    removeEventListener: (_event, listener) => mediaListeners.delete(listener) }
  // Rendering and keyboard services are not mounted; execute the real bundle's
  // exported state owner with only its DOM, media, and settings boundaries.
  const dependencies = new Set(['react/jsx-runtime', 'react', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-store'])
  const sandbox = { window: { __ModuleLoader__: { load({ id, factory }) {
    assert.equal(id, startupThemePatch.package)
    ThemeRuntime = factory(name => {
      assert.ok(dependencies.has(name), `unexpected dependency: ${name}`)
      return {}
    }).ThemeRuntime
  } } } }
  if (dom) {
    sandbox.document = { documentElement: { dataset: { dsThemeSource: preference } },
      body: { style: { getPropertyValue: () => '' } }, querySelector: () => ({}) }
    sandbox.matchMedia = () => media
  }
  runInNewContext(source.toString('utf8'), sandbox, { filename: startupThemePatch.file, timeout: 1_000 })
  const theme = new ThemeRuntime({ effect: callback => callback(), inject() {},
    emit: (_event, snapshot) => events.push(snapshot) }, host)
  return { theme, writes, events,
    setHostPreference(preference) {
      value = section(preference)
      for (const listener of subscribers) listener()
    },
    changeSystem(dark) {
      media.matches = dark
      for (const listener of mediaListeners) listener()
    },
  }
}

test('unreviewed theme bytes are rejected', () => {
  assert.throws(() => patchStartupThemeSource(Buffer.from('changed upstream')), /input changed/)
})

test('theme adapter checks version and bytes, records output and preserves the npm input', { skip: !runtime }, async t => {
  const original = await readFile(originalPath)
  const modules = await mkdtemp(join(tmpdir(), 'eduwork-startup-theme-'))
  t.after(() => rm(modules, { recursive: true, force: true }))
  const copy = join(modules, startupThemePatch.package)
  await mkdir(join(copy, 'lib'), { recursive: true })
  const manifest = join(copy, 'package.json'), target = join(copy, startupThemePatch.file)
  await writeFile(manifest, await readFile(join(runtime, 'node_modules', startupThemePatch.package, 'package.json')))
  await writeFile(target, original)
  const receipt = await patchStartupThemeRuntime(modules), patched = await readFile(target)
  assert.deepEqual(receipt, { ...startupThemePatch, afterSHA256: createHash('sha256').update(patched).digest('hex') })
  assert.deepEqual(await readFile(originalPath), original)
  await assert.rejects(patchStartupThemeRuntime(modules), /input changed/)
  assert.deepEqual(await readFile(target), patched)
  for (const changed of [{ name: startupThemePatch.package, version: '0.2.2' }, { name: 'unexpected', version: startupThemePatch.version }]) {
    await writeFile(manifest, JSON.stringify(changed))
    await assert.rejects(patchStartupThemeRuntime(modules), /newly qualified/)
    assert.deepEqual(await readFile(target), patched)
  }
})

test('packaged ThemeRuntime keeps the bootstrap palette until Host settings arrive', { skip: !runtime }, async t => {
  const original = await readFile(originalPath), patched = patchStartupThemeSource(original)
  for (const preference of ['dark', 'light']) {
    const opposite = preference === 'dark' ? 'light' : 'dark', systemDark = opposite === 'dark'
    await t.test(`${preference} bootstrap reproduces the original opposite-system first snapshot`, () => {
      const fixture = themeFixture(original, { preference, systemDark })
      assert.equal(fixture.theme.getTheme().preference, 'system')
      assert.equal(fixture.theme.getTheme().active.colorScheme, opposite)
      fixture.setHostPreference(preference)
      assert.equal(fixture.theme.getTheme().active.colorScheme, preference)
      assert.deepEqual(fixture.writes, [])
    })
    await t.test(`${preference} bootstrap survives initialization; Host remains authoritative`, async () => {
      const fixture = themeFixture(patched, { preference, systemDark })
      assert.equal(fixture.theme.getTheme().preference, preference)
      assert.equal(fixture.theme.getTheme().active.colorScheme, preference)
      fixture.changeSystem(!systemDark)
      fixture.changeSystem(systemDark)
      assert.equal(fixture.theme.getTheme().active.colorScheme, preference)
      assert.equal(fixture.events.length, 0)
      assert.deepEqual(fixture.writes, [])
      fixture.setHostPreference(opposite)
      assert.equal(fixture.theme.getTheme().preference, opposite)
      assert.equal(fixture.theme.getTheme().active.colorScheme, opposite)
      assert.equal(fixture.events.at(-1).active.colorScheme, opposite)
      assert.deepEqual(fixture.writes, [])
      fixture.setHostPreference('system')
      fixture.changeSystem(!systemDark)
      assert.equal(fixture.theme.getTheme().preference, 'system')
      assert.equal(fixture.theme.getTheme().active.colorScheme, preference)
      fixture.theme.setTheme(opposite)
      await Promise.resolve()
      assert.deepEqual(fixture.writes, [['preference', opposite]])
      assert.equal(fixture.theme.getTheme().preference, opposite)
    })
    await t.test(`${preference} bootstrap yields to settings already loaded`, () => {
      const fixture = themeFixture(patched, { preference, systemDark, hostPreference: opposite })
      assert.equal(fixture.theme.getTheme().preference, opposite)
      assert.deepEqual(fixture.writes, [])
    })
  }
  await t.test('system, missing and invalid bootstrap values follow the media query', () => {
    for (const preference of ['system', undefined, '', 'unknown', 'DARK']) for (const systemDark of [false, true]) {
      const fixture = themeFixture(patched, { preference, systemDark })
      assert.equal(fixture.theme.getTheme().preference, 'system')
      assert.equal(fixture.theme.getTheme().active.colorScheme, systemDark ? 'dark' : 'light')
      fixture.changeSystem(!systemDark)
      assert.equal(fixture.theme.getTheme().active.colorScheme, systemDark ? 'light' : 'dark')
      assert.deepEqual(fixture.writes, [])
    }
  })
  await t.test('documentless Runtime retains the default and later adopts Host settings', () => {
    const fixture = themeFixture(patched, { dom: false })
    assert.equal(fixture.theme.getTheme().preference, 'system')
    assert.equal(fixture.theme.getTheme().active.colorScheme, 'light')
    fixture.setHostPreference('dark')
    assert.equal(fixture.theme.getTheme().active.colorScheme, 'dark')
    assert.deepEqual(fixture.writes, [])
  })
})
