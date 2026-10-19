// What one import is allowed to do to the calendar that is already there.
//
// The import path is the one place where a whole source's records are replaced in
// bulk, so it is the one place where a bad read can destroy good data. Everything
// here drives the exported service over a real Cordis scope and the JSON backend
// in a temporary directory: whether the rule holds is a question about what is on
// disk afterwards, not about what a helper returned.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
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

let modules
async function loadCalendarModules() {
  bindRuntime()
  modules ??= (async () => {
    const [cordis, hub, json, domain, plugin] = await Promise.all([
      load('@deepseek-ai/cordis'),
      load('@deepseek-ai/dsh-storage'),
      load('@deepseek-ai/dsh-storage-json'),
      load('@deepseek-ai/dsh-storage-domain'),
      import('../lib/index.js'),
    ])
    return {
      Context: cordis.Context,
      storageHub: hub,
      storageJson: json,
      storageDomain: domain,
      CalendarService: plugin.CalendarService,
    }
  })()
  return await modules
}

test.after(() => hooks?.deregister())

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

async function withCalendar(root, body) {
  const { Context, storageHub, storageJson, storageDomain, CalendarService } = await loadCalendarModules()
  const ctx = new Context()
  await ctx.plugin(storageHub.default ?? storageHub)
  await ctx.plugin(storageJson, { root: join(root, 'storages') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  await ctx.plugin(CalendarService)
  try {
    return await body(ctx.calendar)
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Calendar text from lines, the way a file is written. */
const icsText = (...lines) => lines.flat().join('\r\n') + '\r\n'

/** One ordinary one-off entry. */
function entry(uid, title, start, end) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${title}`,
    `DTSTART:${start.replace(/[-:]/g, '').replace('T', 'T')}00`,
    `DTEND:${end.replace(/[-:]/g, '')}00`,
    'END:VEVENT',
  ]
}

/** A well-formed file holding the given VEVENT lines. */
const calendarFile = (...vevents) => icsText('BEGIN:VCALENDAR', 'VERSION:2.0', ...vevents, 'END:VCALENDAR')

/**
 * One entry whose start is in a timezone this build cannot convert.
 *
 * It is a real `VEVENT` in a real calendar, which is the point: the file is
 * recognisable and most of it may well be readable. What fails is this one entry.
 */
function unreadableEntry(uid, title, start, end) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${title}`,
    `DTSTART;TZID=America/New_York:${start.replace(/[-:]/g, '')}00`,
    `DTEND:${end.replace(/[-:]/g, '')}00`,
    'END:VEVENT',
  ]
}

/** One weekly series, the shape a file uses for a class that repeats. */
function recurring(uid, title, start, end, ...extra) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `SUMMARY:${title}`,
    `DTSTART:${start.replace(/[-:]/g, '')}00`,
    `DTEND:${end.replace(/[-:]/g, '')}00`,
    ...extra,
    'END:VEVENT',
  ]
}

/**
 * One entry that moves a single date of a series: the `RECURRENCE-ID` shape.
 *
 * It is a sibling `VEVENT`, never a nested one — a `VEVENT` inside a `VEVENT` is not
 * a second entry, it is a malformed first one, and a test built that way would be
 * asserting about a file no calendar writes.
 */
function movedDate(uid, title, originalStart, start, end) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `RECURRENCE-ID:${originalStart.replace(/[-:]/g, '')}00`,
    `SUMMARY:${title}`,
    `DTSTART:${start.replace(/[-:]/g, '')}00`,
    `DTEND:${end.replace(/[-:]/g, '')}00`,
    'END:VEVENT',
  ]
}

const SOURCE = 'ics'

test('text that is not a calendar is refused, and the calendar that was there survives', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-garbage-', async root => {
    await withCalendar(root, async calendar => {
      // The reader was handed a file the calendar cannot read — a plain text file
      // dropped on the panel, a truncated download, an HTML error page. Reading it
      // yields no events, which is indistinguishable from "the calendar is now
      // empty" unless something asks whether it was a calendar at all.
      await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(...entry('keep-1', '数据结构', '2026-03-02T08:00', '2026-03-02T09:35')),
      })
      assert.equal(calendar.snapshot().events.length, 1, 'the good import is the starting point')

      await assert.rejects(
        calendar.importIcs({ source: SOURCE, text: '这只是一个普通的文本文件。\n' }),
        /calendar/i,
        'an unreadable file is reported as an error rather than as an empty calendar',
      )

      // The failure has to be inert. This is the whole point: the reader's timetable
      // must still be there after they picked the wrong file.
      assert.deepEqual(
        calendar.snapshot().events.map(event => event.uid),
        ['keep-1'],
        'nothing was removed by the failed import',
      )
      assert.equal(calendar.getEvent({ uid: 'keep-1', source: SOURCE })?.title, '数据结构')
    })
  })
})

test('a valid but empty calendar is not a failure, and is allowed to empty its source', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-empty-', async root => {
    await withCalendar(root, async calendar => {
      // The two cases look identical from the outside — no events came back — and
      // they must not be treated alike. A well-formed calendar with no entries is
      // the reader saying "this source is now empty", and refusing it would make a
      // calendar that cannot be cleared.
      await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(...entry('gone-1', '旧课', '2026-03-02T08:00', '2026-03-02T09:35')),
      })

      const report = await calendar.importIcs({ source: SOURCE, text: calendarFile() })
      assert.deepEqual(report, { events: 0, removedEvents: 1, skipped: [], degraded: [] })
      assert.deepEqual(calendar.snapshot().events, [], 'the empty calendar emptied its source')
    })
  })
})

test('a failed import leaves other sources alone too', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-other-sources-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({
        source: 'ecnu:timetable',
        events: [{ uid: 'MATH101-01', title: '高等数学 A', start: '2026-03-02T08:00' }],
      })
      await calendar.importIcs({
        source: 'ics',
        text: calendarFile(...entry('ics-1', '导入的', '2026-03-02T10:00', '2026-03-02T11:00')),
      })

      await assert.rejects(calendar.importIcs({ source: 'ics', text: 'not a calendar at all' }), /calendar/i)

      assert.deepEqual(
        calendar.snapshot().events.map(event => `${event.source}/${event.uid}`).sort(),
        ['ecnu:timetable/MATH101-01', 'ics/ics-1'],
        'the school timetable and the previous import are both untouched',
      )
    })
  })
})

test('a date that does not exist is refused, not stored as if it did', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-bad-date-', async root => {
    await withCalendar(root, async calendar => {
      // `20260230` matches the shape of a date and is not one. A regex on the
      // digits is not a calendar, and a record that holds it cannot be placed on
      // any week: the arithmetic that expands a series walks forward from it and
      // lands nowhere sensible.
      const report = await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(
          ...entry('good-1', '正常的课', '2026-03-02T08:00', '2026-03-02T09:35'),
          'BEGIN:VEVENT',
          'UID:bad-date-1',
          'SUMMARY:二月三十日',
          'DTSTART:20260230T080000',
          'DTEND:20260230T093500',
          'END:VEVENT',
        ),
      })
      assert.equal(report.events, 1, 'the entry with a real date is still imported')
      assert.equal(report.skipped.length, 1, 'the impossible date is reported rather than stored')
      assert.equal(report.skipped[0].uid, 'bad-date-1')
      assert.deepEqual(
        calendar.snapshot().events.map(event => event.uid),
        ['good-1'],
        'and nothing holding February 30 is on disk',
      )
    })
  })
})

