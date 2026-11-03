// Calendar annotations: week labels and range bands a data plugin supplies.
//
// These tests drive the registry the way the first provider — an institution's
// academic calendar — will: register, answer ranges, break, and dispose. What
// must hold is that annotations are only ever decoration: a provider that
// throws or answers outside the contract is dropped for that read while the
// others still show, and nothing a provider does can touch stored events.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// `dsh-plugins/*` ships no node_modules: the Runtime pinned by the assembly
// provides storage and zod. Without one these tests skip, like the others.
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

let modules
async function loadModules() {
  bindRuntime()
  modules ??= (async () => {
    const [cordis, hub, json, domain, plugin] = await Promise.all([
      load('@deepseek-ai/cordis'),
      load('@deepseek-ai/dsh-storage'),
      load('@deepseek-ai/dsh-storage-json'),
      load('@deepseek-ai/dsh-storage-domain'),
      import('../lib/index.js'),
    ])
    return { Context: cordis.Context, storageHub: hub, storageJson: json, storageDomain: domain, CalendarService: plugin.CalendarService }
  })()
  return await modules
}

test.after(() => hooks?.deregister())

/** The temporary tree a test owns; removed only after its path was verified. */
async function withRoot(prefix, body) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await body(root)
  } finally {
    const target = resolve(root)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith(prefix))
    await rm(target, { recursive: true, force: true })
  }
}

/** Run one body against a started calendar service. */
async function withCalendar(root, body) {
  const { Context, storageHub, storageJson, storageDomain, CalendarService } = await loadModules()
  const ctx = new Context()
  try {
    await ctx.plugin(storageHub.default ?? storageHub)
    await ctx.plugin(storageJson, { root: join(root, 'storages') })
    await ctx.plugin(storageDomain, { backend: 'json' })
    await ctx.plugin(CalendarService)
    const { default: AcademicCalendar } = await import('../../../packages/dsh-academic-calendar/lib/index.js')
    await ctx.plugin(AcademicCalendar)
    await ctx.academicCalendar.ready
    return await body(ctx.academicCalendar, ctx.calendar, ctx)
  } finally {
    await ctx.fiber.dispose()
  }
}

const DATA = { schemaVersion: 2, academicYear: '2026-2027', terms: [{ id: 'autumn', name: '秋季学期', firstDay: '2026-09-14', lastDay: '2027-01-17', weekCount: 18, phases: [
  { kind: 'teaching', name: '教学', firstDay: '2026-09-14', lastDay: '2027-01-01', weeks: [1, 16] },
  { kind: 'examination', name: '考试', firstDay: '2027-01-04', lastDay: '2027-01-15', weeks: [17, 18] },
] }], breaks: [{ id: 'winter', name: '寒假', firstDay: '2027-01-18', lastDay: '2027-02-20' }] }
const timetable = (meetings) => ({ institution: 'example-school', account: 'student-a', dataset: {
  schemaVersion: 1, term: '2026-autumn', timeZone: 'Asia/Shanghai',
  courses: [{ teachingClassCode: 'SYNTHETIC.01', title: '示例课程', meetings }],
} })
const initial = { start: '2026-10-26T09:00', end: '2026-10-26T10:00', teacher: '教师甲', campus: '示例校区', room: '101' }

