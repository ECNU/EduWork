// The agent tool surface: what the tools are called, what they write, and who is
// allowed to write. The tools read and write through the `calendar` service, so
// the service is stood in for here and the real record rules come from
// `lib/model.js` — a fake that re-implemented them would prove nothing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WRITE_TOOLS } from '../lib/tool-permission.js'

const runtime = process.env.EDUWORK_TEST_RUNTIME
const require = runtime ? createRequire(join(runtime, 'package.json')) : undefined
const runtimeParent = runtime ? pathToFileURL(join(runtime, 'package.json')).href : undefined

let hooks
function bindRuntime() {
  hooks ??= registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')) {
        return nextResolve(specifier, { ...context, parentURL: runtimeParent })
      }
      return nextResolve(specifier, context)
    },
  })
}

test.after(() => hooks?.deregister())

// `lib/model.js` needs `zod` and `lib/tools.js` needs the tool API, so both are
// loaded after the runtime is bound, as `remote.test.mjs` does with the loader.
let loaded
async function loadPluginTools() {
  bindRuntime()
  loaded ??= await import('../lib/tools.js')
  return loaded
}

let model
async function loadModel() {
  bindRuntime()
  model ??= await import('../lib/model.js')
  return model
}

/** A context that records what the plugin registers and how it gates calls. */
function harness(service, preset = 'standard') {
  const registered = []
  const handlers = []
  const ctx = {
    calendar: service,
    permissionPresets: { current: () => preset },
    tools: { register: definition => { registered.push(definition) } },
    on: (name, handler) => { handlers.push({ name, handler }) },
  }
  return { ctx, registered, handlers }
}

/** A calendar service over plain records, using the real occurrence rules. */
async function service(events = []) {
  const { normalizeEvent, occurrencesIn } = await loadModel()
  const records = [...events]
  const calls = []
  return {
    calls,
    occurrences: range => ({ schemaVersion: 2, occurrences: occurrencesIn(records, range) }),
    getEvent: uid => records.find(event => event.uid === uid),
    putEvent: async input => {
      const record = normalizeEvent(input)
      calls.push({ method: 'putEvent', record })
      return record
    },
    deleteEvent: async input => { calls.push({ method: 'deleteEvent', input }); return { removed: true } },
    applyOverride: async input => { calls.push({ method: 'applyOverride', input }); return { uid: input.uid, title: '组会', start: '2026-10-08T15:00' } },
    removeOverride: async input => { calls.push({ method: 'removeOverride', input }); return { uid: input.uid, title: '组会', start: '2026-10-07T15:00' } },
    cancelOccurrence: async input => { calls.push({ method: 'cancelOccurrence', input }); return { uid: input.uid, title: '组会', start: '2026-10-07T15:00' } },
    restoreOccurrence: async input => { calls.push({ method: 'restoreOccurrence', input }); return { uid: input.uid, title: '组会', start: '2026-10-07T15:00' } },
  }
}

const WEEKLY = {
  uid: 'series-1',
  title: '组会',
  start: '2026-10-07T15:00',
  end: '2026-10-07T16:00',
  location: '理科楼 305',
  recurrence: { freq: 'weekly' },
  exceptions: ['2026-10-21'],
}

/** The tool with one name, from a context that registered them all. */
async function tool(name, backing, preset) {
  const tools = await loadPluginTools()
  const { ctx, registered, handlers } = harness(backing, preset)
  tools.apply(ctx)
  const definition = registered.find(entry => entry.name === name)
  assert.ok(definition, `${name} is registered`)
  return { definition, registered, handlers }
}

test('the registered surface is the five calendar tools, behind one write gate', { skip: !runtime }, async () => {
  const { registered, handlers } = await tool('calendar_list_events', await service())
  assert.deepEqual(registered.map(entry => entry.name), [
    'calendar_list_events',
    'calendar_create_event',
    'calendar_update_event',
    'calendar_delete_event',
    'calendar_occurrence',
  ])
  assert.deepEqual(handlers.map(entry => entry.name), ['tools/pre-execute'])
  // A new tool that is not the read one must be declared in WRITE_TOOLS, or it
  // would write with no approval in front of it.
  for (const entry of registered) {
    if (entry.name === 'calendar_list_events') continue
    assert.ok(WRITE_TOOLS.has(entry.name), `${entry.name} is gated`)
  }
  assert.ok(!WRITE_TOOLS.has('calendar_list_events'), 'reading is not gated')
})

