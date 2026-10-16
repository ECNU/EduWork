// School sync keeps the user's own content.
//
// These tests drive the calendar service the way a school adapter does: a
// timetable arrives, the user writes personal content against one occurrence,
// and the timetable arrives again with a change. What must hold is that the
// user's content is still attached to the same class afterwards — and that when
// the data cannot say which class was meant, the service says so instead of
// guessing an attachment.
//
// Everything below goes through the exported service over a real Cordis scope
// and the JSON backend in a temporary directory. Nothing calls a private helper.
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

/** Run one body against a started calendar service and tear the scope down. */
async function withCalendar(root, body) {
  const { Context, storageHub, storageJson, storageDomain, CalendarService } = await loadCalendarModules()
  const ctx = new Context()
  try {
    await ctx.plugin(storageHub.default ?? storageHub)
    await ctx.plugin(storageJson, { root: join(root, 'storages') })
    await ctx.plugin(storageDomain, { backend: 'json' })
    await ctx.plugin(CalendarService)
    assert.ok(ctx.calendar, 'the service is reachable as ctx.calendar')
    return await body(ctx.calendar)
  } finally {
    await ctx.fiber.dispose()
  }
}

const SOURCE = 'ecnu:timetable'
/**
 * A weekly class on Tuesdays, the shape a school adapter delivers.
 *
 * The length is what a timetable carries — the end follows the start by the same
 * amount however the class is placed — so moving `start` moves `end` with it. A fixed
 * clock reading for the end would make a class placed at 15:00 end at 11:35, which is
 * not a timetable any school sends and not a span the calendar can store.
 */
const classOn = (start, extra = {}) => ({
  uid: 'MATH101-01',
  title: '高等数学 A',
  start,
  end: endsAt(start, 155),
  location: '数学楼 201',
  recurrence: { freq: 'weekly', byDay: ['tu'], count: 16 },
  ...extra,
})