test('stable concrete occurrence anchors survive disappearance and restart', { skip: !runtime }, async () => {
  await withRoot('academic-anchor-history-', async root => {
    let ref
    await withCalendar(root, async (education, calendar) => {
      await education.importTimetable(timetable([{ ...initial, id: 'stable-lesson' }]))
      const occurrence = calendar.occurrences({ from: '2026-10-26', to: '2026-10-26' }).occurrences[0]
      ref = { scope: 'source', source: occurrence.source, uid: occurrence.uid, originalStart: occurrence.originalStart }
      await calendar.putNote({ ...ref, text: 'single occurrence note' })
      await calendar.setPersonal({ ...ref, patch: { reminder: { kind: 'relative', minutes: 15 } } })
      await education.importTimetable(timetable([]))
      assert.equal(calendar.snapshot().events.length, 0)
    })
    await withCalendar(root, async (education, calendar) => {
      await education.importTimetable(timetable([{ ...initial, id: 'stable-lesson', start: '2026-10-29T11:00', end: '2026-10-29T12:00' }]))
      const current = calendar.occurrences({ from: '2026-10-29', to: '2026-10-29' }).occurrences[0]
      assert.equal(current.uid, ref.uid)
      assert.equal(current.originalStart, ref.originalStart)
      assert.equal(calendar.personalFor({ ...ref, originalStart: current.originalStart }).note.text, 'single occurrence note')
      assert.equal(calendar.reminderPlan({ from: '2026-10-29', to: '2026-10-29' }).tasks[0].at, '2026-10-29T10:45')
    })
  })
})

test('clearing an owned concrete source retains its stable occurrence anchor', { skip: !runtime }, async () => {
  await withRoot('academic-anchor-clear-', async root => withCalendar(root, async (_education, calendar) => {
    const identity = { provider: 'synthetic-concrete', account: 'example', feed: 'lessons', replaceInstances: true }
    const first = calendar.registerSource(identity)
    // A rejected snapshot must not establish an anchor from its valid prefix.
    await assert.rejects(first.apply({ complete: true, events: [
      { uid: 'stable-id', title: '示例课', start: '2026-10-25T09:00', end: '2026-10-25T10:00' },
      { uid: 'invalid', title: '错误安排', start: initial.start, end: '2026-10-26T08:00' },
    ] }))
    await first.apply({ complete: true, events: [{ uid: 'stable-id', title: '示例课', start: initial.start, end: initial.end }] })
    await calendar.putNote({ scope: 'source', source: first.source, uid: 'stable-id', originalStart: initial.start, text: 'retained after unsubscribe' })
    await first.clear(); first.dispose()
    const second = calendar.registerSource(identity)
    await second.apply({ complete: true, events: [{ uid: 'stable-id', title: '示例课', start: '2026-10-29T11:00', end: '2026-10-29T12:00' }] })
    const current = calendar.occurrences({ from: '2026-10-29', to: '2026-10-29' }).occurrences[0]
    assert.equal(current.originalStart, initial.start)
    assert.equal(calendar.personalFor({ scope: 'source', source: second.source, uid: current.uid, originalStart: current.originalStart }).note.text, 'retained after unsubscribe')
  }))
})

test('calendar revisions protect the full education document across restart', { skip: !runtime }, async () => {
  await withRoot('academic-document-version-', async root => {
    const original = { ...structuredClone(DATA), revision: 4 }
    await withCalendar(root, async education => {
      const handle = await education.registerDataset({ id: 'versioned', label: '版本测试', dataset: original })
      handle.dispose()
      const changed = structuredClone(original)
      changed.breaks[0].name = '修改假期名称'
      await assert.rejects(education.registerDataset({ id: 'versioned', label: '版本测试', dataset: changed }), /revision_conflict/)
      changed.revision = 5
      const updated = await education.registerDataset({ id: 'versioned', label: '版本测试', dataset: changed })
      assert.equal(education.query({ from: '2027-01-18' }).days[0].break.name, '修改假期名称')
      updated.dispose()
    })
    await withCalendar(root, async education => {
      await assert.rejects(education.registerDataset({ id: 'versioned', label: '版本测试', dataset: original }), /stale_revision/)
    })
  })
})

