import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { pathToFileURL } from 'node:url'
import { adaptHostEntry, adaptHostProcess } from '../prepare.mjs'
import { Decoder, encodeFrame, CHUNK_BYTES } from '../wire.mjs'

test('outer frames retain binary bytes and fragmented headers without base64', () => {
  const bytes = Buffer.from([0, 255, 13, 10, 1])
  const frame = encodeFrame(2, 99, bytes)
  const decoder = new Decoder(), result = []
  for (const byte of frame) result.push(...decoder.push(Buffer.from([byte])))
  decoder.finish()
  assert.equal(result.length, 1)
  assert.deepEqual(result[0], { type: 2, streamId: 99, payload: bytes })
  assert.throws(() => encodeFrame(2, 1, Buffer.alloc(CHUNK_BYTES + 1)), /invalid/)
  const partial = new Decoder(); partial.push(frame.subarray(0, 8))
  assert.throws(() => partial.finish(), /truncated/)
})

test('adaptation fails closed if locked upstream targets move', () => {
  assert.throws(() => adaptHostEntry('changed source'), /target changed/)
  assert.throws(() => adaptHostProcess('changed source'), /target changed/)
})

test('shared Host changes preserve product roots and carry bootstrap only on stdin', { skip: !process.env.DSH_HOST_SOURCE }, async () => {
  const processSource = await readFile(join(process.env.DSH_HOST_SOURCE, 'apps/desktop/src/host-process.ts'), 'utf8')
  const entrySource = await readFile(join(process.env.DSH_HOST_SOURCE, 'apps/desktop-host/src/index.ts'), 'utf8')
  const adapted = adaptHostProcess(processSource)
  assert.match(adapted, /child\.stdin\?\.end\(bootstrap\)/)
  assert.match(adapted, /child\.stdout\?\.pipe\(process\.stderr\)/)
  assert.match(adapted, /windowsHide: true/)
  assert.match(adaptHostEntry(entrySource), /roots: Array\.isArray/)
  assert.doesNotMatch(adaptHostEntry(entrySource), /closeSync/)
  assert.match(adaptHostEntry(entrySource), /requestPipe\.destroy\(\)/)
  assert.match(adaptHostEntry(entrySource), /responsePipe\.destroy\(\)/)
  const argv = adapted.slice(adapted.indexOf('spawn(this.node'), adapted.indexOf('cwd:'))
  assert.doesNotMatch(argv, /bootstrap/)
})

test('legacy desktop defaults cannot re-enable a picker explicitly replaced by the product', {
  skip: !process.env.DSH_HOST_SOURCE || !process.env.EDUWORK_TEST_RUNTIME,
}, async () => {
  const req = createRequire(join(process.env.EDUWORK_TEST_RUNTIME, 'package.json'))
  const { composeEntries } = await import(pathToFileURL(req.resolve('@deepseek-ai/dsh-app-boot')))
  const source = stripTypeScriptTypes(adaptHostEntry(await readFile(join(process.env.DSH_HOST_SOURCE, 'apps/desktop-host/src/index.ts'), 'utf8')), { mode: 'strip' })
  const fn = source.slice(source.indexOf('function desktopPatches('), source.indexOf('function dshVersion('))
  const defaults = [{ id: 'directory-picker', disabled: true }, { insert: [
    { id: 'directory-picker-native', name: 'native-host' }, { id: 'ui-directory-picker-native', name: 'native-client' },
  ] }, { id: 'unrelated', config: { value: 'desktop' } }]
  for (const replace of [false, true]) {
    const profile = { layers: [{ patches: [{ insert: [{ id: 'directory-picker', name: 'auto' }, { id: 'unrelated', name: 'other' }] }] }],
      patches: replace ? [{ id: 'directory-picker-native', disabled: true }, { id: 'ui-directory-picker-native', disabled: true },
        { insert: [{ id: 'product-picker', name: 'product-host' }] }] : [] }
    // Execute the adapted, hash-pinned upstream composition function with the
    // real overlay reducer. Disk/profile reads are synthetic; patch order is not.
    const desktopPatches = new Function('dirname', 'packageManifestPath', 'loadProfileDirectory', 'loadOverlayPatches', 'composeEntries', 'join', 'DESKTOP_PATCH', `return (${fn})`)(
      () => '/synthetic/dsh', () => '/synthetic/dsh/package.json', () => profile, () => defaults, composeEntries, join, '/synthetic/desktop.patch.yml')
    const rows = new Map(composeEntries([desktopPatches('/synthetic/profile', true)]).map(row => [row.id, row]))
    assert.equal(rows.get('directory-picker-native').disabled === true, replace)
    assert.equal(rows.get('ui-directory-picker-native').disabled === true, replace)
    assert.equal(rows.has('product-picker'), replace)
    assert.equal(rows.get('unrelated').config.value, 'desktop', 'unrelated desktop precedence must remain unchanged')
  }
})