test('a real date is still read, including the leap day', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-leap-day-', async root => {
    await withCalendar(root, async calendar => {
      // The check has to be "does this date exist", not "does this date look
      // unusual": 2028 is a leap year, so its February has a 29th.
      const report = await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(
          ...entry('leap-1', '闰日', '2028-02-29T08:00', '2028-02-29T09:35'),
          ...entry('feb-28', '平日的课', '2026-02-28T08:00', '2026-02-28T09:35'),
        ),
      })
      assert.deepEqual(report.skipped, [])
      assert.deepEqual(
        calendar.snapshot().events.map(event => event.uid).sort(),
        ['feb-28', 'leap-1'],
      )
    })
  })
})

test('an entry that ends before it starts is refused, not stored backwards', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-backwards-', async root => {
    await withCalendar(root, async calendar => {
      const report = await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(
          ...entry('good-2', '正常的课', '2026-03-02T08:00', '2026-03-02T09:35'),
          ...entry('backwards-1', '倒着的课', '2026-03-02T14:00', '2026-03-02T13:00'),
        ),
      })
      assert.equal(report.events, 1, 'only the entry that makes sense is imported')
      assert.equal(report.skipped.length, 1)
      assert.equal(report.skipped[0].uid, 'backwards-1')
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid), ['good-2'])
    })
  })
})

test('a local entry that ends before it starts is refused at the write, whatever the entry point', { skip: !runtime }, async () => {
  await withRoot('eduwork-put-backwards-', async root => {
    await withCalendar(root, async calendar => {
      // The panel's own editor is not the only caller: an agent tool and a school
      // adapter write the same records. A rule that only the importer enforces is
      // a rule that holds until something else writes.
      await assert.rejects(
        calendar.putEvent({ uid: 'x-1', title: '倒着', start: '2026-03-02T14:00', end: '2026-03-02T13:00' }),
        /end|结束/i,
      )
      assert.deepEqual(calendar.snapshot().events, [], 'and nothing was stored')

      // Equal instants are a zero-length entry, which is the same mistake.
      await assert.rejects(
        calendar.putEvent({ uid: 'x-2', title: '零长度', start: '2026-03-02T14:00', end: '2026-03-02T14:00' }),
        /end|结束/i,
      )
      // A whole-day entry has no clock to compare, and an entry with no end is fine.
      await calendar.putEvent({ uid: 'x-3', title: '全天', start: '2026-03-02' })
      await calendar.putEvent({ uid: 'x-4', title: '只有开始', start: '2026-03-02T14:00' })
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid).sort(), ['x-3', 'x-4'])
    })
  })
})

test('an impossible date is refused at the write, not only at the import', { skip: !runtime }, async () => {
  await withRoot('eduwork-put-bad-date-', async root => {
    await withCalendar(root, async calendar => {
      await assert.rejects(
        calendar.putEvent({ uid: 'y-1', title: '二月三十', start: '2026-02-30T08:00' }),
        /date|日期|2026-02-30/i,
      )
      await assert.rejects(
        calendar.putEvent({ uid: 'y-2', title: '二十五点', start: '2026-03-02T25:00' }),
        /date|日期|时间/i,
      )
      assert.deepEqual(calendar.snapshot().events, [])
      await calendar.putEvent({ uid: 'y-3', title: '正常的', start: '2026-03-02T08:00' })
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid), ['y-3'])
    })
  })
})

/** One weekly class, used as the target of concurrent edits. */
const weeklyClass = extra => ({
  uid: 'MATH101-01',
  title: '高等数学 A',
  start: '2026-10-06T09:00',
  end: '2026-10-06T11:35',
  recurrence: { freq: 'weekly', byDay: ['tu'], count: 16 },
  ...extra,
})

test('two per-date changes sent at the same time both survive', { skip: !runtime }, async () => {
  await withRoot('eduwork-concurrent-overrides-', async root => {
    await withCalendar(root, async calendar => {
      // The reader moves two dates of one class in quick succession. Each change is
      // a read-modify-write of the same record: read the overrides, add one, write
      // the whole record back. Started together, both read the same starting state
      // and the second write puts back a record that never heard about the first
      // move, so one of the reader's two changes disappears.
      await calendar.putEvent(weeklyClass())

      const [first, second] = await Promise.all([
        calendar.applyOverride({ uid: 'MATH101-01', date: '2026-10-13', patch: { start: '2026-10-13T14:00' } }),
        calendar.applyOverride({ uid: 'MATH101-01', date: '2026-10-20', patch: { location: '文史楼 202' } }),
      ])
      assert.ok(first && second, 'both calls resolve')

      const stored = calendar.getEvent({ uid: 'MATH101-01' })
      assert.deepEqual(
        (stored.overrides ?? []).map(entry => entry.date),
        ['2026-10-13', '2026-10-20'],
        'both dates the reader changed are recorded',
      )
      assert.equal(
        stored.overrides.find(entry => entry.date === '2026-10-13').start,
        '2026-10-13T14:00',
        'the first move kept its new time',
      )
      assert.equal(
        stored.overrides.find(entry => entry.date === '2026-10-20').location,
        '文史楼 202',
        'and the second kept its new room',
      )
    })
  })
})

test('a cancellation and a move sent at the same time are both kept', { skip: !runtime }, async () => {
  await withRoot('eduwork-concurrent-mixed-', async root => {
    await withCalendar(root, async calendar => {
      // Different operations on one record race the same way, so the queue has to
      // cover the writes rather than one method: a change that only serialises
      // `applyOverride` against itself still loses a cancellation made beside it.
      await calendar.putEvent(weeklyClass())

      await Promise.all([
        calendar.cancelOccurrence({ uid: 'MATH101-01', date: '2026-10-27' }),
        calendar.applyOverride({ uid: 'MATH101-01', date: '2026-10-13', patch: { start: '2026-10-13T14:00' } }),
      ])

      const stored = calendar.getEvent({ uid: 'MATH101-01' })
      assert.deepEqual(stored.exceptions, ['2026-10-27'], 'the cancelled date is recorded')
      assert.deepEqual(
        (stored.overrides ?? []).map(entry => entry.date),
        ['2026-10-13'],
        'and the move made beside it is still there',
      )
    })
  })
})

test('a note and a whole-series change sent at the same time are both kept', { skip: !runtime }, async () => {
  await withRoot('eduwork-concurrent-note-record-', async root => {
    await withCalendar(root, async calendar => {
      // The two layers are separate records but the same reader action, so neither
      // may be lost to the other.
      await calendar.putEvent(weeklyClass())

      await Promise.all([
        calendar.putNote({ source: 'manual', uid: 'MATH101-01', originalStart: '2026-10-06T09:00', text: '带课本' }),
        calendar.applyOverride({ uid: 'MATH101-01', date: '2026-10-13', patch: { start: '2026-10-13T14:00' } }),
      ])

      assert.equal(
        calendar.notes({ scope: 'source', source: 'manual', uid: 'MATH101-01' })[0]?.note.text,
        '带课本',
        'the note is there',
      )
      assert.deepEqual(
        (calendar.getEvent({ uid: 'MATH101-01' }).overrides ?? []).map(entry => entry.date),
        ['2026-10-13'],
        'and so is the moved date',
      )
    })
  })
})