test('every tool describes its arguments and its answer', { skip: !runtime }, async () => {
  const { registered } = await tool('calendar_list_events', await service())
  for (const entry of registered) {
    assert.equal(typeof entry.description, 'string')
    assert.ok(entry.description.length > 20, `${entry.name} explains itself`)
    assert.equal(entry.parameters.type, 'object')
    assert.equal(entry.output.schema.type, 'object')
    assert.equal(typeof entry.output.render, 'function')
    assert.equal(typeof entry.execute, 'function')
  }
  const create = registered.find(entry => entry.name === 'calendar_create_event')
  assert.deepEqual(create.parameters.required, ['title', 'start'])
  const occurrence = registered.find(entry => entry.name === 'calendar_occurrence')
  assert.deepEqual(occurrence.parameters.properties.action.enum, ['move', 'reset', 'cancel', 'restore'])
})

test('a missing argument is rejected before anything is written', { skip: !runtime }, async () => {
  const backing = await service()
  const { definition } = await tool('calendar_create_event', backing)
  await assert.rejects(() => definition.execute({ title: '组会' }, {}), /start/)
  const { definition: update } = await tool('calendar_update_event', backing)
  await assert.rejects(() => update.execute({ title: '组会' }, {}), /uid/)
  assert.deepEqual(backing.calls, [])
})

test('list reads the window through the service and renders one line per date', { skip: !runtime }, async () => {
  const backing = await service([WEEKLY])
  const { definition } = await tool('calendar_list_events', backing)
  const value = await definition.execute({ from: '2026-10-05', to: '2026-10-20' }, {})
  assert.deepEqual(value.events.map(entry => entry.date), ['2026-10-07', '2026-10-14'])
  assert.equal(value.count, 2)
  assert.equal(value.events[0].uid, 'series-1')
  assert.equal(value.events[0].repeats, true)
  const text = definition.output.render({}, value)[0].text
  assert.match(text, /2026-10-07 15:00–16:00 组会 · 理科楼 305 · 每周重复/)
  assert.match(text, /共 2 条/)
})

test('list keeps every window bounded', { skip: !runtime }, async () => {
  const { definition } = await tool('calendar_list_events', await service())
  const defaults = await definition.execute({}, {})
  assert.equal(defaults.from < defaults.to, true)
  await assert.rejects(() => definition.execute({ from: '2000-01-01', to: '2099-01-01' }, {}), /wider than/)
  await assert.rejects(() => definition.execute({ from: '2026-10-10', to: '2026-10-01' }, {}), /earlier than/)
  await assert.rejects(() => definition.execute({ from: '10/10/2026' }, {}), /YYYY-MM-DD/)
})

test('create writes one record, with a repeat only when it was asked for', { skip: !runtime }, async () => {
  const single = await service()
  const first = await tool('calendar_create_event', single)
  await first.definition.execute({ title: '体检', start: '2026-10-12T09:00', end: '2026-10-12T10:00', location: '校医院' }, {})
  const written = single.calls[0].record
  assert.equal(written.source, 'manual', 'the store fills the source, as it does for the panel')
  assert.equal(written.recurrence, undefined)
  assert.match(written.uid, /^[0-9a-f-]{36}$/)
  assert.deepEqual(
    { title: written.title, start: written.start, end: written.end, location: written.location },
    { title: '体检', start: '2026-10-12T09:00', end: '2026-10-12T10:00', location: '校医院' },
  )

  const repeating = await service()
  const second = await tool('calendar_create_event', repeating)
  await second.definition.execute({ title: '组会', start: '2026-10-14T15:00', repeat: 'weekly', until: '2026-12-31' }, {})
  assert.deepEqual(repeating.calls[0].record.recurrence, { freq: 'weekly', until: '2026-12-31' })
})

