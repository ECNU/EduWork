// Wire contract of the calendar remote face: the host manifest that
// typert-loader registers and the client face the panel mounts must describe
// one and the same method, or the panel silently calls nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const require = runtime ? createRequire(join(runtime, 'package.json')) : undefined
const runtimeParent = runtime ? pathToFileURL(join(runtime, 'package.json')).href : undefined
const load = name => import(pathToFileURL(require.resolve(name)).href)

let hooks
function bindRuntime() {
  hooks ??= registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, { ...context, parentURL: runtimeParent })
      return nextResolve(specifier, context)
    },
  })
}

let faces
async function loadFaces() {
  bindRuntime()
  faces ??= (async () => {
    const [host, client, loader, manifest] = await Promise.all([
      import('../lib/typert.host.js'),
      import('../lib/typert.remote-client.js'),
      load('@deepseek-ai/dsh-typert-loader'),
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ])
    return { host: host.default, client: client.default, loader, pkg: JSON.parse(manifest) }
  })()
  return await faces
}

test.after(() => hooks?.deregister())

test('host and client faces describe the same calendar methods', { skip: !runtime }, async () => {
  const { host, client, pkg } = await loadFaces()
  assert.equal(host.package, pkg.name)
  assert.equal(host.face, 'host')
  assert.equal(client.package, host.package)
  const shape = descriptors => descriptors.map(({ id, service, namespace, method, result, parameters }) => ({
    id,
    service,
    namespace,
    method,
    type: result.typeSymbol,
    parameters: parameters.map(({ name, wire, source, codec }) => ({ name, wire, source, type: codec.typeSymbol })),
  }))
  assert.deepEqual(shape(client.descriptors), shape(host.invocations))
  assert.deepEqual(host.invocations.map(descriptor => descriptor.method), [
    'snapshot', 'occurrences', 'importIcs', 'exportIcs', 'deleteEvent',
    'applyOverride', 'removeOverride', 'cancelOccurrence', 'restoreOccurrence', 'putEvent',
  ])
})

test('every descriptor points at the method that implements it', { skip: !runtime }, async () => {
  const { host } = await loadFaces()
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  const lines = source.split('\n')
  for (const descriptor of host.invocations) {
    const { file, line } = descriptor.sourceLocation
    assert.equal(file, 'dsh-plugins/calendar/lib/index.js')
    // The line is what a reader opens first, so it has to still be the method.
    assert.match(lines[line - 1] ?? '', new RegExp(`\\b${descriptor.method}\\s*\\(`), `${descriptor.method} is no longer on line ${line}`)
  }
})

