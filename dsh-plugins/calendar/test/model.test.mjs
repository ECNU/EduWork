// Record shape of the public calendar contract. Pure model tests: no storage,
// no Host, no browser.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// `dsh-plugins/*` ships no node_modules: zod comes from the Runtime pinned by
// the assembly. Without one these tests skip, like the other plugin tests.
const runtime = process.env.EDUWORK_TEST_RUNTIME
const runtimeParent = runtime ? pathToFileURL(join(runtime, 'package.json')).href : undefined

let hooks
function bindRuntime() {
  hooks ??= registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, { ...context, parentURL: runtimeParent })
      return nextResolve(specifier, context)
    },
  })
}

let model
async function loadModel() {
  bindRuntime()
  model ??= await import('../lib/model.js')
  return model
}

test.after(() => hooks?.deregister())

test('an event is defaulted, not rewritten', { skip: !runtime }, async () => {
  const { normalizeEvent } = await loadModel()
  assert.deepEqual(normalizeEvent({ uid: 'event-fixture-1', title: '示例日程', start: '2026-03-02T08:00' }), {
    uid: 'event-fixture-1',
    title: '示例日程',
    start: '2026-03-02T08:00',
    source: 'manual',
    extensions: {},
  })
})

test('absent optional fields stay absent instead of becoming null', { skip: !runtime }, async () => {
  const { normalizeEvent } = await loadModel()
  const event = normalizeEvent({ uid: 'event-fixture-2', title: '示例讲座', start: '2026-03-04', end: null, location: null, recurrence: null })
  assert.equal('end' in event, false)
  assert.equal('location' in event, false)
  assert.equal('recurrence' in event, false)
})

test('the supported recurrence subset is stored, unsupported rules are not', { skip: !runtime }, async () => {
  const { normalizeEvent } = await loadModel()
  const event = normalizeEvent({
    uid: 'event-fixture-3',
    title: '示例日程',
    start: '2026-03-02T08:00',
    recurrence: { freq: 'weekly', interval: 2, count: 8, until: '2026-06-20', byDay: ['mo', 'we'] },
  })
  assert.deepEqual(event.recurrence, { freq: 'weekly', interval: 2, count: 8, until: '2026-06-20', byDay: ['mo', 'we'] })
  // Monthly/yearly rules and BYSETPOS are out of scope; the importer keeps the
  // original RRULE text in `extensions` and degrades the event to one occurrence.
  assert.throws(() => normalizeEvent({ uid: 'event-fixture-4', title: '示例', start: '2026-03-02', recurrence: { freq: 'monthly' } }))
  const degraded = normalizeEvent({
    uid: 'event-fixture-5',
    title: '示例',
    start: '2026-03-02',
    extensions: { rrule: 'FREQ=MONTHLY;BYMONTHDAY=15' },
  })
  assert.deepEqual(degraded.extensions, { rrule: 'FREQ=MONTHLY;BYMONTHDAY=15' })
})

test('local time strings are the only accepted time format', { skip: !runtime }, async () => {
  const { normalizeEvent } = await loadModel()
  assert.equal(normalizeEvent({ uid: 'e', title: 't', start: '2026-03-02' }).start, '2026-03-02')
  assert.throws(() => normalizeEvent({ uid: 'e', title: 't', start: '2026-03-02T08:00:00Z' }), /expected YYYY-MM-DD/)
  assert.throws(() => normalizeEvent({ uid: 'e', title: 't', start: '2026/03/02' }), /expected YYYY-MM-DD/)
  assert.throws(() => normalizeEvent({ uid: 'e', title: 't', start: '2026-03-02T8:00' }), /expected YYYY-MM-DD/)
})

test('unrecognized fields belong in extensions, not beside the known ones', { skip: !runtime }, async () => {
  const { normalizeEvent } = await loadModel()
  assert.throws(() => normalizeEvent({ uid: 'e', title: 't', start: '2026-03-02', classroom: 'A' }))
  // A calendar holds events and nothing above them: an event still carrying the
  // retired `courseId` is a shape this contract does not have.
  assert.throws(() => normalizeEvent({ uid: 'e', title: 't', start: '2026-03-02', courseId: 'course-fixture-1' }))
  const kept = normalizeEvent({ uid: 'e', title: 't', start: '2026-03-02', extensions: { 'X-TEACHER': '示例教师' } })
  assert.equal(kept.extensions['X-TEACHER'], '示例教师')
})

test('required fields are enforced', { skip: !runtime }, async () => {
  const { normalizeEvent } = await loadModel()
  assert.throws(() => normalizeEvent({ title: 't', start: '2026-03-02' }))
  assert.throws(() => normalizeEvent({ uid: '', title: 't', start: '2026-03-02' }))
  assert.throws(() => normalizeEvent({ uid: 'e', title: '', start: '2026-03-02' }))
})

test('snapshots are versioned and ordered', { skip: !runtime }, async () => {
  const { SCHEMA_VERSION, buildSnapshot } = await loadModel()
  const snapshot = buildSnapshot([
    { uid: 'late', title: '后', start: '2026-03-04T09:00', source: 'manual', extensions: {} },
    { uid: 'early', title: '先', start: '2026-03-02T09:00', source: 'manual', extensions: {} },
  ])
  assert.equal(snapshot.schemaVersion, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 2)
  assert.deepEqual(Object.keys(snapshot), ['schemaVersion', 'events'])
  assert.deepEqual(snapshot.events.map(row => row.uid), ['early', 'late'])
})

test('range overlap treats a date-only end as the whole day', { skip: !runtime }, async () => {
  const { overlaps } = await loadModel()
  const allDay = { start: '2026-03-02', end: '2026-03-02' }
  assert.equal(overlaps(allDay, { from: '2026-03-02T20:00', to: '2026-03-02T21:00' }), true)
  assert.equal(overlaps(allDay, { from: '2026-03-03' }), false)
  assert.equal(overlaps(allDay, { to: '2026-03-01' }), false)
  assert.equal(overlaps({ start: '2026-03-02T08:00', end: '2026-03-02T09:35' }, { from: '2026-03-02T09:00', to: '2026-03-02T10:00' }), true)
  assert.equal(overlaps({ start: '2026-03-02T08:00', end: '2026-03-02T09:35' }, { from: '2026-03-02T09:35', to: '2026-03-02T10:00' }), true)
  assert.equal(overlaps({ start: '2026-03-02T08:00', end: '2026-03-02T09:35' }, { from: '2026-03-03' }), false)
  assert.equal(overlaps({ start: '2026-03-03T08:00' }, {}), true)
})