test('update moves only what the call carries, and keeps the duration', { skip: !runtime }, async () => {
  const backing = await service([WEEKLY])
  const { definition } = await tool('calendar_update_event', backing)
  await definition.execute({ uid: 'series-1', start: '2026-10-09T09:00' }, {})
  const record = backing.calls[0].record
  assert.equal(record.start, '2026-10-09T09:00')
  assert.equal(record.end, '2026-10-09T10:00', 'one hour stays one hour')
  assert.equal(record.location, '理科楼 305', 'a field left out keeps its value')
  assert.deepEqual(record.recurrence, { freq: 'weekly' })
  assert.deepEqual(record.exceptions, ['2026-10-21'])

  await definition.execute({ uid: 'series-1', location: '' }, {})
  assert.equal(backing.calls[1].record.location, undefined, 'an empty string clears a field')

  await definition.execute({ uid: 'series-1', repeat: 'none' }, {})
  const single = backing.calls[2].record
  assert.equal(single.recurrence, undefined)
  assert.equal(single.exceptions, undefined, 'a single entry owns no series bookkeeping')
  await assert.rejects(() => definition.execute({ uid: 'missing' }, {}), /没有 uid 为 missing 的日程/)
})

test('delete and the single-date actions reach the matching service methods', { skip: !runtime }, async () => {
  const backing = await service([WEEKLY])
  const remove = await tool('calendar_delete_event', backing)
  assert.deepEqual(await remove.definition.execute({ uid: 'series-1' }, {}), { uid: 'series-1', removed: true })
  assert.deepEqual(backing.calls[0], { method: 'deleteEvent', input: { uid: 'series-1' } })

  const one = await tool('calendar_occurrence', backing)
  await one.definition.execute({ uid: 'series-1', date: '2026-10-14', action: 'move', start: '2026-10-15T15:00' }, {})
  assert.deepEqual(backing.calls[1], {
    method: 'applyOverride',
    input: { uid: 'series-1', date: '2026-10-14', patch: { start: '2026-10-15T15:00' } },
  })
  await assert.rejects(
    () => one.definition.execute({ uid: 'series-1', date: '2026-10-14', action: 'move' }, {}),
    /至少给出/,
  )
  await one.definition.execute({ uid: 'series-1', date: '2026-10-14', action: 'cancel' }, {})
  assert.equal(backing.calls[2].method, 'cancelOccurrence')
  await one.definition.execute({ uid: 'series-1', date: '2026-10-14', action: 'reset' }, {})
  assert.equal(backing.calls[3].method, 'removeOverride')
  await one.definition.execute({ uid: 'series-1', date: '2026-10-14', action: 'restore' }, {})
  assert.equal(backing.calls[4].method, 'restoreOccurrence')
})

test('writes ask first, unless the session already runs without approvals', { skip: !runtime }, async () => {
  const agent = { session: { header: { id: 'session-1' } } }
  const decide = async (preset, exec) => {
    const { handlers } = await tool('calendar_list_events', await service(), preset)
    let continued = 0
    const decision = await handlers[0].handler(exec, () => { continued += 1 })
    return { decision, continued }
  }
  assert.deepEqual(await decide('standard', { name: 'calendar_create_event', agent }), {
    decision: { kind: 'ask', reason: 'Allow the Agent to create, change or delete entries in the local calendar' },
    continued: 0,
  })
  assert.deepEqual(await decide('danger-full-access', { name: 'calendar_delete_event', agent }), { decision: undefined, continued: 1 })
  assert.deepEqual(await decide('standard', { name: 'calendar_list_events', agent }), { decision: undefined, continued: 1 })
  assert.deepEqual(await decide('standard', { name: 'calendar_list_events' }), { decision: undefined, continued: 1 })
  assert.equal((await decide('standard', { name: 'calendar_update_event' })).decision.kind, 'deny')
})
