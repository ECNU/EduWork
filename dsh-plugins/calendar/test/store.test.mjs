// Host storage of calendar records: a real Cordis scope over the JSON backend,
// so the domain is opened, validated and persisted exactly as in the product.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// `dsh-plugins/*` ships no node_modules: the Runtime pinned by the assembly
// provides storage and zod. Without one these tests skip, like the other
// plugin tests.
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
async function loadCalendarModules() {
  bindRuntime()
  modules ??= (async () => {
    const [cordis, hub, json, domain, typert, plugin, hostFace] = await Promise.all([
      load('@deepseek-ai/cordis'),
      load('@deepseek-ai/dsh-storage'),
      load('@deepseek-ai/dsh-storage-json'),
      load('@deepseek-ai/dsh-storage-domain'),
      load('@deepseek-ai/dsh-typert-protocol'),
      import('../lib/index.js'),
      import('../lib/typert.host.js'),
    ])
    return {
      Context: cordis.Context,
      storageHub: hub,
      storageJson: json,
      storageDomain: domain,
      typert,
      CalendarService: plugin.CalendarService,
      hostFace: hostFace.TYPERT,
    }
  })()
  return await modules
}

test.after(() => hooks?.deregister())

const exampleEvent = {
  uid: 'event-fixture-1',
  title: '示例日程',
  start: '2026-03-02T08:00',
  end: '2026-03-02T09:35',
  location: '示例楼 101',
  recurrence: { freq: 'weekly', count: 16, byDay: ['mo'] },
}

/** Run one body against a started calendar service and tear the scope down. */
async function withCalendar(root, body) {
  const { Context, storageHub, storageJson, storageDomain, typert, CalendarService } = await loadCalendarModules()
  const ctx = new Context()
  try {
    // The hub is its own plugin (default export: the Storage service class);
    // the JSON backend and the domain form are `apply` modules.
    await ctx.plugin(storageHub.default ?? storageHub)
    await ctx.plugin(storageJson, { root: join(root, 'storages') })
    await ctx.plugin(storageDomain, { backend: 'json' })
    await ctx.plugin(CalendarService)
    assert.ok(ctx.calendar, 'the service is reachable as ctx.calendar')
    // Only marked methods may cross to the client half.
    assert.deepEqual(typert.remoteMethods(ctx.calendar).map(marker => marker.method), [
      'snapshot', 'occurrences', 'importIcs', 'exportIcs', 'applyOverride',
      'removeOverride', 'cancelOccurrence', 'restoreOccurrence', 'deleteEvent', 'putEvent',
    ])
    return await body(ctx.calendar)
  } finally {
    await ctx.fiber.dispose()
  }
}

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

test('records round-trip, emit changes, survive a restart and import idempotently', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-store-', async root => {
    const observed = await withCalendar(root, async calendar => {
      const changes = []
      const stop = calendar.onChanged(change => changes.push(change))

      const event = await calendar.putEvent(exampleEvent)
      const second = await calendar.putEvent({ uid: 'event-fixture-2', title: '示例讲座', start: '2026-03-04T19:00' })
      assert.equal(second.source, 'manual', 'a record without a source is stamped manual')
      assert.deepEqual(event.recurrence, { freq: 'weekly', count: 16, byDay: ['mo'] })

      const snapshot = await calendar.snapshot()
      assert.equal(snapshot.schemaVersion, 2)
      assert.deepEqual(Object.keys(snapshot), ['schemaVersion', 'events'])
      assert.deepEqual(snapshot.events.map(row => row.uid), ['event-fixture-1', 'event-fixture-2'])
      assert.equal(calendar.getEvent('event-fixture-1').title, '示例日程')
      assert.deepEqual(calendar.listEvents({ from: '2026-03-02', to: '2026-03-02T23:59' }).map(row => row.uid), ['event-fixture-1'])
      assert.deepEqual(calendar.listEvents({ from: '2026-03-09' }).map(row => row.uid), [])

      const imported = await calendar.importSnapshot(
        { schemaVersion: 2, events: [exampleEvent] },
        { source: 'fixture' },
      )
      assert.deepEqual(imported, { events: 1, removedEvents: 0 })
      const repeated = await calendar.importSnapshot(
        { schemaVersion: 2, events: [exampleEvent] },
        { source: 'fixture' },
      )
      assert.deepEqual(repeated, { events: 1, removedEvents: 0 })
      assert.equal(calendar.snapshot().events.length, 2, 'a repeated import replaces instead of duplicating')
      assert.equal(calendar.getEvent('event-fixture-1').source, 'fixture', 'the import stamps its own source')
      await assert.rejects(calendar.importSnapshot({ note: 'nothing to import' }, {}), /an events array/)

      // A rejected import must not leave half of its records behind: every
      // record is validated before the first write.
      const before = calendar.snapshot().events.length
      await assert.rejects(
        calendar.importSnapshot({
          events: [
            { uid: 'event-good', title: '合法记录', start: '2026-03-05T10:00' },
            { uid: 'event-bad', title: '', start: 'not-a-time' },
          ],
        }, { source: 'fixture' }),
      )
      assert.equal(calendar.snapshot().events.length, before, 'nothing is written when a record is rejected')
      assert.equal(calendar.getEvent('event-good'), undefined)

      stop()
      assert.ok(changes.length >= 4, `durable writes emit changes, saw ${changes.length}`)
      assert.ok(changes.every(change => change.domain === 'calendar'), 'only this domain is reported')
      assert.ok(changes.some(change => change.table === 'events' && String(change.key) === 'event-fixture-1'))

      assert.deepEqual(await calendar.deleteEvent({ uid: 'event-fixture-2' }), { removed: true })
      assert.deepEqual(await calendar.deleteEvent({ uid: 'event-fixture-2' }), { removed: false }, 'a second delete removes nothing')
      return { events: calendar.snapshot().events.map(row => row.uid) }
    })
    assert.deepEqual(observed, { events: ['event-fixture-1'] })

    const entries = await readdir(join(root, 'storages'))
    assert.ok(entries.some(name => name.startsWith('calendar')), `the domain document is on disk: ${entries.join(', ')}`)

    // Restart: a fresh scope over the same directory sees what was written.
    const reopened = await withCalendar(root, async calendar => ({
      events: calendar.snapshot().events.map(row => row.uid),
      source: calendar.getEvent('event-fixture-1').source,
    }))
    assert.deepEqual(reopened, { events: ['event-fixture-1'], source: 'fixture' })
  })
})