test('notification clicks resolve a durable receipt to the source-scoped event', { skip: !runtime }, async () => {
  await withRoot('academic-notification-target-', async root => withCalendar(root, async (_education, calendar, ctx) => {
    const { localTime } = await import('../lib/reminders.js')
    const now = new Date()
    const event = await calendar.putEvent({ uid: 'future-notification', title: '示例提醒目标', start: localTime(new Date(+now + 7 * 86400000)) })
    let definition, published
    const controller = new AbortController()
    ctx.provide('notifications')
    ctx.set('notifications', { version: 1, register(_ctx, config) {
      definition = config
      return { signal: controller.signal, dispose() {}, withdraw() {}, async publish(input) { published = input; return { delivery: 'desktop', status: 'delivered' } } }
    } })
    await calendar.setPersonal({ scope: 'personal', source: event.source, uid: event.uid, patch: { reminder: { kind: 'fixed', at: localTime(new Date(+now - 60000)) } } })
    for (let i = 0; !definition && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10))
    await calendar.reminderDelivery.refresh()
    assert.ok(published)
    const target = definition.onAction({ target: published.target })
    assert.deepEqual(target.ref, { source: event.source, uid: event.uid })
    assert.equal(definition.onAction({ target: { reminderId: 'unknown' } }), false)
    await calendar.ackReminder({ id: published.target.reminderId })
    assert.equal(definition.onAction({ target: published.target }), false)
  }))
})

test('selected calendar drives annotations and queries; exam weekends and breaks agree', { skip: !runtime }, async () => {
  await withRoot('academic-selection-', async root => withCalendar(root, async (education, calendar) => {
    await education.registerDataset({ id: 'a', label: '校历 A', dataset: DATA })
    await education.registerDataset({ id: 'b', label: '校历 B', dataset: { ...structuredClone(DATA), academicYear: 'other' } })
    assert.equal(calendar.annotationChoices().find(x => x.selected).id, 'a')
    assert.equal(education.query({ from: '2027-01-17' }).days[0].phase.kind, 'examination')
    assert.equal(education.query({ from: '2027-01-18' }).days[0].week, undefined)
    assert.equal((await calendar.annotationsFor({ from: '2027-01-11', to: '2027-01-17' })).spans[0].lastDay, '2027-01-17')
    await calendar.selectAnnotations({ group: 'academic-calendar', id: 'b' })
    assert.equal(education.query({ from: '2026-10-26' }).days[0].academicYear, 'other')
    await calendar.selectAnnotations({ group: 'academic-calendar', id: null })
    assert.deepEqual(await calendar.annotationsFor({}), { weeks: [], spans: [] })
    assert.throws(() => education.query({ from: '2026-10-26' }), /选择/)
    assert.throws(() => education.query({ id: 'a', from: '2026-02-30' }), /日期/)
  }))
})

test('calendar choice survives restart independent of provider order', { skip: !runtime }, async () => {
  await withRoot('academic-restart-', async root => {
    await withCalendar(root, async (education, calendar) => {
      await education.registerDataset({ id: 'a', label: 'A', dataset: DATA })
      await education.registerDataset({ id: 'b', label: 'B', dataset: DATA })
      await calendar.selectAnnotations({ group: 'academic-calendar', id: 'b' })
    })
    await withCalendar(root, async (education, calendar) => {
      await education.registerDataset({ id: 'a', label: 'A', dataset: DATA })
      await education.registerDataset({ id: 'b', label: 'B', dataset: DATA })
      assert.equal(calendar.annotationChoices().find(x => x.selected).id, 'b')
    })
  })
})

