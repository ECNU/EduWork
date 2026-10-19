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
      'snapshot', 'deleteCalendar', 'occurrences', 'importIcs', 'exportIcs', 'applyOverride',
      'removeOverride', 'cancelOccurrence', 'restoreOccurrence', 'deleteEvent', 'putEvent', 'updateEvent',
      'applySource', 'putNote', 'removeNote', 'notes', 'unlinkedNotes', 'changes', 'setPersonal', 'personalFor', 'sourceStatuses', 'reminders', 'ackReminder',
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
      assert.deepEqual(Object.keys(snapshot), ['schemaVersion', 'events', 'needsReview'])
      assert.deepEqual(snapshot.needsReview, [], 'a store in the current shape has nothing to review')
      assert.deepEqual(snapshot.events.map(row => row.uid), ['event-fixture-1', 'event-fixture-2'])
      assert.equal(calendar.getEvent({ uid: 'event-fixture-1' }).title, '示例日程')
      assert.deepEqual(calendar.listEvents({ from: '2026-03-02', to: '2026-03-02T23:59' }).map(row => row.uid), ['event-fixture-1'])
      assert.deepEqual(calendar.listEvents({ from: '2026-03-09' }).map(row => row.uid), [])

      // Importing the same snapshot twice replaces rather than duplicates. The
      // import uses an identifier the user's own record already uses, so what this
      // also pins is that the two are different records: an identifier is unique
      // within its source, and a fixture `event-fixture-1` is not the user's.
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
      assert.equal(calendar.snapshot().events.length, 3, 'a repeated import replaces instead of duplicating')
      assert.equal(
        calendar.snapshot().events.filter(row => row.uid === 'event-fixture-1').length,
        2,
        'the imported record and the user\'s record share an identifier and are still two records',
      )
      assert.equal(calendar.getEvent({ uid: 'event-fixture-1', source: 'fixture' }).source, 'fixture', 'the import stamps its own source')
      assert.equal(calendar.getEvent({ uid: 'event-fixture-1' }).source, 'manual', 'and the user\'s own record is untouched by it')
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
      assert.equal(calendar.getEvent({ uid: 'event-good', source: 'fixture' }), undefined)

      stop()
      assert.ok(changes.length >= 4, `durable writes emit changes, saw ${changes.length}`)
      assert.ok(changes.every(change => ['calendar', 'calendar_personal'].includes(change.domain)), 'only calendar-owned domains are reported')
      // The key names the record's source as well as its identifier, which is what
      // keeps two sources' records of the same identifier apart in one table.
      const { eventKey } = await import('../lib/keys.js')
      assert.ok(
        changes.some(change => change.table === 'events'
          && String(change.key) === eventKey({ source: 'manual', uid: 'event-fixture-1' })),
        `a write reports the record it changed, saw ${changes.map(change => String(change.key)).join(', ')}`,
      )

      assert.deepEqual(await calendar.deleteEvent({ uid: 'event-fixture-2' }), { removed: true })
      assert.deepEqual(await calendar.deleteEvent({ uid: 'event-fixture-2' }), { removed: false }, 'a second delete removes nothing')
      return { events: calendar.snapshot().events.map(row => `${row.source}/${row.uid}`).sort() }
    })
    assert.deepEqual(observed, {
      events: ['fixture/event-fixture-1', 'manual/event-fixture-1'],
    })
    const entries = await readdir(join(root, 'storages'))
    assert.ok(entries.some(name => name.startsWith('calendar')), `the domain document is on disk: ${entries.join(', ')}`)

    // Restart: a fresh scope over the same directory sees what was written, both
    // records of the shared identifier included.
    const reopened = await withCalendar(root, async calendar => ({
      events: calendar.snapshot().events.map(row => `${row.source}/${row.uid}`).sort(),
      fixture: calendar.getEvent({ uid: 'event-fixture-1', source: 'fixture' }).source,
    }))
    assert.deepEqual(reopened, {
      events: ['fixture/event-fixture-1', 'manual/event-fixture-1'],
      fixture: 'fixture',
    })
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
      assert.equal(calendar.getEvent({ uid: 'event-fixture-1' }).overrides.length, 2)
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
      return calendar.getEvent({ uid: 'event-fixture-1' }).overrides.length
    })
    assert.equal(moved, 1)

    // Overrides are ordinary record fields: they survive a restart, and the
    // domain still validates them on the way back in.
    const reopened = await withCalendar(root, calendar => {
      const [occurrence] = calendar.occurrences({ from: '2026-03-30', to: '2026-04-05' }).occurrences
      return { start: occurrence.start, location: occurrence.location, overrides: calendar.getEvent({ uid: 'event-fixture-1' }).overrides.length }
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
      assert.equal(byMethod.get('applyOverride').result.schema.safeParse(calendar.getEvent({ uid, source: 'manual' })).success, true)
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
    // leave the rest of the document — its unit header included — untouched. The
    // record is found by what it holds rather than by its key, because the key
    // names its source as well as its identifier.
    const corrupt = node => {
      if (!node || typeof node !== 'object') return false
      if (Array.isArray(node)) return node.some(corrupt)
      if (node.uid === 'event-fixture-1' && 'title' in node) {
        delete node.title
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

test('a key migration never overwrites the record already at the key it moves to', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-migrate-collision-', async root => {
    // Both keys can be present at once: a version that wrote the new key shipped
    // and this store was then opened by a version that still wrote the old one, or
    // a hand-edited file. The record at the key now in use is the one the calendar
    // has been reading, so it is the newer of the two, and a migration that writes
    // first and asks later replaces it with the stale copy — turning a harmless
    // leftover into lost work.
    const { eventKey } = await import('../lib/keys.js')
    await mkdir(join(root, 'storages'), { recursive: true })
    const record = (uid, title) => ({
      uid, title, start: '2026-03-02T08:00', end: '2026-03-02T09:35', source: 'manual', extensions: {},
    })
    const current = eventKey({ source: 'manual', uid: 'fixture-1' })
    await writeFile(join(root, 'storages', 'calendar.json'), JSON.stringify({
      unit: { name: 'calendar', version: 1 },
      global: null,
      tables: {
        events: {
          // The intermediate shape, which joined the two parts with a NUL.
          'manual\u0000fixture-1': record('fixture-1', '迁移前的旧内容'),
          [current]: record('fixture-1', '迁移后的新内容'),
        },
      },
    }, null, 2))

    const observed = await withCalendar(root, calendar => calendar.getEvent({ uid: 'fixture-1' }).title)
    assert.equal(observed, '迁移后的新内容', 'the record at the current key is what the calendar reads')

    const stored = JSON.parse(await readFile(join(root, 'storages', 'calendar.json'), 'utf8'))
    assert.deepEqual(
      Object.keys(stored.tables.events),
      [current],
      'the stale copy under the old key is dropped rather than left to be migrated again',
    )
    assert.equal(
      stored.tables.events[current].title,
      '迁移后的新内容',
      'and it did not overwrite the live record on its way out',
    )
  })
})

test('an event key and the keys of its annotations come from one encoder', { skip: !runtime }, async () => {
  // Two spellings of "source and identifier" is how a record and the notes attached
  // to it drift apart: one of the two gets amended and the note is silently orphaned.
  const { annotationKey, eventKey } = await import('../lib/keys.js')
  const ref = { source: 'ecnu:timetable', uid: 'course@2026-1' }
  const key = eventKey(ref)
  assert.ok(
    annotationKey({ ...ref, originalStart: '2026-10-06T09:00' }).startsWith(`${key}__`),
    'an annotation of a record is keyed under that record',
  )
  assert.ok(annotationKey(ref).startsWith(`${key}__`), 'including the whole-series annotation')

  await withRoot('eduwork-calendar-key-agreement-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.putEvent({ uid: 'course@2026-1', title: '数据结构', start: '2026-10-06T09:00' })
      await calendar.putNote({ scope: 'source', source: 'manual', uid: 'course@2026-1', text: '记得带书' })

      // Read both documents off disk: agreement has to hold in what was stored, not
      // only in what each module would build on its own.
      const events = JSON.parse(await readFile(join(root, 'storages', 'calendar.json'), 'utf8'))
      assert.deepEqual(
        Object.keys(events.tables.events),
        [eventKey({ source: 'manual', uid: 'course@2026-1' })],
        'the record is stored under the shared encoder',
      )

      // The personal domain is `per-record`, so its annotation is its own file under
      // the table directory, named by the key this module built.
      const key = annotationKey({ source: 'manual', uid: 'course@2026-1' })
      const annotation = JSON.parse(await readFile(
        join(root, 'storages', 'calendar_personal', 'annotations', `${key}.json`), 'utf8',
      ))
      assert.deepEqual(
        Object.keys(annotation),
        ['version', 'record'],
        'the file is one version-stamped record document, which is what `per-record` means',
      )
      assert.equal(annotation.record.note.text, '记得带书', 'the note is stored under the shared encoder')
      assert.ok(
        key.startsWith(`${Object.keys(events.tables.events)[0]}__`),
        'so the note sits under the record, not beside it',
      )
    })
  })
})