/** A `DTSTART` carrying a timezone name rather than a UTC instant. */
const zonedEntry = (uid, zone, stamp) => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  `SUMMARY:${uid}`,
  `DTSTART;TZID=${zone}:${stamp}`,
  `DTEND;TZID=${zone}:${stamp.slice(0, 9)}${String(Number(stamp.slice(9, 11)) + 1).padStart(2, '0')}0000`,
  'END:VEVENT',
]

test('a time in another zone is refused, not stored as if it were local', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-foreign-zone-', async root => {
    await withCalendar(root, async calendar => {
      // The reader is in one zone and the file names another. Keeping the wall clock
      // and recording the zone name looks harmless and is the worst option: the
      // record then says 09:00 and nothing downstream reads the zone, so the class
      // shows four hours away from when it happens, with no sign that anything was
      // converted. Without a timezone database the honest answer is to refuse it and
      // say which zone could not be read.
      const report = await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(
          ...entry('good-3', '本地的课', '2026-03-02T08:00', '2026-03-02T09:35'),
          ...zonedEntry('foreign-1', 'America/New_York', '20260302T090000'),
        ),
      })
      assert.equal(report.events, 1, 'the entry without a foreign zone is imported')
      assert.equal(report.skipped.length, 1, 'the foreign one is reported')
      assert.equal(report.skipped[0].uid, 'foreign-1')
      assert.match(String(report.skipped[0].reason), /America\/New_York/, 'and the reason names the zone')
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid), ['good-3'])
    })
  })
})

test('a zone the machine itself is in is accepted, because the wall clock is already local', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-own-zone-', async root => {
    await withCalendar(root, async calendar => {
      // The reader's own zone needs no database: the digits in the file are what the
      // clock on the wall says. A defaults-to-UTC test runner would answer `UTC`,
      // which is the same case handled through the UTC path below.
      const own = Intl.DateTimeFormat().resolvedOptions().timeZone
      const report = await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(...zonedEntry('own-1', own, '20260302T090000')),
      })
      assert.deepEqual(report.skipped, [], `the machine's own zone (${own}) is readable`)
      assert.equal(calendar.getEvent({ uid: 'own-1', source: SOURCE })?.start, '2026-03-02T09:00')
    })
  })
})

test('UTC is a zone that needs no database, in either spelling', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-utc-zone-', async root => {
    await withCalendar(root, async calendar => {
      // UTC names an instant unambiguously, so it converts exactly like the `Z`
      // suffix does. Treating it as a foreign zone would refuse the most portable
      // calendars there are, and treating it as local would shift every time in them.
      const report = await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(
          ...zonedEntry('utc-1', 'UTC', '20260302T080000'),
          ...entry('z-1', 'Z 后缀', '2026-03-02T08:00', '2026-03-02T09:00'),
        ),
      })
      assert.deepEqual(report.skipped.map(entry => entry.uid), [], 'both spellings are read')
      const utc = new Date(Date.UTC(2026, 2, 2, 8, 0))
      const pad = value => String(value).padStart(2, '0')
      const expected = `${utc.getFullYear()}-${pad(utc.getMonth() + 1)}-${pad(utc.getDate())}T${pad(utc.getHours())}:${pad(utc.getMinutes())}`
      assert.equal(
        calendar.getEvent({ uid: 'utc-1', source: SOURCE })?.start,
        expected,
        'TZID=UTC converts the same way the Z suffix does',
      )
      assert.equal(
        calendar.getEvent({ uid: 'z-1', source: SOURCE })?.start,
        '2026-03-02T08:00',
        'a value with no zone is wall-clock local time, as before',
      )
    })
  })
})

/** A recurring class, the shape an import of a real timetable has. */
const recurringIcs = () => calendarFile(
  'BEGIN:VEVENT',
  'UID:MATH101-01',
  'SUMMARY:高等数学 A',
  'DTSTART:20261006T090000',
  'DTEND:20261006T113500',
  'RRULE:FREQ=WEEKLY;COUNT=16;BYDAY=TU',
  'LOCATION:数学楼 201',
  'END:VEVENT',
)

test('re-importing the same file keeps the note the user wrote on a class', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-keeps-note-', async root => {
    await withCalendar(root, async calendar => {
      // A repeated import is the normal case: the reader re-drops the same file, or
      // the panel refreshes. Every write in the import replaces the record, so a
      // note stored inside the record would be destroyed by the next refresh. This
      // is what makes it safe for a note to live in its own layer.
      await calendar.importIcs({ source: SOURCE, text: recurringIcs() })
      const occurrence = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      assert.ok(occurrence?.originalStart, 'the occurrence carries the instant its series produced')
      await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', originalStart: occurrence.originalStart, text: '期末要背 P187' })

      const report = await calendar.importIcs({ source: SOURCE, text: recurringIcs() })
      assert.equal(report.events, 1)
      assert.equal(report.removedEvents, 0, 're-importing the same file removes nothing')

      assert.equal(
        calendar.notes({ scope: 'source', source: SOURCE, uid: 'MATH101-01' })[0]?.note.text,
        '期末要背 P187',
        'the note survived the second import',
      )
      assert.deepEqual(
        calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences.map(item => item.start),
        ['2026-10-06T09:00'],
        'and there is still exactly one class, not two',
      )
    })
  })
})

test('re-importing the same file keeps a single date that the user moved', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-keeps-override-', async root => {
    await withCalendar(root, async calendar => {
      // The other half of the reader's own content: a change to one date. It lives on
      // the same record as the series, so a refresh that rewrites the record from the
      // file drops it unless the write is a merge rather than a replacement.
      await calendar.importIcs({ source: SOURCE, text: recurringIcs() })
      const occurrence = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      await calendar.applyOverride({
        uid: 'MATH101-01',
        date: '2026-10-13',
        patch: { start: '2026-10-13T14:00', location: '文史楼 202' },
        source: SOURCE,
      })

      await calendar.importIcs({ source: SOURCE, text: recurringIcs() })

      const moved = calendar.occurrences({ from: '2026-10-13', to: '2026-10-13' }).occurrences
      assert.equal(moved.length, 1)
      assert.equal(moved[0].start, '2026-10-13T14:00', 'the date the reader moved is still moved')
      assert.equal(moved[0].location, '文史楼 202')
      assert.equal(
        calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0].start,
        '2026-10-06T09:00',
        'and the rest of the series still follows the file',
      )
    })
  })
})

test('a school sync that fails does not delete the timetable that was there', { skip: !runtime }, async () => {
  await withRoot('eduwork-sync-failure-', async root => {
    await withCalendar(root, async calendar => {
      // The second entry point, and the one the reader cannot inspect: the panel and
      // an adapter both call it, and a bad response must be as inert as a bad file.
      // An import and a school sync are separate doors into the same store, so the
      // guarantee has to be shown at each of them rather than inferred from the other.
      await calendar.applySource({
        source: 'ecnu:timetable',
        events: [
          { uid: 'MATH101-01', title: '高等数学 A', start: '2026-10-06T09:00', end: '2026-10-06T11:35' },
          { uid: 'PHYS101-01', title: '大学物理', start: '2026-10-07T08:00', end: '2026-10-07T09:35' },
        ],
      })
      assert.equal(calendar.snapshot().events.length, 2, 'the timetable arrived')

      // A response the adapter could not read: no events array at all. Truncated JSON,
      // a login page, an error body — what matters is that it is not a timetable.
      await assert.rejects(
        calendar.applySource({ source: 'ecnu:timetable', events: undefined }),
        /events array/i,
        'an unreadable response is refused rather than read as "no classes"',
      )
      await assert.rejects(calendar.applySource({ source: 'ecnu:timetable', events: {} }), /events array/i)

      assert.deepEqual(
        calendar.snapshot().events.map(event => event.uid).sort(),
        ['MATH101-01', 'PHYS101-01'],
        'and the timetable the reader had is still there',
      )
    })
  })
})