test('full concrete timetable snapshots preserve stable instance notes and orphan unknown moves', { skip: !runtime }, async () => {
  await withRoot('academic-timetable-', async root => {
    await withCalendar(root, async (education, calendar) => {
      await education.importTimetable(timetable([{ ...initial, id: 'school-instance-1' }, { ...initial, start: '2026-10-27T09:00', end: '2026-10-27T10:00' }]))
      const originals = calendar.snapshot().events
      const stable = originals.find(x => x.start === initial.start)
      const unknown = originals.find(x => x.start !== initial.start)
      await calendar.putNote({ source: stable.source, uid: stable.uid, text: 'stable note' })
      await calendar.putNote({ source: unknown.source, uid: unknown.uid, text: 'keep for confirmation' })
      const moved = timetable([{ ...initial, id: 'school-instance-1', start: '2026-10-29T11:00', end: '2026-10-29T12:00' }, { ...initial, start: '2026-10-30T09:00', end: '2026-10-30T10:00' }])
      await education.importTimetable(moved)
      await education.importTimetable(moved)
      assert.equal(calendar.snapshot().events.length, 2)
      const occurrence = calendar.occurrences({ from: '2026-10-29', to: '2026-10-29' }).occurrences[0]
      assert.equal(occurrence.uid, stable.uid)
      assert.equal(occurrence.originalStart, initial.start)
      assert.equal(occurrence.extensions['eduwork.academic'].teachingClassCode, 'SYNTHETIC.01')
      assert.ok(calendar.notes({ scope: 'source' }).some(x => x.note?.text === 'stable note'))
      assert.ok(calendar.unlinkedNotes({}).some(x => x.note?.text === 'keep for confirmation'))
      const before = calendar.snapshot()
      await assert.rejects(education.importTimetable(timetable([{ ...initial, end: '2026-10-26T08:00' }])))
      assert.deepEqual(calendar.snapshot(), before)
      await education.importTimetable({ ...timetable([]), account: 'student-b' })
      assert.equal(calendar.snapshot().events.length, 2, 'another account cannot clear the first account')
    })
    await withCalendar(root, async (education, calendar) => {
      assert.equal(education.courses({ account: 'student-a' })[0].dataset.courses[0].meetings.length, 2)
      assert.equal(calendar.snapshot().events.length, 2)
    })
  })
})


test('academic Agent tools expose queries and gate complete timetable imports', { skip: !runtime }, async () => {
  bindRuntime()
  const { apply } = await import('../../../packages/dsh-academic-calendar/lib/tools.js')
  const definitions = new Map()
  let gate
  let imported
  const ctx = {
    on: (name, handler) => { if (name === 'tools/pre-execute') gate = handler },
    tools: { register: tool => definitions.set(tool.name, tool) },
    permissionPresets: { current: () => 'standard' },
    academicCalendar: { query: args => args, courses: () => [], importTimetable: async input => { imported = input; return { meetings: 1 } } },
  }
  apply(ctx)
  assert.equal(definitions.size, 3)
  assert.equal(gate({ name: 'academic_import_timetable' }, () => 'allow').kind, 'deny')
  assert.equal(gate({ name: 'academic_import_timetable', agent: { session: 'x' } }, () => 'allow').kind, 'ask')
  assert.equal(gate({ name: 'academic_calendar_query' }, () => 'allow'), 'allow')
  const query = await definitions.get('academic_calendar_query').execute({ from: '2027-01-17' })
  assert.equal(JSON.parse(query.result).from, '2027-01-17')
  const data = timetable([initial])
  await definitions.get('academic_import_timetable').execute({ institution: data.institution, account: data.account, data: JSON.stringify(data.dataset) })
  assert.deepEqual(imported, data)
})


test('invalid calendar revisions, phase ranges and duplicate activity IDs never register', { skip: !runtime }, async () => {
  await withRoot('academic-invalid-', async root => withCalendar(root, async (education, calendar) => {
    for (const mutate of [data => { data.revision = 0 }, data => {
      delete data.terms[0].phases[0].weeks
      data.terms[0].phases[0].lastDay = '2026-09-01'
    }, data => { data.events = [{ uid: 'same', title: 'a', date: '2026-10-01' }, { uid: 'same', title: 'b', date: '2026-10-02' }] }]) {
      const data = structuredClone(DATA)
      mutate(data)
      await assert.rejects(education.registerDataset({ id: 'invalid', label: 'invalid', dataset: data }))
      assert.deepEqual(calendar.annotationChoices(), [])
      assert.equal(calendar.snapshot().events.length, 0)
    }
    await education.registerDataset({ id: 'valid', label: 'valid', dataset: DATA })
    await assert.rejects(education.registerDataset({ id: 'duplicate-source', label: 'duplicate', dataset: DATA,
      source: { provider: 'academic-calendar', account: 'public', feed: 'valid' } }))
    assert.deepEqual(calendar.annotationChoices().map(choice => choice.id), ['valid'], 'failed registration leaves no dangling selector option')
  }))
})