test('a range query expands series, honours exceptions and applies overrides', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-store-', async root => {
    const moved = await withCalendar(root, async calendar => {
      await calendar.putEvent({ ...exampleEvent, exceptions: ['2026-03-16'] })

      // Stored semantics stay one record per series...
      assert.deepEqual(calendar.listEvents({ from: '2026-03-09', to: '2026-03-15' }).map(row => row.uid), [])
      // ...while a range query produces the dates the series actually covers.
      assert.deepEqual(
        calendar.occurrences({ from: '2026-03-02', to: '2026-03-08' }).occurrences.map(occurrence => occurrence.occurrenceId),
        ['event-fixture-1#2026-03-02'],
      )
      assert.deepEqual(calendar.occurrences({ from: '2026-03-16', to: '2026-03-22' }).occurrences, [], 'a cancelled date is gone')

      const overridden = await calendar.applyOverride({
        uid: 'event-fixture-1',
        date: '2026-03-23',
        patch: {
          start: '2026-03-27T14:00',
          end: '2026-03-27T15:35',
          location: '示例楼 202',
        },
      })
      assert.deepEqual(overridden.overrides, [{
        date: '2026-03-23', start: '2026-03-27T14:00', end: '2026-03-27T15:35', location: '示例楼 202',
      }])
      const week = calendar.occurrences({ from: '2026-03-23', to: '2026-03-29' }).occurrences
      assert.deepEqual(week.map(occurrence => occurrence.start), ['2026-03-27T14:00'])
      assert.equal(week[0].location, '示例楼 202')
      assert.equal(week[0].overridden, true)
      assert.equal(week[0].occurrenceId, 'event-fixture-1#2026-03-23', 'the key stays the date the series produced')

      // A change on another date keeps the first, and dropping one restores the
      // series for that date only.
      await calendar.applyOverride({ uid: 'event-fixture-1', date: '2026-03-30', patch: { location: '示例楼 303' } })
      assert.equal(calendar.getEvent('event-fixture-1').overrides.length, 2)
      const cleared = await calendar.removeOverride({ uid: 'event-fixture-1', date: '2026-03-23' })
      assert.deepEqual(cleared.overrides, [{ date: '2026-03-30', location: '示例楼 303' }])
      assert.deepEqual(
        calendar.occurrences({ from: '2026-03-23', to: '2026-03-29' }).occurrences.map(occurrence => occurrence.start),
        ['2026-03-23T08:00'],
      )
      await assert.rejects(
        calendar.applyOverride({ uid: 'event-missing', date: '2026-03-23', patch: { location: 'x' } }),
        /no event event-missing/,
      )
      return calendar.getEvent('event-fixture-1').overrides.length
    })
    assert.equal(moved, 1)

    // Overrides are ordinary record fields: they survive a restart, and the
    // domain still validates them on the way back in.
    const reopened = await withCalendar(root, calendar => {
      const [occurrence] = calendar.occurrences({ from: '2026-03-30', to: '2026-04-05' }).occurrences
      return { start: occurrence.start, location: occurrence.location, overrides: calendar.getEvent('event-fixture-1').overrides.length }
    })
    assert.deepEqual(reopened, { start: '2026-03-30T08:00', location: '示例楼 303', overrides: 1 })
  })
})