test('a school sync leaves another source and the notes alone', { skip: !runtime }, async () => {
  await withRoot('eduwork-sync-other-source-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({
        source: 'ecnu:timetable',
        events: [{ uid: 'MATH101-01', title: '高等数学 A', start: '2026-10-06T09:00', end: '2026-10-06T11:35' }],
      })
      await calendar.importIcs({
        source: 'ics',
        text: calendarFile(...entry('ics-keep', '导入的', '2026-10-06T14:00', '2026-10-06T15:00')),
      })
      await calendar.applySource({
        source: 'ecnu:postgraduate',
        events: [{ uid: 'MATH101-01', title: '研究生讨论班', start: '2026-10-06T16:00', end: '2026-10-06T17:00' }],
      })
      const occurrence = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences
        .find(item => item.source === 'ecnu:timetable')
      await calendar.putNote({
        source: 'ecnu:timetable', uid: 'MATH101-01', originalStart: occurrence.originalStart, text: '带课本',
      })

      // The school re-sends its timetable. Nothing else may move: the same identifier
      // in the other school source is a different class, and the note is the reader's.
      await calendar.applySource({
        source: 'ecnu:timetable',
        events: [{ uid: 'MATH101-01', title: '高等数学 A', start: '2026-10-06T09:00', end: '2026-10-06T11:35' }],
      })

      assert.deepEqual(
        calendar.snapshot().events.map(event => `${event.source}/${event.uid}`).sort(),
        ['ecnu:postgraduate/MATH101-01', 'ecnu:timetable/MATH101-01', 'ics/ics-keep'],
        'every source kept its own record',
      )
      assert.equal(
        calendar.notes({ scope: 'source', source: 'ecnu:timetable', uid: 'MATH101-01' })[0]?.note.text,
        '带课本',
        'and the note is still on the class it was written on',
      )
    })
  })
})

test('an import that could not read every entry deletes nothing from that source', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-partial-', async root => {
    await withCalendar(root, async calendar => {
      // The file is a calendar, so the reader meant to replace this source — but one
      // entry is in a timezone this build cannot convert. The two readings of the
      // resulting gap are "the school dropped this class" and "we could not read it",
      // and only one of them is safe to act on. A class that is still there and was
      // thrown away is a silent loss; a class that really went away and stayed is
      // visible and correctable. So a partial read deletes nothing.
      await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(...entry('keep-1', '数据结构', '2026-03-02T08:00', '2026-03-02T09:35')),
      })

      const report = await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(...unreadableEntry('keep-1', '数据结构', '2026-03-02T08:00', '2026-03-02T09:35')),
      })

      assert.equal(report.skipped.length, 1, 'the unreadable entry was reported, not quietly dropped')
      assert.equal(report.events, 0, 'nothing could be read out of the file')
      assert.equal(report.removedEvents, 0, 'and nothing was deleted, because the file is not fully known')
      assert.deepEqual(
        calendar.snapshot().events.map(event => event.uid),
        ['keep-1'],
        'the class the reader had is still on the calendar',
      )
      assert.equal(calendar.getEvent({ uid: 'keep-1', source: SOURCE })?.title, '数据结构')
    })
  })
})

test('a fully readable file still removes what it no longer lists', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-clean-replace-', async root => {
    await withCalendar(root, async calendar => {
      // The counterpart of the rule above. Withholding deletion whenever anything was
      // skipped must not become "never delete", or an entry the school cancelled would
      // stay on the calendar forever and the only way out would be deleting it by hand.
      await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(
          ...entry('stay-1', '留下的', '2026-03-02T08:00', '2026-03-02T09:35'),
          ...entry('gone-1', '不再有的', '2026-03-03T08:00', '2026-03-03T09:35'),
        ),
      })

      const report = await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(...entry('stay-1', '留下的', '2026-03-02T08:00', '2026-03-02T09:35')),
      })
      assert.deepEqual(report.skipped, [], 'nothing was left out, so the file is the whole truth')
      assert.equal(report.removedEvents, 1, 'the entry the file no longer lists is removed')
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid), ['stay-1'])
    })
  })
})

test('twice the same file that could not be read leaves the deletion owed, and not done twice', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-partial-twice-', async root => {
    await withCalendar(root, async calendar => {
      // A partial file cannot be acted on, and a second copy of it is no more
      // readable than the first. Neither may delete, and neither may double-count.
      await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(...entry('keep-1', '数据结构', '2026-03-02T08:00', '2026-03-02T09:35')),
      })
      const partial = calendarFile(...unreadableEntry('lost-2', '另一节课', '2026-03-03T10:00', '2026-03-03T11:00'))

      const first = await calendar.importIcs({ source: SOURCE, text: partial })
      const second = await calendar.importIcs({ source: SOURCE, text: partial })

      assert.equal(first.removedEvents, 0)
      assert.equal(second.removedEvents, 0)
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid), ['keep-1'])
    })
  })
})

test('importing a file that changes one date does not undo the dates the user moved or cancelled', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-override-merge-', async root => {
    await withCalendar(root, async calendar => {
      const term = (...extra) => calendarFile(
        recurring('series-1', '公开课', '2026-10-13T09:00', '2026-10-13T10:00', 'RRULE:FREQ=WEEKLY;BYDAY=TU'),
        ...extra,
      )

      await calendar.importIcs({ source: SOURCE, text: term() })
      // What the reader decided on this device: one date moved, another called off.
      await calendar.applyOverride({ uid: 'series-1', source: SOURCE, date: '2026-10-13', patch: { start: '2026-10-13T15:00' } })
      await calendar.cancelOccurrence({ uid: 'series-1', source: SOURCE, date: '2026-10-27' })

      // The file comes back updated: a *third* date moved. It says nothing about the
      // two the reader touched, and it is not the reader's to decide those.
      const report = await calendar.importIcs({
        source: SOURCE,
        text: term(movedDate('series-1', '公开课', '2026-10-20T09:00', '2026-10-20T14:00', '2026-10-20T15:00')),
      })

      assert.deepEqual(report.skipped, [])
      const stored = calendar.getEvent({ uid: 'series-1', source: SOURCE })
      assert.deepEqual(
        stored.overrides?.map(item => item.date).sort(),
        ['2026-10-13', '2026-10-20'],
        'the reader moved the thirteenth, the file moved the twentieth: both survive',
      )
      assert.equal(
        stored.overrides.find(item => item.date === '2026-10-20').start,
        '2026-10-20T14:00',
        'the file\'s own change is applied, not swallowed by the reader\'s',
      )
      assert.deepEqual(stored.exceptions, ['2026-10-27'], 'and the date the reader called off stays called off')
      assert.deepEqual(
        calendar.occurrences({ from: '2026-10-27', to: '2026-10-27' }).occurrences,
        [],
        'so it does not come back on the calendar',
      )
      assert.equal(
        calendar.occurrences({ from: '2026-10-20', to: '2026-10-20' }).occurrences[0]?.start,
        '2026-10-20T14:00',
        'and the moved date happens when the file says',
      )
    })
  })
})