test('a legacy record with no source keeps its own key and is reported, not given an invented one', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-migrate-sourceless-', async root => {
    // `source` became a required part of the key while the field itself is optional
    // in the schema an older store was written against, so a record can arrive with
    // no source at all. Writing it under a key built from `undefined` strands it:
    // it is still on disk, but no read and no delete can name it, so the entry can
    // be neither shown nor removed. Its identity is unknown, not "manual".
    await mkdir(join(root, 'storages'), { recursive: true })
    await writeFile(join(root, 'storages', 'calendar.json'), JSON.stringify({
      unit: { name: 'calendar', version: 1 },
      global: null,
      tables: {
        events: {
          'stranded-1': {
            uid: 'stranded-1', title: '来源不明的一条', start: '2026-03-02T08:00', end: '2026-03-02T09:35',
            extensions: {},
          },
        },
      },
    }, null, 2))

    const report = await withCalendar(root, calendar => calendar.snapshot().needsReview)
    assert.equal(report.length, 1, 'the record is surfaced for a human instead of silently stranded')
    assert.equal(report[0].key, 'stranded-1')
    assert.match(String(report[0].reason), /source/)

    const stored = JSON.parse(await readFile(join(root, 'storages', 'calendar.json'), 'utf8'))
    assert.deepEqual(
      Object.keys(stored.tables.events),
      ['stranded-1'],
      'and it is left exactly where it was, so nothing is lost and nothing is invented',
    )
    assert.equal(stored.tables.events['stranded-1'].title, '来源不明的一条', 'the content is untouched')
  })
})

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
    // document: the next write rewrites the whole unit without it. The record also
    // moves to the key the current contract reads, so a calendar written before
    // keys carried a source is still found rather than reopened empty.
    const { eventKey } = await import('../lib/keys.js')
    const stored = JSON.parse(await readFile(join(root, 'storages', 'calendar.json'), 'utf8'))
    assert.equal(stored.unit.version, 1)
    assert.equal('courses' in stored.tables, false)
    assert.ok(stored.tables.events)
    const keys = Object.keys(stored.tables.events)
    assert.deepEqual(
      keys,
      [eventKey({ source: 'manual', uid: 'legacy-fixture-1' })],
      'the legacy key is replaced by the key the same encoder builds for source and identifier',
    )
    assert.equal('courseId' in stored.tables.events[keys[0]], false)
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
      assert.equal(calendar.getEvent({ uid: 'entry-series-1', source: 'ics' }).source, 'ics')

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
      assert.equal(calendar.getEvent({ uid: 'entry-b', source: 'registrar' }).start, '2026-03-03T10:00', 'the new copy of the entry wins')

      // Without `replace` the import only adds and updates: the entry it no
      // longer lists is restored rather than removed.
      const added = await calendar.importIcs({ text: first, source: 'registrar', replace: false })
      assert.deepEqual(added, { events: 2, removedEvents: 0, skipped: [], degraded: [] })
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid).sort(), ['entry-a', 'entry-b', 'entry-manual'])

      // A record the user owns survives every import of that source, notes and
      // all: an import only ever speaks for its own records.
      await calendar.putEvent({ uid: 'entry-manual', title: '自己加的', description: '自己写的备注', start: '2026-03-04T10:00' })
      await calendar.importIcs({ text: second, source: 'registrar' })
      assert.equal(calendar.getEvent({ uid: 'entry-manual' }).description, '自己写的备注')
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