/** `start` plus a length in minutes, as a local time string. */
function endsAt(start, minutes) {
  const clock = start.slice(11, 16)
  const total = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5)) + minutes
  const date = new Date(`${start.slice(0, 10)}T00:00:00`)
  date.setDate(date.getDate() + Math.floor(total / 1440))
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(Math.floor((total % 1440) / 60))}:${pad(total % 60)}`
}

test('a rescheduled class keeps the note the user wrote on it', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-reschedule-', async root => {
    await withCalendar(root, async calendar => {
      // 1. The school timetable arrives for the first time.
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })

      const before = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences
      assert.equal(before.length, 1, 'the class shows up on the day it was scheduled')
      assert.equal(before[0].start, '2026-10-06T09:00')
      const originalStart = before[0].originalStart
      assert.ok(originalStart, 'an occurrence carries the instant the series produced, which is its identity')

      // 2. The user writes a note on that one class.
      await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', originalStart, text: '期末要背 P187' })

      // 3. The school moves that class later the same day, and to a different
      //    room. Both are changes to that one class, so both must land on it —
      //    a change that only lands the new time is a silent data loss.
      await calendar.applySource({
        source: SOURCE,
        events: [classOn('2026-10-06T14:00', { movedFrom: originalStart, location: '数学楼 305' })],
      })

      // 4. The time is the school's new one...
      const after = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences
      assert.equal(after.length, 1, 'the class is still one occurrence, not a moved one plus a leftover')
      assert.equal(after[0].start, '2026-10-06T14:00', 'the occurrence follows the school')
      assert.equal(
        after[0].end,
        '2026-10-06T16:35',
        'the end moves with the start: an override that carried the old end would leave the class finishing before it began',
      )
      assert.ok(after[0].end > after[0].start, 'a class never ends before it starts')
      assert.equal(after[0].location, '数学楼 305', 'and so does the room the school changed at the same time')
      assert.equal(after[0].originalStart, originalStart, 'its identity does not change when its time does')
      assert.equal(
        calendar.getEvent({ uid: 'MATH101-01', source: SOURCE }).start,
        originalStart,
        'the stored record is still the original timetable, which is what the note is anchored to',
      )
      assert.equal(
        calendar.getEvent({ uid: 'MATH101-01', source: SOURCE }).location,
        '数学楼 201',
        'the stored baseline is not overwritten by a change to one class',
      )

      // ...and the note is still on it.
      const notes = calendar.notes({ scope: 'source', source: SOURCE, uid: 'MATH101-01', originalStart })
      assert.equal(notes.length, 1, 'the note is still attached after the reschedule')
      assert.equal(notes[0].note.text, '期末要背 P187', 'and it is the same note, with its text intact')
      assert.deepEqual(calendar.unlinkedNotes(), [], 'nothing lost its anchor')
    })
  })
})

test('a change the data cannot attribute is refused, not guessed', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-unattributable-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      const scheduled = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', originalStart: scheduled.originalStart, text: '期末要背 P187' })

      // The same class arrives at a new time with nothing saying which class it
      // used to be. Two readings are possible — the whole series moved, or one
      // occurrence did — and they attach the user's note to different classes.
      // Guessing either way would look like success and silently move the note,
      // so nothing may change and the entry has to be reported.
      const report = await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T14:00')] })
      assert.deepEqual(report.unattributable, [{ uid: 'MATH101-01', reason: 'anchor_changed_without_movedFrom' }])
      assert.equal(report.applied, 0, 'an unattributable entry is not applied')

      const after = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences
      assert.equal(after[0].start, '2026-10-06T09:00', 'the stored timetable is untouched by a change that cannot be attributed')
      assert.equal(calendar.getEvent({ uid: 'MATH101-01', source: SOURCE }).start, '2026-10-06T09:00', 'the anchor is still the original timetable')
      assert.equal(calendar.notes({ source: SOURCE, uid: 'MATH101-01' }).length, 1, 'and the note is still there')
      assert.deepEqual(calendar.unlinkedNotes(), [], 'still linked: nothing moved, so nothing was orphaned')
    })
  })
})

test('a changed class time moves the end with it, so the class cannot end before it starts', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-duration-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      const original = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      assert.equal(original.end, '2026-10-06T11:35', 'the class runs 09:00 to 11:35')

      await calendar.applySource({
        source: SOURCE,
        events: [classOn('2026-10-06T14:00', { movedFrom: original.originalStart })],
      })

      // What a class inherits from its series is its length, not a clock reading.
      // Inheriting `11:35` onto a 14:00 start would report a class that finishes
      // an hour and a half before it begins.
      const moved = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      assert.equal(moved.start, '2026-10-06T14:00')
      assert.equal(moved.end, '2026-10-06T16:35', 'the same two and a half hours, later in the day')
      assert.ok(moved.end > moved.start)
    })
  })
})

test('a class moved to another day keeps its note, and stops being on the old day', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-crossday-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      const tuesday = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', originalStart: tuesday.originalStart, text: '期末要背 P187' })

      // The school moves this one class from Tuesday to the Thursday of the same
      // week. The class keeps its identity — it is the same class, on another
      // day — so the note has to follow it.
      await calendar.applySource({
        source: SOURCE,
        events: [classOn('2026-10-08T09:00', { movedFrom: tuesday.originalStart })],
      })

      // A single scan across the week is what catches a move that added the
      // class on the new day without removing it from the old one.
      const week = calendar.occurrences({ from: '2026-10-05', to: '2026-10-11' }).occurrences
      const onTuesday = week.filter(occurrence => occurrence.start.startsWith('2026-10-06'))
      const onThursday = week.filter(occurrence => occurrence.start.startsWith('2026-10-08'))
      assert.deepEqual(onTuesday, [], 'the class is gone from the day it was moved off')
      assert.equal(onThursday.length, 1, 'and it is on the day it was moved to')
      assert.equal(onThursday[0].start, '2026-10-08T09:00')
      assert.equal(onThursday[0].originalStart, tuesday.originalStart, 'its identity is still the instant the timetable first produced')

      // The note is found by that identity, which the moved occurrence still carries.
      const notes = calendar.notes({ scope: 'source', source: SOURCE, uid: 'MATH101-01', originalStart: tuesday.originalStart })
      assert.equal(notes.length, 1, 'the note followed the class to the other day')
      assert.equal(notes[0].note.text, '期末要背 P187')
      assert.deepEqual(calendar.unlinkedNotes(), [], 'and it never lost its anchor')

      // The next week is generated from the original timetable, so the move was
      // one class and not the series.
      const nextWeek = calendar.occurrences({ from: '2026-10-12', to: '2026-10-18' }).occurrences
      const nextTuesday = nextWeek.filter(occurrence => occurrence.start.startsWith('2026-10-13'))
      assert.equal(nextTuesday.length, 1, 'the following week is still on the original weekday')
      assert.notEqual(nextTuesday[0].originalStart, tuesday.originalStart, 'as a different occurrence with its own identity')
      assert.equal(
        calendar.notes({ scope: 'source', source: SOURCE, uid: 'MATH101-01' }).length,
        1,
        'the next week did not inherit the note written on the moved class',
      )
    })
  })
})

test('the same identifier from two sources stays two classes', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-two-sources-', async root => {
    await withCalendar(root, async calendar => {
      // Two timetables can number their courses independently, so the same `uid`
      // from two sources is not the same class. Storing by identifier alone would
      // let the second source overwrite the first.
      await calendar.applySource({
        source: 'ecnu:timetable',
        events: [classOn('2026-10-06T09:00', { title: '高等数学 A' })],
      })
      await calendar.applySource({
        source: 'ecnu:postgraduate',
        events: [classOn('2026-10-06T15:00', { title: '研究生讨论班', location: '理科楼 501' })],
      })

      const week = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences
      assert.equal(week.length, 2, 'both sources contribute a class on that day')
      const bySource = new Map(week.map(occurrence => [occurrence.source, occurrence]))
      assert.equal(bySource.size, 2, 'and each class still belongs to the source that sent it')

      assert.equal(bySource.get('ecnu:timetable').title, '高等数学 A', 'the first source kept its own title')
      assert.equal(bySource.get('ecnu:timetable').start, '2026-10-06T09:00')
      assert.equal(bySource.get('ecnu:postgraduate').title, '研究生讨论班', 'the second source keeps its own title')
      assert.equal(bySource.get('ecnu:postgraduate').start, '2026-10-06T15:00')

      // Each record's declared source has to agree with the class it describes,
      // which is what a wrong `source` field on a merged record would break.
      for (const occurrence of week) {
        assert.ok(
          occurrence.title === '高等数学 A' ? occurrence.source === 'ecnu:timetable' : occurrence.source === 'ecnu:postgraduate',
          `the record for ${occurrence.title} says it came from ${occurrence.source}`,
        )
      }

      // A note belongs to a class, so it must not be reachable from the other
      // source's class of the same identifier.
      const first = bySource.get('ecnu:timetable')
      await calendar.putNote({
        source: 'ecnu:timetable', uid: 'MATH101-01', originalStart: first.originalStart, text: '期末要背 P187',
      })
      assert.equal(
        calendar.notes({ scope: 'source', source: 'ecnu:postgraduate', uid: 'MATH101-01' }).length,
        0,
        'the note is not attached to the same identifier in another source',
      )
    })
  })
})

test('changing or deleting one class never reaches another source\'s class of the same identifier', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-operate-by-source-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: 'ecnu:timetable', events: [classOn('2026-10-06T09:00')] })
      const classOccurrence = calendar
        .occurrences({ from: '2026-10-06', to: '2026-10-06' })
        .occurrences.find(occurrence => occurrence.source === 'ecnu:timetable')

      // What the panel used to send: the identifier alone. The user's own layer is
      // the default, so an operation on an imported class has to fail loudly rather
      // than quietly do nothing -- a silently dropped edit looks like a broken UI.
      await assert.rejects(
        calendar.applyOverride({
          uid: 'MATH101-01', date: classOccurrence.occurrenceDate, patch: { start: '2026-10-06T14:00' },
        }),
        /no event MATH101-01/,
        'an operation that names no source cannot reach an imported class',
      )
      assert.deepEqual(
        await calendar.deleteEvent({ uid: 'MATH101-01' }),
        { removed: false },
        'and deleting it by identifier alone removes nothing',
      )
      assert.equal(
        calendar.getEvent({ uid: 'MATH101-01', source: 'ecnu:timetable' })?.title,
        '高等数学 A',
        'the imported class is still there after both attempts',
      )

      // Naming the source is what makes the operation land.
      const rescheduled = await calendar.applyOverride({
        uid: 'MATH101-01',
        date: classOccurrence.occurrenceDate,
        patch: { start: '2026-10-06T14:00' },
        source: 'ecnu:timetable',
      })
      assert.equal(rescheduled.source, 'ecnu:timetable', 'the override landed on the class')
      assert.equal(
        calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' })
          .occurrences.find(occurrence => occurrence.source === 'ecnu:timetable').start,
        '2026-10-06T14:00',
      )

      // With a personal entry of the same identifier present, the wrong-source
      // operation is not merely a no-op: it reaches the other record. This is the
      // case that loses data, so both directions are checked.
      await calendar.putEvent({ uid: 'MATH101-01', title: '自己加的复习', start: '2026-10-06T19:00' })
      await calendar.deleteEvent({ uid: 'MATH101-01' })
      assert.equal(
        calendar.getEvent({ uid: 'MATH101-01' }),
        undefined,
        'deleting by identifier alone reaches the user\'s own record of that identifier',
      )
      assert.equal(
        calendar.getEvent({ uid: 'MATH101-01', source: 'ecnu:timetable' })?.title,
        '高等数学 A',
        'and the imported class is what survives, which is the record that was meant to go',
      )

      assert.deepEqual(
        await calendar.deleteEvent({ uid: 'MATH101-01', source: 'ecnu:timetable' }),
        { removed: true },
      )
      assert.equal(calendar.getEvent({ uid: 'MATH101-01', source: 'ecnu:timetable' }), undefined)
    })
  })
})

test('cancelling one class never reaches another source\'s class of the same identifier', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-cancel-by-source-', async root => {
    await withCalendar(root, async calendar => {
      // Both records repeat, so a per-date cancellation is meaningful for either
      // and the source is the only thing that says which one is meant.
      await calendar.putEvent({
        uid: 'MATH101-01',
        title: '自己加的每周复习',
        start: '2026-10-06T19:00',
        recurrence: { freq: 'weekly', byDay: ['tu'], count: 8 },
      })
      await calendar.applySource({ source: 'ecnu:timetable', events: [classOn('2026-10-06T09:00')] })

      const cancelled = await calendar.cancelOccurrence({
        uid: 'MATH101-01', date: '2026-10-06', source: 'ecnu:timetable',
      })
      assert.deepEqual(cancelled.exceptions, ['2026-10-06'], 'the class is the record that was cancelled')
      assert.equal(
        calendar.getEvent({ uid: 'MATH101-01' }).exceptions,
        undefined,
        'the user\'s own repeating entry is not cancelled with it',
      )

      const restored = await calendar.restoreOccurrence({
        uid: 'MATH101-01', date: '2026-10-06', source: 'ecnu:timetable',
      })
      assert.equal(restored.exceptions, undefined, 'and it can be put back on the class alone')
      assert.equal(calendar.getEvent({ uid: 'MATH101-01' }).exceptions, undefined)
    })
  })
})

test('a class moved and then cancelled is gone, not still on the moved day', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-move-then-cancel-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      const scheduled = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]

      // The school first moves the class later the same day.
      await calendar.applySource({
        source: SOURCE,
        events: [classOn('2026-10-06T14:00', { movedFrom: scheduled.originalStart })],
      })
      assert.equal(
        calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]?.start,
        '2026-10-06T14:00',
        'the class moved',
      )

      // Then it cancels that same class. A cancellation means the class does not
      // happen, so it must not survive on the day it had been moved to.
      await calendar.applySource({
        source: SOURCE,
        events: [classOn('2026-10-06T14:00', { movedFrom: scheduled.originalStart, cancelledDates: ['2026-10-06'] })],
      })

      assert.deepEqual(
        calendar.occurrences({ from: '2026-10-05', to: '2026-10-11' }).occurrences,
        [],
        'the cancelled class is gone from the whole week',
      )
      assert.deepEqual(
        calendar.getEvent({ uid: 'MATH101-01', source: SOURCE }).exceptions,
        ['2026-10-06'],
        'the cancellation is recorded',
      )
    })
  })
})

test('a note carries the instant it belongs to, and nothing else is accepted', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-note-shape-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      const scheduled = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      const ref = { source: SOURCE, uid: 'MATH101-01', originalStart: scheduled.originalStart }

      await calendar.putNote({ ...ref, text: '期末要背 P187' })
      const [stored] = calendar.notes({ scope: 'source', ...ref })
      assert.equal(stored.note.text, '期末要背 P187')

      // The identity of the class a note belongs to is the instant the series
      // produced, so a value that is not a time is not a different identity — it
      // is not an identity at all, and accepting it would store a note that
      // nothing could ever look up again.
      await assert.rejects(
        calendar.putNote({ ...ref, originalStart: 'not-a-time', text: '写错了' }),
        error => /originalStart|expected YYYY/.test(error?.message ?? ''),
        'a malformed instant is refused rather than stored',
      )
      assert.equal(calendar.notes({ scope: 'source', ...ref }).length, 1, 'and the good note is still the only one')

      // A whole-series note has no instant, and it is a second annotation rather
      // than the same one defaulted: asking by instant finds one, asking by the
      // series finds both.
      await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', text: '整门课都要背' })
      assert.equal(calendar.notes({ scope: 'source', ...ref }).length, 1, 'the occurrence note is asked for by its instant')
      assert.equal(calendar.notes({ scope: 'source', source: SOURCE, uid: 'MATH101-01' }).length, 2, 'and the series carries both')
    })
  })
})

test('a changed class pattern is refused instead of rewriting the timetable under the notes', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-recurrence-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      const tuesday = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', originalStart: tuesday.originalStart, text: '期末要背 P187' })

      // The school moves the course from Tuesdays to Wednesdays. The start keeps
      // its clock reading, so a check that only compared `start` would see nothing
      // wrong and quietly swap the rule — leaving the anchor on a day the series
      // no longer produces and the user's note attached to nothing.
      const report = await calendar.applySource({
        source: SOURCE,
        events: [classOn('2026-10-06T09:00', { recurrence: { freq: 'weekly', byDay: ['we'], count: 16 } })],
      })
      assert.deepEqual(report.unattributable, [{ uid: 'MATH101-01', reason: 'recurrence_changed' }])
      assert.deepEqual(calendar.getEvent({ uid: 'MATH101-01', source: SOURCE }).recurrence.byDay, ['tu'], 'the original timetable is kept')
      assert.equal(calendar.occurrences({ from: '2026-10-07', to: '2026-10-07' }).occurrences.length, 0, 'and no Wednesday class was invented')
      assert.equal(calendar.notes({ source: SOURCE, uid: 'MATH101-01' }).length, 1, 'the note is untouched')
      assert.deepEqual(calendar.unlinkedNotes(), [], 'and it is still attached to its class')
    })
  })
})

test('syncing the same timetable again changes nothing', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-idempotent-', async root => {
    await withCalendar(root, async calendar => {
      const snapshot = () => calendar.occurrences({ from: '2026-10-05', to: '2026-10-13' }).occurrences
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      const tuesday = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', originalStart: tuesday.originalStart, text: '期末要背 P187' })
      const before = snapshot()

      // The school's timetable is polled repeatedly; a snapshot that has not
      // changed must not add anything, and must not disturb the note.
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })

      assert.equal(snapshot().length, before.length, 'no occurrence was duplicated')
      assert.deepEqual(snapshot().map(o => o.occurrenceId), before.map(o => o.occurrenceId))
      assert.equal(calendar.snapshot().events.length, 1, 'and no second record was created')
      assert.equal(calendar.notes({ source: SOURCE, uid: 'MATH101-01' }).length, 1)
      assert.deepEqual(calendar.unlinkedNotes(), [])
    })
  })
})

test('two school reschedules that arrive together both land', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-concurrent-source-', async root => {
    await withCalendar(root, async calendar => {
      // The adapter is not asked to wait between snapshots, and a poll can overlap the
      // previous one. A snapshot's entries are applied one after another, so an entry
      // reads the record as the entry before it left it only if the whole snapshot is
      // one unit. Read every entry up front instead and the second entry is written
      // from a copy taken before the first was written — which is how two changes the
      // school did send end up as one.
      const other = { uid: 'PHYS101-01', title: '大学物理', end: '2026-10-07T09:35', recurrence: { freq: 'weekly', byDay: ['we'], count: 16 } }
      await calendar.applySource({
        source: SOURCE,
        events: [classOn('2026-10-06T09:00'), { ...other, start: '2026-10-07T08:00' }],
      })

      await calendar.applySource({
        source: SOURCE,
        events: [
          classOn('2026-10-06T09:00', { cancelledDates: ['2026-10-13'] }),
          { ...other, start: '2026-10-07T08:00', cancelledDates: ['2026-10-14'] },
        ],
      })

      assert.deepEqual(
        calendar.getEvent({ uid: 'MATH101-01', source: SOURCE })?.exceptions,
        ['2026-10-13'],
        'the first entry of the snapshot was applied',
      )
      assert.deepEqual(
        calendar.getEvent({ uid: 'PHYS101-01', source: SOURCE })?.exceptions,
        ['2026-10-14'],
        'and so was the second, which is the one a stale read would have discarded',
      )
    })
  })
})

test('two polls of the same source that overlap each keep their own change', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-concurrent-polls-', async root => {
    await withCalendar(root, async calendar => {
      // Two polls of one source can be in flight at once, and each of them reads the
      // records it is about to change before it changes them. That read is what has to
      // be inside the same unit as the write: a poll that reads before the other poll
      // has written works from a record it believes is current, and whatever the other
      // poll put there is not in it.
      //
      // The two polls below are built so that this shows up as lost data rather than as
      // a timing coincidence. The first carries a class called off on 2026-11-03 and no
      // word about the physics class; the second carries the same physics class, called
      // off on 2026-11-04, and no word about the maths one. A poll that lists a class
      // owns its baseline, so the maths poll is the one that creates the record and it
      // is the second poll's turn to read that record. Reading it before the first poll
      // has written it means there is nothing to merge into, and 2026-11-03 is gone.
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })

      const physics = { ...classOn('2026-10-07T08:00'), uid: 'PHYS101-01', title: '大学物理' }
      await Promise.all([
        calendar.applySource({
          source: SOURCE,
          events: [classOn('2026-10-06T09:00', { cancelledDates: ['2026-11-03'] }), physics],
        }),
        calendar.applySource({
          source: SOURCE,
          events: [classOn('2026-10-06T09:00'), { ...physics, cancelledDates: ['2026-11-04'] }],
        }),
      ])

      assert.deepEqual(
        calendar.getEvent({ uid: 'MATH101-01', source: SOURCE })?.exceptions,
        ['2026-11-03'],
        'the cancellation the first poll carried survived the second poll',
      )
      assert.deepEqual(
        calendar.getEvent({ uid: 'PHYS101-01', source: SOURCE })?.exceptions,
        ['2026-11-04'],
        'and so is the second, so neither poll silently won',
      )
    })
  })
})

test('a school move and the user cancelling the same class are both kept', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-concurrent-override-', async root => {
    await withCalendar(root, async calendar => {
      // Both of these read the record, change part of it and write it back. A school
      // poll and a click on the calendar are independent, so they can land together;
      // whichever runs second must see what the first wrote rather than build its own
      // version from the record as it was before.
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })

      await Promise.all([
        calendar.applySource({ source: SOURCE, events: [classOn('2026-10-20T09:00', { movedFrom: '2026-10-20T09:00' })] }),
        calendar.putNote({ source: SOURCE, uid: 'MATH101-01', originalStart: '2026-10-06T09:00', text: '期末要背 P187' }),
      ])

      assert.equal(
        calendar.getEvent({ uid: 'MATH101-01', source: SOURCE }).overrides?.length,
        1,
        'the school\'s move is recorded',
      )
      assert.equal(
        calendar.notes({ source: SOURCE, uid: 'MATH101-01', originalStart: '2026-10-06T09:00' })[0]?.note.text,
        '期末要背 P187',
        'and the note written at the same moment is still there',
      )
    })
  })
})

test('the user cancelling one date survives a school poll of the same class', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-concurrent-cancel-', async root => {
    await withCalendar(root, async calendar => {
      // A cancellation is the reader's, and a poll is not allowed to undo it: the
      // school still lists the class, so a poll that read the record before the
      // cancellation was written would put the date straight back.
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })

      await Promise.all([
        calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] }),
        calendar.cancelOccurrence({ uid: 'MATH101-01', source: SOURCE, date: '2026-10-13' }),
      ])

      assert.deepEqual(
        calendar.getEvent({ uid: 'MATH101-01', source: SOURCE }).exceptions,
        ['2026-10-13'],
        'the cancelled date stays cancelled',
      )
      assert.deepEqual(
        calendar.occurrences({ from: '2026-10-13', to: '2026-10-13' }).occurrences,
        [],
        'and the class does not come back that day',
      )
    })
  })
})

test('a class cannot be written to end before it starts, whatever the school sent', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-span-source-', async root => {
    await withCalendar(root, async calendar => {
      // The adapter is not the last word on whether a span makes sense. A payload with
      // a backwards span is a bad read, and storing it puts a class on the calendar
      // that no view can draw and no occurrence can be reasoned about.
      await assert.rejects(
        calendar.applySource({
          source: SOURCE,
          events: [{ uid: 'BROKEN-1', title: '坏数据', start: '2026-10-06T11:00', end: '2026-10-06T10:00' }],
        }),
        /end/i,
        'a backwards span is refused rather than stored',
      )
      assert.deepEqual(calendar.snapshot().events, [], 'and nothing was left behind')

      // An overnight class is the legitimate case where the clock reading goes
      // backwards: the end is on a later date, and it must keep working.
      await calendar.applySource({
        source: SOURCE,
        events: [{ uid: 'NIGHT-1', title: '晚课', start: '2026-10-06T22:00', end: '2026-10-07T01:00' }],
      })
      assert.deepEqual(calendar.snapshot().events.map(event => event.uid), ['NIGHT-1'])
    })
  })
})

test('a reschedule may not leave the class ending before it starts', { skip: !runtime }, async () => {
  await withRoot('eduwork-calendar-span-move-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      const originalStart = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0].originalStart

      // A payload that moves the start and keeps the old finish — the ordinary shape
      // of a school reschedule — must be corrected, not stored as it arrived. The
      // length the series had is what the occurrence inherits.
      await calendar.applySource({
        source: SOURCE,
        events: [classOn('2026-10-06T14:00', { movedFrom: originalStart, end: '2026-10-06T11:35' })],
      })
      const moved = calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences[0]
      assert.equal(moved.start, '2026-10-06T14:00')
      assert.equal(moved.end, '2026-10-06T16:35', 'the class keeps its length rather than ending before it began')
      assert.ok(moved.end > moved.start)
    })
  })
})