test('the reader\'s own decision wins over the file for the same date', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-override-precedence-', async root => {
    await withCalendar(root, async calendar => {
      const file = (...extra) => calendarFile(
        recurring('series-2', '公开课', '2026-10-13T09:00', '2026-10-13T10:00', 'RRULE:FREQ=WEEKLY;BYDAY=TU'),
        ...extra,
      )

      await calendar.importIcs({ source: SOURCE, text: file() })
      await calendar.applyOverride({ uid: 'series-2', source: SOURCE, date: '2026-10-13', patch: { start: '2026-10-13T15:00' } })

      // Re-importing the same file must be idempotent, and the file — which still says
      // the class is at nine — must not put it back. The same rule has to hold when the
      // file has an opinion of its own about that date, or the two orders of the same
      // two facts would disagree.
      await calendar.importIcs({
        source: SOURCE,
        text: file(movedDate('series-2', '公开课', '2026-10-13T09:00', '2026-10-13T11:00', '2026-10-13T12:00')),
      })

      assert.equal(
        calendar.getEvent({ uid: 'series-2', source: SOURCE }).overrides.find(item => item.date === '2026-10-13').start,
        '2026-10-13T15:00',
        'the date the reader moved stays where the reader put it',
      )
    })
  })
})

test('re-importing a file the reader edited still accepts a correction to the series itself', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-series-correction-', async root => {
    await withCalendar(root, async calendar => {
      // Preserving the reader's per-date decisions must not freeze the series: the file
      // owns the baseline, so a room change or a retitled class still lands.
      await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(recurring('series-3', '公开课', '2026-10-13T09:00', '2026-10-13T10:00',
          'RRULE:FREQ=WEEKLY;BYDAY=TU', 'LOCATION:一教 101')),
      })
      await calendar.applyOverride({ uid: 'series-3', source: SOURCE, date: '2026-10-13', patch: { start: '2026-10-13T15:00' } })

      await calendar.importIcs({
        source: SOURCE,
        text: calendarFile(recurring('series-3', '公开课（换教室）', '2026-10-13T09:00', '2026-10-13T10:00',
          'RRULE:FREQ=WEEKLY;BYDAY=TU', 'LOCATION:二教 305')),
      })

      const stored = calendar.getEvent({ uid: 'series-3', source: SOURCE })
      assert.equal(stored.title, '公开课（换教室）', 'the file still owns the series')
      assert.equal(stored.location, '二教 305')
      assert.equal(stored.overrides.find(item => item.date === '2026-10-13').start, '2026-10-13T15:00', 'and the reader still owns the date')
    })
  })
})

// Export and import is the flow a reader uses to move a calendar between machines, and
// the panel offers it as one button each. Two sources that number their classes the same
// — an undergraduate timetable and a postgraduate one both calling a class `MATH101` — is
// ordinary, not exotic. Driving it end to end is what says whether the file carries enough
// to put the calendar back: the identity is `(source, uid)`, and a file that writes only the
// `uid` cannot tell those two records apart on the way in.
test('exporting and importing a calendar puts back every record, including two sources that share a uid', { skip: !runtime }, async () => {
  await withRoot('eduwork-import-roundtrip-sources-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({
        source: 'ecnu:timetable',
        events: [{
          uid: 'MATH101', title: '高等数学 A', start: '2026-10-06T08:00', end: '2026-10-06T09:35', location: '数学楼 201',
          recurrence: { freq: 'weekly', byDay: ['tu'], count: 8 },
        }],
      })
      await calendar.applySource({
        source: 'ecnu:postgraduate',
        events: [{
          uid: 'MATH101', title: '研究生讨论班', start: '2026-10-06T15:00', end: '2026-10-06T17:00',
          recurrence: { freq: 'weekly', byDay: ['tu'], count: 8 },
        }],
      })
      await calendar.putEvent({ uid: 'PERSONAL1', title: '自己的事', start: '2026-10-06T20:00', end: '2026-10-06T21:00' })
      // Something the reader did by hand, so the round trip has personal content to carry
      // and not only the records themselves.
      await calendar.applyOverride({ uid: 'MATH101', source: 'ecnu:timetable', date: '2026-10-13', patch: { start: '2026-10-13T16:00' } })
      await calendar.cancelOccurrence({ uid: 'MATH101', source: 'ecnu:timetable', date: '2026-10-20' })

      const before = calendar.snapshot().events
      const range = { from: '2026-10-01', to: '2026-11-30' }
      const beforeOccurrences = calendar.occurrences(range).occurrences

      const { text } = calendar.exportIcs({})
      // A fresh calendar in its own root: this is "export here, import there", and
      // reading the file back into the same store would prove nothing about the file.
      const landed = await withRoot('eduwork-import-roundtrip-landed-', async secondRoot =>
        await withCalendar(secondRoot, async second => {
          await second.importIcs({ text, source: 'ics:restored' })
          return second.snapshot().events
        }))
      // Importing a file written here must land the sourced records back under the
      // sources they came from, not all under the one the import was told to use.
      assert.deepEqual(
        landed.map(event => `${event.source}/${event.uid}/${event.title}`).sort(),
        [
          // Two sources that each call a class `MATH101` are two records, and the file
          // has to say which is which or one of them is lost on the way back in.
          'ecnu:postgraduate/MATH101/研究生讨论班',
          'ecnu:timetable/MATH101/高等数学 A',
          // An entry the reader made here belongs to no source, so it comes back under
          // the source the import named — the same thing that happens to a `.ics` from
          // anywhere else, which is the documented meaning of that argument.
          'manual/PERSONAL1/自己的事',
        ],
      )
      assert.equal(
        landed.find(event => event.source === 'ecnu:timetable' && event.uid === 'MATH101')
          .overrides.find(item => item.date === '2026-10-13')?.start,
        '2026-10-13T16:00',
        'the date the reader moved is still on the class they moved',
      )
      assert.deepEqual(
        landed.find(event => event.source === 'ecnu:timetable' && event.uid === 'MATH101').exceptions,
        ['2026-10-20'],
        'and the date they cancelled is still cancelled',
      )
      // Not on the other one: personal content may not leak across two classes that
      // happen to share a number.
      assert.deepEqual(
        landed.find(event => event.source === 'ecnu:postgraduate' && event.uid === 'MATH101').overrides ?? [],
        [],
        'the other source keeps its own record untouched',
      )
      // The end of it: the same classes, at the same times, on the same days. The
      // source is left out of this one on purpose — the entry the reader made belongs
      // to no source and comes back under the import's, which the assertion above
      // states outright; what has to match here is the week the calendar shows.
      const schedule = occurrences => occurrences
        .map(occurrence => `${occurrence.title}@${occurrence.start}-${occurrence.end}`)
        .sort()
      const landedOccurrences = await withRoot('eduwork-import-roundtrip-occurrences-', async thirdRoot =>
        await withCalendar(thirdRoot, async third => {
          await third.importIcs({ text, source: 'ics:restored' })
          return third.occurrences(range).occurrences
        }))
      assert.deepEqual(schedule(landedOccurrences), schedule(beforeOccurrences))
    })
  })
})