test('a span that points backwards is refused even when the two ends are on different dates', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-span-dates-', async root => {
    await withCalendar(root, async calendar => {
      // Comparing only the clock reading lets this through: 10月6日 10:00 is "after"
      // 10月7日 09:00 as a string of digits, and the record is nonsense. The instant,
      // not the clock, is what has to point forwards.
      await assert.rejects(
        calendar.putEvent({ uid: 'backwards-1', title: '倒着的', start: '2026-10-07T09:00', end: '2026-10-06T10:00' }),
        /end/i,
      )
      assert.deepEqual(calendar.snapshot().events, [], 'and nothing was stored')

      // The overnight case is the one where the clock reading really does go
      // backwards, and it must keep working: the end is on a later date.
      await calendar.putEvent({ uid: 'overnight-1', title: '晚课', start: '2026-10-07T22:00', end: '2026-10-08T01:00' })
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid), ['overnight-1'])

      // A whole-day entry carries no clock, so there is no span to compare.
      await calendar.putEvent({ uid: 'allday-1', title: '全天', start: '2026-10-09' })
      assert.equal(calendar.getEvent({ uid: 'allday-1' })?.start, '2026-10-09')
    })
  })
})

test('a per-date change may not leave the occurrence ending before it starts', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-span-override-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.putEvent({
        uid: 'series-1',
        title: '公开课',
        start: '2026-10-13T09:00',
        end: '2026-10-13T10:00',
        recurrence: { freq: 'weekly', byDay: ['tu'], count: 8 },
      })

      // The record's own span is fine; it is the occurrence the override produces
      // that is not. Checking only the record would let this through.
      await assert.rejects(
        calendar.applyOverride({ uid: 'series-1', date: '2026-10-13', patch: { start: '2026-10-13T11:00', end: '2026-10-13T10:00' } }),
        /end/i,
        'the moved occurrence is what has to make sense, not the series it came from',
      )
      assert.equal(calendar.getEvent({ uid: 'series-1' }).overrides, undefined, 'and no override was stored')

      // Moving only the start is the ordinary case and must keep working: the
      // occurrence inherits the series' length.
      const moved = await calendar.applyOverride({ uid: 'series-1', date: '2026-10-13', patch: { start: '2026-10-13T15:00' } })
      assert.equal(moved.overrides[0].start, '2026-10-13T15:00')
      assert.equal(
        calendar.occurrences({ from: '2026-10-13', to: '2026-10-13' }).occurrences[0].end,
        '2026-10-13T16:00',
        'the occurrence keeps the series length',
      )
    })
  })
})