test('the wire schemas accept the real shapes and reject the wrong ones', { skip: !runtime }, async () => {
  const { host } = await loadFaces()
  const byMethod = new Map(host.invocations.map(descriptor => [descriptor.method, descriptor]))
  const snapshot = byMethod.get('snapshot')
  const occurrences = byMethod.get('occurrences')
  assert.equal(snapshot.result.schema.safeParse({ schemaVersion: 2, events: [] }).success, true)
  assert.equal(snapshot.result.schema.safeParse({ schemaVersion: 2 }).success, false)
  // A payload that still carries the retired course list is a shape this
  // contract does not have, and saying so is what keeps it out of the panel.
  assert.equal(snapshot.result.schema.safeParse({ schemaVersion: 2, events: [], courses: [] }).success, false)

  const [range] = occurrences.parameters
  assert.equal(range.codec.schema.safeParse({ from: '2026-03-02', to: '2026-03-08' }).success, true)
  assert.equal(range.codec.schema.safeParse({}).success, true)
  assert.equal(range.codec.schema.safeParse({ from: '2026-03-02', since: '2026-03-01' }).success, false)
  assert.equal(range.codec.schema.safeParse({ from: '2026/03/02' }).success, false)

  const occurrence = {
    uid: 'event-fixture-1',
    title: '示例日程',
    start: '2026-03-02T08:00',
    occurrenceId: 'event-fixture-1#2026-03-02',
    occurrenceDate: '2026-03-02',
  }
  const payload = extra => ({ schemaVersion: 2, occurrences: [{ ...occurrence, ...extra }] })
  assert.equal(occurrences.result.schema.safeParse(payload({})).success, true)
  assert.equal(occurrences.result.schema.safeParse(payload({ overridden: true })).success, true)
  assert.equal(occurrences.result.schema.safeParse(payload({ overrides: [] })).success, false, 'series bookkeeping stays out of the wire shape')
  assert.equal(occurrences.result.schema.safeParse(payload({ occurrenceDate: '2026-03-02T08:00' })).success, false)

  // The write methods read one object argument each, and nothing else.
  const importSchema = byMethod.get('importIcs').parameters[0].codec.schema
  assert.equal(importSchema.safeParse({ text: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }).success, true)
  assert.equal(importSchema.safeParse({ text: 'x', source: 'registrar', replace: false }).success, true)
  assert.equal(importSchema.safeParse({ text: '' }).success, false)
  assert.equal(importSchema.safeParse({ text: 'x', folder: 'inbox' }).success, false)

  const overrideSchema = byMethod.get('applyOverride').parameters[0].codec.schema
  assert.equal(overrideSchema.safeParse({ uid: 'a', date: '2026-03-09', patch: { location: '示例楼 202' } }).success, true)
  assert.equal(overrideSchema.safeParse({ uid: 'a', date: '2026-03-09', patch: {} }).success, true, 'the record contract rejects an empty patch, not the wire schema')
  assert.equal(overrideSchema.safeParse({ uid: 'a', date: '2026-03-09' }).success, false)
  assert.equal(overrideSchema.safeParse({ uid: 'a', date: '2026-03-09', patch: { teacher: 'x' } }).success, false)
  assert.equal(overrideSchema.safeParse({ uid: 'a', date: '09/03/2026', patch: { location: 'x' } }).success, false)

  const cancelSchema = byMethod.get('cancelOccurrence').parameters[0].codec.schema
  assert.equal(cancelSchema.safeParse({ uid: 'a', date: '2026-03-09' }).success, true)
  assert.equal(cancelSchema.safeParse({ uid: 'a', date: '2026-03-09', patch: { location: 'x' } }).success, false)

  // Creating and editing one entry go through the same record shape, so what the
  // panel writes is what the store validated.
  const putEventSchema = byMethod.get('putEvent').parameters[0].codec.schema
  assert.equal(putEventSchema.safeParse({
    uid: 'manual-fixture-1',
    title: '示例日程',
    start: '2026-03-02T08:00',
    end: '2026-03-02T09:00',
    location: '示例楼 202',
    description: '示例备注',
    source: 'manual',
    extensions: {},
  }).success, true)
  assert.equal(putEventSchema.safeParse({ uid: 'manual-fixture-1', title: '示例日程' }).success, false)
  assert.equal(putEventSchema.safeParse({ uid: 'manual-fixture-1', title: '示例日程', start: '2026-03-02T08:00', courseId: 'x' }).success, false)
})

test('the manifest passes the loader validation and stays owned by this package', { skip: !runtime }, async () => {
  const { host, loader, pkg } = await loadFaces()
  assert.equal(loader.validateTypertManifest(pkg.name, host), host)
  assert.throws(() => loader.validateTypertManifest('@eduwork/dsh-other', host), /owned by the package/)
})

test('the package publishes both faces and depends on the remote protocol', { skip: !runtime }, async () => {
  const { pkg } = await loadFaces()
  assert.equal(pkg.exports['./typert'], './lib/typert.host.js')
  assert.equal(pkg.exports['./remote'], './lib/typert.remote-client.js')
  assert.ok(pkg.peerDependencies['@deepseek-ai/dsh-typert-protocol'])
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-remotes'))
})