test('a personal one-off keeps its note across time edits and a restart', { skip: !runtime }, async () => {
  await withRoot('eduwork-note-anchor-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.putEvent({ uid: 'personal-anchor', title: 'Review', start: '2026-10-06T09:00', end: '2026-10-06T10:00' })
      const first = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      await calendar.putNote({ source: 'manual', uid: first.uid, originalStart: first.originalStart, text: 'Bring notes' })
      await calendar.putEvent({ uid: first.uid, title: 'Review', start: '2026-10-08T11:00', end: '2026-10-08T12:00' })
      const moved = calendar.occurrences({ from: '2026-10-08', to: '2026-10-08' }).occurrences[0]
      assert.equal(moved.originalStart, first.originalStart)
      assert.equal(calendar.notes({ source: 'manual', uid: moved.uid, originalStart: moved.originalStart })[0]?.note.text, 'Bring notes')
      assert.deepEqual(calendar.unlinkedNotes(), [])
    })
    await withCalendar(root, async calendar => {
      const moved = calendar.occurrences({ from: '2026-10-08', to: '2026-10-08' }).occurrences[0]
      assert.equal(calendar.notes({ source: 'manual', uid: moved.uid, originalStart: moved.originalStart })[0]?.note.text, 'Bring notes')
      assert.deepEqual(calendar.unlinkedNotes(), [])
    })
  })
})


test('a refreshed file updates its own move while preserving a real user move', { skip: !runtime }, async () => {
  const movedFile = hour => recurringIcs().replace('END:VCALENDAR', [
    'BEGIN:VEVENT', 'UID:MATH101-01', 'RECURRENCE-ID:20261013T090000', 'SUMMARY:Moved class',
    `DTSTART:20261013T${hour}0000`, `DTEND:20261013T${hour + 1}0000`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'))
  await withRoot('eduwork-source-provenance-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.importIcs({ source: 'updates', text: movedFile(14) })
    })
    await withCalendar(root, async calendar => {
      await calendar.importIcs({ source: 'updates', text: movedFile(15) })
      const read = () => calendar.occurrences({ from: '2026-10-13', to: '2026-10-13' }).occurrences[0]
      assert.equal(read().start, '2026-10-13T15:00')
      await calendar.applyOverride({ source: 'updates', uid: 'MATH101-01', date: '2026-10-13', patch: { start: '2026-10-13T16:00', end: '2026-10-13T17:00' } })
      await calendar.importIcs({ source: 'updates', text: movedFile(17) })
      assert.equal(read().start, '2026-10-13T16:00')
    })
  })
})


test('a backwards occurrence moved to another day is rejected without changing the class', { skip: !runtime }, async () => {
  await withRoot('eduwork-cross-day-validation-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.putEvent(weeklyClass())
      await assert.rejects(calendar.applyOverride({ uid: 'MATH101-01', date: '2026-10-06', patch: {
        start: '2026-10-08T11:00', end: '2026-10-08T10:00',
      } }), /cannot end/)
      assert.equal(calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0].start, '2026-10-06T09:00')
      assert.deepEqual(calendar.occurrences({ from: '2026-10-08', to: '2026-10-08' }).occurrences, [])
    })
  })
})


test('a rejected batch leaves earlier records and their local decisions unchanged', { skip: !runtime }, async () => {
  await withRoot('eduwork-validate-whole-batch-', async root => {
    await withCalendar(root, async calendar => {
      const good = { uid: 'batch-first', source: 'batch', title: 'Original', start: '2026-10-06T09:00', end: '2026-10-06T10:00' }
      await calendar.putEvent(good)
      await assert.rejects(calendar.importSnapshot({ events: [
        { ...good, title: 'Must not be written' },
        { uid: 'batch-second', title: 'Invalid', start: '2026-10-07T09:00', end: '2026-10-06T10:00' },
      ] }, { source: 'batch', replace: true }), /cannot end/)
      assert.equal(calendar.getEvent({ source: 'batch', uid: good.uid }).title, 'Original')
      assert.equal(calendar.snapshot().events.length, 1)
    })
  })
})


test('a source can change just the room of one class', { skip: !runtime }, async () => {
  await withRoot('eduwork-one-field-source-', async root => {
    await withCalendar(root, async calendar => {
      const event = { ...weeklyClass(), location: 'Room A' }
      await calendar.applySource({ source: 'school-room', events: [event] })
      const report = await calendar.applySource({ source: 'school-room', events: [{ ...event, location: 'Room B', movedFrom: event.start }] })
      assert.equal(report.applied, 1)
      assert.equal(calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0].location, 'Room B')
      assert.equal(calendar.occurrences({ from: '2026-10-13', to: '2026-10-13' }).occurrences[0].location, 'Room A')
    })
  })
})


test('an overnight source move keeps its full three-hour duration', { skip: !runtime }, async () => {
  await withRoot('eduwork-overnight-source-', async root => {
    await withCalendar(root, async calendar => {
      const night = { uid: 'night', title: 'Night shift', start: '2026-10-06T22:00', end: '2026-10-07T01:00' }
      await calendar.applySource({ source: 'night', events: [night] })
      await calendar.applySource({ source: 'night', events: [{ ...night, start: '2026-10-06T23:00', movedFrom: night.start }] })
      const occurrence = calendar.occurrences({ from: '2026-10-06', to: '2026-10-07' }).occurrences[0]
      assert.equal(occurrence.start, '2026-10-06T23:00')
      assert.equal(occurrence.end, '2026-10-07T02:00')
    })
  })
})


test('school updates keep an explicit user move on the same occurrence', { skip: !runtime }, async () => {
  await withRoot('eduwork-local-before-school-', async root => {
    await withCalendar(root, async calendar => {
      const event = weeklyClass()
      await calendar.applySource({ source: 'local-first', events: [event] })
      await calendar.applyOverride({ source: 'local-first', uid: event.uid, date: '2026-10-06', patch: { start: '2026-10-06T16:00', end: '2026-10-06T17:00' } })
      await calendar.applySource({ source: 'local-first', events: [{ ...event, start: '2026-10-06T14:00', movedFrom: event.start }] })
      assert.equal(calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0].start, '2026-10-06T16:00')
    })
  })
})


test('a source can restore its own cancelled date without undoing a user cancellation', { skip: !runtime }, async () => {
  await withRoot('eduwork-source-cancel-provenance-', async root => {
    await withCalendar(root, async calendar => {
      const cancelled = recurringIcs().replace('END:VEVENT', 'EXDATE:20261013T090000\r\nEND:VEVENT')
      await calendar.importIcs({ source: 'cancel-owner', text: cancelled })
      assert.deepEqual(calendar.occurrences({ from: '2026-10-13', to: '2026-10-13' }).occurrences, [])
      await calendar.cancelOccurrence({ source: 'cancel-owner', uid: 'MATH101-01', date: '2026-10-20' })
      await calendar.importIcs({ source: 'cancel-owner', text: recurringIcs() })
      assert.equal(calendar.occurrences({ from: '2026-10-13', to: '2026-10-13' }).occurrences.length, 1)
      assert.deepEqual(calendar.occurrences({ from: '2026-10-20', to: '2026-10-20' }).occurrences, [])
    })
  })
})