test('an edit and a delete submitted together do not resurrect the record', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-edit-delete-', async root => {
    await withCalendar(root, async calendar => {
      // Two things the user asked for at the same moment. Whichever order they settle
      // in, the answer cannot be "deleted, and then the old copy came back": a delete
      // that reports success has to mean the record is gone.
      await calendar.putEvent({ uid: 'race-1', title: '旧标题', start: '2026-10-13T09:00', end: '2026-10-13T10:00' })

      const [editResult, deleteResult] = await Promise.allSettled([
        calendar.putEvent({ uid: 'race-1', title: '新标题', start: '2026-10-13T09:00', end: '2026-10-13T10:00' }),
        calendar.deleteEvent({ uid: 'race-1' }),
      ])

      assert.equal(deleteResult.status, 'fulfilled', 'the delete settled')
      const removed = deleteResult.value.removed
      const stillThere = calendar.getEvent({ uid: 'race-1' })
      if (editResult.status === 'rejected') {
        assert.equal(removed, false, 'a delete that removed nothing must say so')
        assert.ok(stillThere, 'and the record the edit wrote is what is left')
      } else {
        assert.equal(removed, true, 'a delete that reports a removal removed something')
        assert.equal(stillThere, undefined, 'so the record is gone, not back from the dead')
      }
    })
  })
})