test('the declared wire schemas parse what the service really returns', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-wire-', async root => {
    await withCalendar(root, async calendar => {
      const { hostFace } = await loadCalendarModules()
      await calendar.putEvent({ ...exampleEvent, exceptions: ['2026-03-16'] })
      await calendar.applyOverride({ uid: 'event-fixture-1', date: '2026-03-09', patch: { location: '示例楼 202' } })

      // Nothing validates a result at runtime, so the contract is only real if
      // the payloads the methods produce are the ones the schemas describe.
      const byMethod = new Map(hostFace.invocations.map(descriptor => [descriptor.method, descriptor]))
      assert.equal(byMethod.get('snapshot').result.schema.safeParse(calendar.snapshot()).success, true, 'a snapshot matches its declared schema')
      const range = { from: '2026-03-09', to: '2026-03-15' }
      assert.equal(byMethod.get('occurrences').parameters[0].codec.schema.safeParse(range).success, true)
      assert.equal(byMethod.get('occurrences').result.schema.safeParse(calendar.occurrences(range)).success, true, 'a week matches its declared schema')

      const importInput = { text: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-imported\r\nSUMMARY:导入的日程\r\nDTSTART:20260320T100000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n' }
      assert.equal(byMethod.get('importIcs').parameters[0].codec.schema.safeParse(importInput).success, true)
      const imported = await calendar.importIcs(importInput)
      assert.equal(byMethod.get('importIcs').result.schema.safeParse(imported).success, true, 'an import report matches its declared schema')
      assert.equal(byMethod.get('exportIcs').result.schema.safeParse(calendar.exportIcs({})).success, true, 'an export matches its declared schema')

      const uid = 'event-fixture-1'
      const date = '2026-03-16'
      const cancelInput = { uid, date }
      assert.equal(byMethod.get('cancelOccurrence').parameters[0].codec.schema.safeParse(cancelInput).success, true)
      assert.equal(byMethod.get('cancelOccurrence').result.schema.safeParse(await calendar.cancelOccurrence(cancelInput)).success, true, 'a cancelled record matches its declared schema')
      assert.equal(byMethod.get('restoreOccurrence').result.schema.safeParse(await calendar.restoreOccurrence(cancelInput)).success, true)
      assert.equal(byMethod.get('applyOverride').result.schema.safeParse(calendar.getEvent(uid)).success, true)
      assert.equal(byMethod.get('removeOverride').result.schema.safeParse(await calendar.removeOverride({ uid, date: '2026-03-09' })).success, true)
      assert.equal(byMethod.get('putEvent').result.schema.safeParse(await calendar.putEvent(exampleEvent)).success, true)
      assert.equal(byMethod.get('putEvent').parameters[0].codec.schema.safeParse({ uid: 'event-fixture-9', title: '缺开始时间' }).success, false, 'a create has to carry what the record needs')
      assert.equal(byMethod.get('deleteEvent').result.schema.safeParse(await calendar.deleteEvent({ uid: 'event-imported' })).success, true)
      assert.equal(byMethod.get('deleteEvent').result.schema.safeParse(await calendar.deleteEvent({ uid: 'event-imported' })).success, true)

      // The parameters reject what the methods do not read.
      assert.equal(byMethod.get('applyOverride').parameters[0].codec.schema.safeParse({ uid, date, patch: { teacher: 'x' } }).success, false)
      assert.equal(byMethod.get('importIcs').parameters[0].codec.schema.safeParse({ text: '' }).success, false)
    })
  })
})