test('a concurrent source revision and Agent private remark preserve both updates in real storage', { skip: !runtime }, async () => {
  await withRoot('calendar-source-remark-race-', async root => {
    const config = { provider: 'example.edu', account: 'public', feed: 'remark-race' }
    const before = { uid: 'same-class', title: 'Old title', location: 'A', start: '2040-10-09T09:00', description: 'School description' }
    await withCalendar(root, async calendar => {
      const source = calendar.registerSource(config)
      await source.apply({ revision: 1, events: [before] })
      const registered = []
      const { apply } = await import('../lib/tools.js')
      apply({ calendar, tools: { register: tool => registered.push(tool) }, permissionPresets: { current: () => 'standard' }, on: () => {} })
      const update = registered.find(tool => tool.name === 'calendar_update_event')
      const [result] = await Promise.all([
        source.apply({ revision: 2, events: [{ ...before, title: 'New title', location: 'B' }] }),
        update.execute({ source: source.source, uid: before.uid, description: 'Private remark' }),
      ])
      assert.equal(result.state, 'ready')
      const event = calendar.getEvent({ source: source.source, uid: before.uid })
      assert.equal(event.title, 'New title')
      assert.equal(event.location, 'B')
      assert.equal(event.description, 'School description')
      assert.equal(calendar.personalFor({ source: source.source, uid: before.uid }).remark.text, 'Private remark')
    })
    await withCalendar(root, async calendar => {
      const source = calendar.registerSource(config)
      const event = calendar.getEvent({ source: source.source, uid: before.uid })
      assert.equal(event.title, 'New title')
      assert.equal(event.location, 'B')
      assert.equal(calendar.personalFor({ source: source.source, uid: before.uid }).remark.text, 'Private remark')
    })
  })
})

test('Agent tools persist notes against source identity, move a class, read descriptions and remove notes', {skip:!runtime}, async()=> {
  await withRoot('calendar-agent-notes-', async root=> {
    let uid
    await withCalendar(root, async calendar=> {
      const {apply}=await import('../lib/tools.js')
      const registered=[]
      apply({calendar,tools:{register:d=>registered.push(d)},permissionPresets:{current:()=> 'standard'},on:()=>{}})
      const run=async(name,args)=> {
        const t=registered.find(t=>t.name===name); assert.ok(t,`${name} registered`)
        return await t.execute(args,{})
      }
      const created=await run('calendar_create_event',{title:'Agent study',start:'2026-10-19T09:00',end:'2026-10-19T10:00',description:'Bring textbook',repeat:'weekly'})
      uid=created.event.uid
      const before=await run('calendar_list_events',{from:'2026-10-19',to:'2026-10-19'})
      assert.equal(before.events[0].description,'Bring textbook')
      const originalStart=before.events[0].originalStart
      assert.equal(originalStart,'2026-10-19T09:00')
      await run('calendar_put_note',{uid,source:'manual',originalStart,text:'Read chapter 3'})
      await run('calendar_occurrence',{uid,source:'manual',date:'2026-10-19',action:'move',start:'2026-10-21T14:00'})
      const notes=await run('calendar_notes',{uid,source:'manual'})
      assert.equal(notes.notes[0].text,'Read chapter 3')
      assert.equal(notes.notes[0].originalStart,originalStart)
      assert.equal((await run('calendar_notes',{unlinkedOnly:true})).notes.length,0)
      await calendar.applySource({ source: 'Other', events: [{ uid, title: 'Other event', start: originalStart }] })
      await run('calendar_put_note',{uid,source:'Other',originalStart,text:'Other calendar'})
      await run('calendar_remove_note',{uid,source:'Other',originalStart})
      assert.equal((await run('calendar_notes',{uid,source:'manual'})).notes.length,1)
    })
    await withCalendar(root,async calendar=> {
      assert.equal(calendar.notes({source:'manual',uid})[0].note.text,'Read chapter 3')
    })
  })
})


test('a local export reimported under a new file name keeps manual ownership and notes',{skip:!runtime},async()=> {
  await withRoot('calendar-manual-export-source-',async root=>withCalendar(root,async calendar=> {
    await calendar.putEvent({uid:'plain-local',title:'个人',start:'2026-10-19T09:00'})
    await calendar.putNote({source:'manual',uid:'plain-local',originalStart:'2026-10-19T09:00',text:'保留'})
    await calendar.importIcs({text:calendar.exportIcs().text,source:'New file',replace:false})
    assert.equal(calendar.snapshot().events.length,1)
    assert.equal(calendar.snapshot().events[0].source,'manual')
    assert.equal(calendar.notes({source:'manual',uid:'plain-local'})[0].note.text,'保留')
  }))
})

test('identity budget reserves an occurrence note suffix and rejects oversized batches before writing', {skip:!runtime},async()=> {
  await withRoot('calendar-key-budget-',async root=>withCalendar(root,async calendar=> {
    const uid='u'.repeat(104)
    await calendar.putEvent({source:'X',uid,title:'Fits',start:'2026-10-19T09:00'})
    await calendar.putNote({source:'X',uid,originalStart:'2026-10-19T09:00',text:'Fits on disk'})
    const before=calendar.snapshot()
    await assert.rejects(()=>calendar.importSnapshot({events:[
      {source:'X',uid:'good',title:'Must not partially write',start:'2026-10-19T09:00'},
      {source:'X',uid:'u'.repeat(105),title:'Too long',start:'2026-10-19T09:00'},
    ]},{source:'X'}),/key_too_long/)
    assert.deepEqual(calendar.snapshot(),before)
  }))
})


test('invalid explicit ICS time fields are reported, never treated as omitted fields', {skip:!runtime},async()=> {
  await withRoot('calendar-invalid-ics-fields-',async root=>withCalendar(root,async calendar=> {
    for (const field of ['DTEND:20260230T100000','RECURRENCE-ID:bad-date','EXDATE:20260230T090000']) {
      const result=await calendar.importIcs({source:'invalid-fields',text:calendarFile([
        'BEGIN:VEVENT','UID:bad-field','SUMMARY:Must not store','DTSTART:20261019T090000',field,'END:VEVENT',
      ])})
      assert.equal(result.skipped.length,1,field)
      assert.equal(calendar.snapshot().events.length,0,field)
    }
  }))
})