test('a stored record that breaks the schema fails the open instead of being served', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-store-', async root => {
    await withCalendar(root, async calendar => { await calendar.putEvent(exampleEvent) })
    const storages = join(root, 'storages')
    const [document] = (await readdir(storages)).filter(name => name.startsWith('calendar'))
    assert.ok(document, 'the domain document exists')
    const path = join(storages, document)
    const stored = JSON.parse(await readFile(path, 'utf8'))
    // Strip a required field from the event wherever the medium keeps it, and
    // leave the rest of the document — its unit header included — untouched.
    const corrupt = node => {
      if (!node || typeof node !== 'object') return false
      const record = node['event-fixture-1']
      if (record && typeof record === 'object' && 'title' in record) {
        delete record.title
        return true
      }
      return Object.values(node).some(corrupt)
    }
    assert.ok(corrupt(stored), 'the stored event is reachable in the document')
    await writeFile(path, JSON.stringify(stored))
    await assert.rejects(
      withCalendar(root, async () => {}),
      error => /invalid-record/.test(`${error?.code} ${error?.message}`),
      'an unreadable domain must fail the plugin instead of serving bad records',
    )
  })
})

/** Join content lines the way a calendar file is written. */
const calendarText = (...lines) => lines.join('\r\n') + '\r\n'

test('a store written before the record contract changed is folded into it', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-legacy-', async root => {
    // The medium as the earlier contract wrote it: the record still carries the
    // retired `courseId`, and the document still holds the retired course table.
    // Reading it has to be possible — a calendar that refuses to open is worse
    // than one that folds a field away.
    await mkdir(join(root, 'storages'), { recursive: true })
    await writeFile(join(root, 'storages', 'calendar.json'), JSON.stringify({
      unit: { name: 'calendar', version: 1 },
      global: null,
      tables: {
        events: {
          'legacy-fixture-1': {
            uid: 'legacy-fixture-1',
            title: '数据结构',
            start: '2026-03-02T08:00',
            end: '2026-03-02T09:35',
            location: '理科楼 305',
            courseId: 'course-legacy-1',
            recurrence: { freq: 'weekly', count: 16 },
            source: 'manual',
            extensions: {},
          },
        },
        courses: {
          'course-legacy-1': { id: 'course-legacy-1', name: '数据结构', teacher: '张老师', extensions: {} },
        },
      },
    }, null, 2))

    const observed = await withCalendar(root, calendar => {
      const [event] = calendar.snapshot().events
      return {
        uid: event.uid,
        title: event.title,
        retired: 'courseId' in event,
        occurrences: calendar.occurrences({ from: '2026-03-02', to: '2026-03-08' }).occurrences.length,
      }
    })
    assert.deepEqual(observed, { uid: 'legacy-fixture-1', title: '数据结构', retired: false, occurrences: 1 })

    // The fold is durable, and it is also what drops the retired table from the
    // document: the next write rewrites the whole unit without it.
    const stored = JSON.parse(await readFile(join(root, 'storages', 'calendar.json'), 'utf8'))
    assert.equal(stored.unit.version, 1)
    assert.deepEqual(Object.keys(stored.tables), ['events'])
    assert.equal('courseId' in stored.tables.events['legacy-fixture-1'], false)
  })
})

test('a record a caller sends may not carry a retired field', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-retired-', async root => {
    await withCalendar(root, async calendar => {
      await assert.rejects(
        calendar.putEvent({ ...exampleEvent, uid: 'event-fixture-3', courseId: 'course-legacy-1' }),
        /courseId/,
      )
    })
  })
})

test('an imported calendar becomes occurrences a view can render', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-import-', async root => {
    await withCalendar(root, async calendar => {
      const text = calendarText(
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'UID:entry-series-1',
        'SUMMARY:数据结构',
        'DTSTART:20260302T080000',
        'DTEND:20260302T093500',
        'LOCATION:理科楼 305',
        'RRULE:FREQ=WEEKLY;COUNT=16;BYDAY=MO',
        'EXDATE:20260316T080000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:entry-series-1',
        'RECURRENCE-ID:20260309T080000',
        'DTSTART:20260313T100000',
        'LOCATION:文史楼 202',
        'END:VEVENT',
        'END:VCALENDAR',
      )
      const report = await calendar.importIcs({ text })
      assert.deepEqual(report, { events: 1, removedEvents: 0, skipped: [], degraded: [] })
      assert.equal(calendar.getEvent('entry-series-1').source, 'ics')

      // The moved entry lands on the day it moved to, and the cancelled date is
      // gone rather than left as an entry that does not happen.
      assert.deepEqual(
        calendar.occurrences({ from: '2026-03-09', to: '2026-03-15' }).occurrences
          .map(occurrence => [occurrence.occurrenceDate, occurrence.start, occurrence.location, occurrence.overridden]),
        [['2026-03-09', '2026-03-13T10:00', '文史楼 202', true]],
      )
      assert.deepEqual(calendar.occurrences({ from: '2026-03-16', to: '2026-03-22' }).occurrences, [])

      // Exporting and importing again is a round trip: nothing is duplicated and
      // nothing is dropped.
      const { text: exported } = calendar.exportIcs({})
      assert.match(exported, /^BEGIN:VCALENDAR\r\n/)
      const again = await calendar.importIcs({ text: exported })
      assert.deepEqual(again, { events: 1, removedEvents: 0, skipped: [], degraded: [] })
      assert.equal(calendar.snapshot().events.length, 1)
      assert.deepEqual(
        calendar.occurrences({ from: '2026-03-09', to: '2026-03-15' }).occurrences
          .map(occurrence => [occurrence.occurrenceDate, occurrence.start, occurrence.location]),
        [['2026-03-09', '2026-03-13T10:00', '文史楼 202']],
      )
      return undefined
    })
  })
})