test('malformed calendar structure is rejected before records or notes change', { skip: !runtime }, async t => {
  const empty = calendarFile()
  const cases = [
    ['mismatched END', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:WRONG\r\n'],
    ['unmatched END', empty + 'END:VCALENDAR\r\n'],
    ['unclosed trailing component', empty + 'BEGIN:VEVENT\r\nUID:unfinished\r\n'],
    ['unclosed nested component', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR\r\n'],
    ['invalid content line', 'BEGIN:VCALENDAR\r\ntruncated content\r\nEND:VCALENDAR\r\n'],
    ['property outside a component', empty + 'UID:outside\r\n'],
    ['nested calendar', 'BEGIN:VCALENDAR\r\nBEGIN:VCALENDAR\r\nEND:VCALENDAR\r\nEND:VCALENDAR\r\n'],
    ['multiple calendars', empty + calendarFile(...entry('new', 'Must not write', '2026-10-20T09:00', '2026-10-20T10:00'))],
  ]
  for (const [name, text] of cases) {
    await t.test(name, async () => {
      await withRoot('calendar-malformed-structure-', async root => {
        await withCalendar(root, async calendar => {
          await calendar.putEvent({ uid: 'keep', source: 'structure', title: 'Keep', start: '2026-10-20T09:00' })
          await calendar.putEvent({ uid: 'other', title: 'Other source', start: '2026-10-20T10:00' })
          await calendar.putNote({ source: 'structure', uid: 'keep', originalStart: '2026-10-20T09:00', text: 'Keep my note' })
          const before = calendar.snapshot()
          const notes = calendar.notes()
          await assert.rejects(calendar.importIcs({ source: 'structure', replace: true, text }), /calendar/i)
          assert.deepEqual(calendar.snapshot(), before)
          assert.deepEqual(calendar.notes(), notes)
        })
      })
    })
  }
})


test('all-day ranges are checked at every calendar write entry point', { skip: !runtime }, async t => {
  const backwards = { uid: 'bad-day', title: 'Backwards', start: '2026-10-20', end: '2026-10-19' }
  const writers = [
    ['single write', calendar => calendar.putEvent(backwards)],
    ['snapshot batch', calendar => calendar.importSnapshot({ events: [
      { uid: 'must-not-write', title: 'Valid prefix', start: '2026-10-20' }, backwards,
    ] }, { source: 'batch' })],
    ['source update', calendar => calendar.applySource({ source: 'school', events: [backwards] })],
    ['single occurrence', calendar => calendar.applyOverride({ uid: 'keep', date: '2026-10-27', patch: {
      start: '2026-10-29', end: '2026-10-28',
    } })],
    ['date start with timed end', calendar => calendar.putEvent({ ...backwards, end: '2026-10-21T10:00' })],
    ['timed start with date end', calendar => calendar.putEvent({ ...backwards, start: '2026-10-20T09:00' })],
  ]
  for (const [name, write] of writers) {
    await t.test(name, async () => {
      await withRoot('calendar-all-day-range-', async root => {
        await withCalendar(root, async calendar => {
          await calendar.putEvent({ uid: 'keep', title: 'Keep', start: '2026-10-20', end: '2026-10-21',
            recurrence: { freq: 'weekly', byDay: ['tu'], count: 3 } })
          const before = calendar.snapshot()
          await assert.rejects(write(calendar), /end|format/i)
          assert.deepEqual(calendar.snapshot(), before)
        })
      })
    })
  }
})

test('inclusive all-day ranges still allow one day and expand multiple days', { skip: !runtime }, async () => {
  await withRoot('calendar-all-day-valid-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.putEvent({ uid: 'same-day', title: 'One day', start: '2026-10-20', end: '2026-10-20' })
      await calendar.putEvent({ uid: 'many-days', title: 'Several days', start: '2026-10-20', end: '2026-10-22' })
      assert.deepEqual(calendar.occurrences({ from: '2026-10-22', to: '2026-10-22' }).occurrences.map(row => row.uid), ['many-days'])
      assert.equal(calendar.getEvent({ uid: 'same-day' }).end, '2026-10-20')
    })
  })
})


test('invalid ICS all-day ends are reported without replacing existing data', { skip: !runtime }, async t => {
  const cases = [
    ['end before start', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261019'],
    ['exclusive end equal to start', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261020'],
    ['all-day start with timed end', 'DTSTART;VALUE=DATE:20261020', 'DTEND:20261021T100000'],
    ['timed start with all-day end', 'DTSTART:20261020T090000', 'DTEND;VALUE=DATE:20261021'],
  ]
  for (const [name, start, end] of cases) {
    await t.test(name, async () => {
      await withRoot('calendar-ics-all-day-end-', async root => {
        await withCalendar(root, async calendar => {
          await calendar.putEvent({ source: 'all-day', uid: 'keep', title: 'Original', start: '2026-10-20' })
          const before = calendar.snapshot()
          const report = await calendar.importIcs({ source: 'all-day', replace: true, text: calendarFile(
            'BEGIN:VEVENT', 'UID:keep', 'SUMMARY:Invalid replacement', start, end, 'END:VEVENT',
          ) })
          assert.equal(report.events, 0)
          assert.equal(report.removedEvents, 0)
          assert.equal(report.skipped.length, 1)
          assert.match(report.skipped[0].reason, /DTEND/)
          assert.deepEqual(calendar.snapshot(), before)
        })
      })
    })
  }
})

test('ICS all-day exclusive ends round trip without losing a day', { skip: !runtime }, async () => {
  await withRoot('calendar-ics-all-day-roundtrip-', async root => {
    await withCalendar(root, async calendar => {
      const report = await calendar.importIcs({ source: 'all-day', text: calendarFile(
        'BEGIN:VEVENT', 'UID:one', 'SUMMARY:One day', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261021', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:several', 'SUMMARY:Several days', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261023', 'END:VEVENT',
      ) })
      assert.equal(report.skipped.length, 0)
      assert.equal(calendar.getEvent({ source: 'all-day', uid: 'one' }).end, '2026-10-20')
      assert.equal(calendar.getEvent({ source: 'all-day', uid: 'several' }).end, '2026-10-22')
      const before = calendar.snapshot()
      await calendar.importIcs({ source: 'all-day', text: calendar.exportIcs().text })
      assert.deepEqual(calendar.snapshot(), before)
    })
  })
})


test('sparse edits retain concurrent fields and latest duration across restart', { skip: !runtime }, async () => {
  await withRoot('calendar-sparse-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.putEvent({ uid: 'edit', title: 'Original', start: '2040-10-09T09:00', end: '2040-10-09T10:00', location: 'A' })
      await Promise.all([
        calendar.updateEvent({ uid: 'edit', patch: { title: 'Renamed', end: '2040-10-09T11:00' } }),
        calendar.updateEvent({ uid: 'edit', patch: { start: '2040-10-09T14:00', location: null } }),
      ])
      const event = calendar.getEvent({ uid: 'edit' })
      assert.equal(event.title, 'Renamed')
      assert.equal(event.end, '2040-10-09T16:00')
      assert.equal(event.originalStart, '2040-10-09T09:00')
      assert.equal(event.location, undefined)
      await assert.rejects(calendar.updateEvent({ uid: 'edit', patch: { end: '2040-10-09T12:00' } }))
      await assert.rejects(calendar.updateEvent({ uid: 'edit', patch: { source: 'other' } }))
      await calendar.updateEvent({ uid: 'edit', patch: { description: 'After failure' } })
    })
    await withCalendar(root, async calendar => {
      const event = calendar.getEvent({ uid: 'edit' })
      assert.equal(event.title, 'Renamed')
      assert.equal(event.end, '2040-10-09T16:00')
      assert.equal(event.description, 'After failure')
    })
  })
})

test('remark-only edits never rewrite a source record and survive reverse sync order', { skip: !runtime }, async () => {
  await withRoot('calendar-remark-order-', async root => {
    await withCalendar(root, async calendar => {
      const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'order' })
      const before = { uid: 'class', title: 'Old', start: '2040-10-09T09:00', description: 'School' }
      await source.apply({ revision: 1, events: [before] })
      const ref = { uid: 'class', source: source.source }
      const stored = calendar.getEvent(ref)
      await calendar.updateEvent({ ...ref, patch: { description: 'Private' } })
      assert.strictEqual(calendar.getEvent(ref), stored)
      await Promise.all([
        calendar.updateEvent({ ...ref, patch: { description: null } }),
        source.apply({ revision: 2, events: [{ ...before, title: 'New' }] }),
      ])
      assert.equal(calendar.getEvent(ref).title, 'New')
      assert.equal(calendar.personalFor(ref).remark.text, '')
      await calendar.updateEvent({ ...ref, patch: { location: 'User room', description: 'Mixed' } })
      assert.equal(calendar.getEvent(ref).title, 'New')
      assert.equal(calendar.getEvent(ref).description, 'School')
      assert.equal(calendar.getEvent(ref).location, 'User room')
      assert.equal(calendar.personalFor(ref).remark.text, 'Mixed')
    })
  })
})