test('re-importing a source replaces that source and leaves the rest alone', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-replace-', async root => {
    await withCalendar(root, async calendar => {
      const entry = (uid, title, start) => calendarText(
        'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART:${start}`, 'END:VEVENT',
      )
      const first = calendarText(
        'BEGIN:VCALENDAR', 'VERSION:2.0',
        ...entry('entry-a', '第一条日程', '20260302T080000').split('\r\n').filter(Boolean),
        ...entry('entry-b', '第二条日程', '20260303T080000').split('\r\n').filter(Boolean),
        'END:VCALENDAR',
      )
      assert.deepEqual(await calendar.importIcs({ text: first, source: 'registrar' }), {
        events: 2, removedEvents: 0, skipped: [], degraded: [],
      })
      // A record the user owns is never in the scope of an import.
      await calendar.putEvent({ uid: 'entry-manual', title: '自己加的', start: '2026-03-04T10:00' })

      const second = calendarText(
        'BEGIN:VCALENDAR', 'VERSION:2.0',
        ...entry('entry-b', '第二条日程', '20260303T100000').split('\r\n').filter(Boolean),
        'END:VCALENDAR',
      )
      const replaced = await calendar.importIcs({ text: second, source: 'registrar' })
      assert.deepEqual(replaced, { events: 1, removedEvents: 1, skipped: [], degraded: [] })
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid).sort(), ['entry-b', 'entry-manual'])
      assert.equal(calendar.getEvent('entry-b').start, '2026-03-03T10:00', 'the new copy of the entry wins')

      // Without `replace` the import only adds and updates: the entry it no
      // longer lists is restored rather than removed.
      const added = await calendar.importIcs({ text: first, source: 'registrar', replace: false })
      assert.deepEqual(added, { events: 2, removedEvents: 0, skipped: [], degraded: [] })
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid).sort(), ['entry-a', 'entry-b', 'entry-manual'])

      // A record the user owns survives every import of that source, notes and
      // all: an import only ever speaks for its own records.
      await calendar.putEvent({ uid: 'entry-manual', title: '自己加的', description: '自己写的备注', start: '2026-03-04T10:00' })
      await calendar.importIcs({ text: second, source: 'registrar' })
      assert.equal(calendar.getEvent('entry-manual').description, '自己写的备注')
      return undefined
    })
  })
})

test('a cancelled date can be put back, and only a series can be cancelled', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-cancel-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.putEvent(exampleEvent)
      await calendar.applyOverride({
        uid: 'event-fixture-1',
        date: '2026-03-16',
        patch: { start: '2026-03-20T14:00', location: '示例楼 202' },
      })
      // Cancelling a date that had been moved takes the move with it: nothing is
      // left to move.
      const cancelled = await calendar.cancelOccurrence({ uid: 'event-fixture-1', date: '2026-03-16' })
      assert.deepEqual(cancelled.exceptions, ['2026-03-16'])
      assert.equal(cancelled.overrides, undefined)
      assert.deepEqual(calendar.occurrences({ from: '2026-03-16', to: '2026-03-22' }).occurrences, [])

      const restored = await calendar.restoreOccurrence({ uid: 'event-fixture-1', date: '2026-03-16' })
      assert.equal(restored.exceptions, undefined)
      assert.deepEqual(
        calendar.occurrences({ from: '2026-03-16', to: '2026-03-22' }).occurrences.map(occurrence => occurrence.start),
        ['2026-03-16T08:00'],
      )

      await calendar.putEvent({ uid: 'event-once', title: '一次性讲座', start: '2026-03-05T19:00' })
      await assert.rejects(
        calendar.cancelOccurrence({ uid: 'event-once', date: '2026-03-05' }),
        /does not repeat/,
      )
      await assert.rejects(calendar.restoreOccurrence({ uid: 'event-missing', date: '2026-03-16' }), /no event event-missing/)
      return undefined
    })
  })
})
