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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
    return await body(ctx.calendar, ctx)
  } finally {
    await ctx.fiber.dispose()
  }
}

const SOURCE = 'ecnu:timetable'

test('due reminders enter the durable calendar inbox once, survive restart and can be marked read without a Session', { skip: !runtime }, async t => {
  let now = Date.parse('2040-01-02T09:00:00')
  t.mock.method(Date, 'now', () => now)
  await withRoot('calendar-reminder-inbox-', async root => {
    let id
    await withCalendar(root, async calendar => {
      await calendar.putEvent({ uid: 'reminder', title: '上课', start: '2040-01-02T10:00' })
      await calendar.setPersonal({ source: 'manual', uid: 'reminder', patch: { reminder: { kind: 'relative', minutes: 15 } } })
      await calendar.checkReminders()
      assert.equal(calendar.reminders().items.length, 0)
      now = Date.parse('2040-01-02T09:45:01')
      await calendar.checkReminders()
      const inbox = calendar.reminders()
      assert.equal(inbox.items.length, 1)
      assert.equal(inbox.items[0].title, '上课')
      assert.equal(inbox.items[0].read, false)
      assert.equal(inbox.channel, 'in-app')
      id = inbox.items[0].id
      await calendar.checkReminders()
      assert.equal(calendar.reminders().items.length, 1)
    })
    await withCalendar(root, async calendar => {
      await calendar.checkReminders()
      assert.equal(calendar.reminders().items.length, 1)
      assert.equal(calendar.reminders().items[0].id, id)
      await calendar.ackReminder({ id })
      assert.equal(calendar.reminders().items[0].read, true)
    })
  })
})

test('moving a class moves its due reminder, cancellation stops relative reminders and fixed reminders stay independent', { skip: !runtime }, async t => {
  let now = Date.parse('2040-01-02T09:00:00')
  t.mock.method(Date, 'now', () => now)
  await withRoot('calendar-reminder-moves-', async root => withCalendar(root, async calendar => {
    for (const uid of ['moved', 'cancelled', 'fixed']) {
      await calendar.putEvent({ uid, title: uid, start: '2040-01-02T10:00', recurrence: { freq: 'weekly', count: 2 } })
      await calendar.setPersonal({ source: 'manual', uid, patch: { reminder: uid === 'fixed'
        ? { kind: 'fixed', at: '2040-01-02T09:45' } : { kind: 'relative', minutes: 15 } } })
    }
    await calendar.applyOverride({ uid: 'moved', date: '2040-01-02', patch: { start: '2040-01-02T11:00' } })
    for (const uid of ['cancelled', 'fixed']) await calendar.cancelOccurrence({ uid, date: '2040-01-02' })
    now = Date.parse('2040-01-02T09:45:01')
    await calendar.checkReminders()
    assert.deepEqual(calendar.reminders().items.map(row => row.title), ['fixed'])
    now = Date.parse('2040-01-02T10:45:01')
    await calendar.checkReminders()
    assert.deepEqual(calendar.reminders().items.map(row => row.title).sort(), ['fixed', 'moved'])
    assert.equal(calendar.reminders().items.find(row => row.title === 'moved').at, '2040-01-02T10:45')
  }))
})

test('restart catches up only recent due reminders and reminder-off prevents delivery', { skip: !runtime }, async t => {
  let now = Date.parse('2040-01-02T09:00:00')
  t.mock.method(Date, 'now', () => now)
  await withRoot('calendar-reminder-catchup-', async root => {
    await withCalendar(root, async calendar => {
      for (const uid of ['recent', 'ancient', 'off']) {
        await calendar.putEvent({ uid, title: uid, start: '2040-01-04T10:00' })
        await calendar.setPersonal({ source: 'manual', uid, patch: { reminder: { kind: 'fixed', at: uid === 'ancient' ? '2040-01-02T10:00' : '2040-01-03T10:00' } } })
      }
      await calendar.setPersonal({ source: 'manual', uid: 'off', patch: { reminder: { off: true } } })
    })
    now = Date.parse('2040-01-04T09:00:00')
    await withCalendar(root, async calendar => {
      await calendar.checkReminders()
      assert.deepEqual(calendar.reminders().items.map(row => row.title), ['recent'])
    })
  })
})

test('desktop delivery retries a bridge failure without duplicating the durable inbox receipt', { skip: !runtime }, async t => {
  let now = Date.parse('2040-01-02T09:00:00'), fail = true
  t.mock.method(Date, 'now', () => now)
  const calls = [], dismissed = []
  await withRoot('calendar-reminder-native-retry-', async root => withCalendar(root, async (calendar, ctx) => {
    const { Service } = await load('@deepseek-ai/cordis')
    await ctx.plugin(class extends Service {
      constructor(ctx) { super(ctx, 'notifications'); this.version = 1 }
      register(inner) {
        const controller = new AbortController()
        const handle = {
          signal: controller.signal,
          async publish(receipt) { calls.push(receipt.id); if (fail) throw Error('bridge unavailable'); return { delivery: 'desktop' } },
          withdraw(id) { dismissed.push(id) }, dispose() { controller.abort() },
        }
        inner.effect(() => () => handle.dispose())
        return handle
      }
    })
    await calendar.putEvent({ uid: 'retry', title: 'Retry reminder', start: '2040-01-02T10:00' })
    await calendar.setPersonal({ source: 'manual', uid: 'retry', patch: { reminder: { kind: 'relative', minutes: 15 } } })
    now = Date.parse('2040-01-02T09:45:01')
    await calendar.checkReminders()
    assert.equal(calendar.reminders().items.length, 1)
    assert.equal(calendar.reminders().channel, 'unavailable')
    fail = false
    await calendar.checkReminders()
    assert.equal(calendar.reminders().channel, 'system')
    assert.equal(calendar.reminders().items.length, 1)
    assert.equal(calls.length, 2)
    assert.equal(calls[0], calls[1])
    await calendar.checkReminders()
    assert.equal(calls.length, 2)
    const id = calendar.reminders().items[0].id
    await calendar.ackReminder({ id })
    assert.equal(calendar.reminders().items[0].read, true)
    assert.deepEqual(dismissed, [id], 'marking a reminder read also withdraws its desktop notice through the service')
  }))
})

test('deleting an imported calendar removes only its events and keeps private notes across restart', { skip: !runtime }, async () => {
  await withRoot('calendar-delete-source-', async root => {
    await withCalendar(root, async calendar => {
      for (const source of ['imported-a', 'imported-b', 'manual']) {
        await calendar.putEvent({ source, uid: 'shared', title: source, start: '2026-10-19T09:00' })
      }
      await calendar.putNote({ source: 'imported-a', uid: 'shared', text: 'Keep my note' })
      await calendar.applyOverride({ source: 'imported-a', uid: 'shared', date: '2026-10-19', patch: { start: '2026-10-19T10:00' } })
      assert.deepEqual(await calendar.deleteCalendar({ source: 'imported-a' }), { removedEvents: 1 })
      assert.deepEqual(await calendar.deleteCalendar({ source: 'imported-a' }), { removedEvents: 0 })
      assert.deepEqual(calendar.snapshot().events.map(e => e.source).sort(), ['imported-b', 'manual'])
      assert.equal(calendar.unlinkedNotes()[0].note.text, 'Keep my note')
    })
    await withCalendar(root, async calendar => {
      assert.equal(calendar.getEvent({ source: 'imported-a', uid: 'shared' }), undefined)
      assert.equal(calendar.notes({ source: 'imported-a' })[0].note.text, 'Keep my note')
      await calendar.putEvent({ source: 'imported-a', uid: 'shared', title: 'Reimported', start: '2026-10-19T09:00' })
      assert.equal(calendar.occurrences({ from: '2026-10-19', to: '2026-10-19' }).occurrences.find(e => e.source === 'imported-a').start, '2026-10-19T09:00')
    })
  })
})

test('whole-calendar deletion rejects default and managed calendars without changing them', { skip: !runtime }, async () => {
  await withRoot('calendar-delete-guard-', async root => withCalendar(root, async calendar => {
    const handle = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar' })
    await handle.apply({ events: [{ uid: 'same', title: 'Managed', start: '2026-10-19' }] })
    await calendar.putEvent({ uid: 'same', title: 'Personal', start: '2026-10-19' })
    const before = calendar.snapshot()
    for (const source of [undefined, '', ' ', 'manual', handle.source]) {
      await assert.rejects(calendar.deleteCalendar({ source }), /不能删除|请选择/)
    }
    assert.deepEqual(calendar.snapshot(), before)
  }))
})

test('file and legacy snapshot imports cannot bypass a managed source writer', { skip: !runtime }, async () => {
  await withRoot('calendar-managed-import-', async root => withCalendar(root, async calendar => {
    const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar' })
    const event = { uid: 'exam', title: 'School exam', start: '2026-10-20' }
    await source.apply({ complete: true, events: [event] })
    const text = calendar.exportIcs().text.replace('School exam', 'Must not overwrite')
    await assert.rejects(calendar.importIcs({ source: 'ics:user', text }), /source_handle_required/)
    await assert.rejects(calendar.importSnapshot({ events: [{ ...event, source: source.source, title: 'Must not overwrite' }] }), /source_handle_required/)
    assert.equal(calendar.getEvent({ source: source.source, uid: event.uid }).title, 'School exam')
  }))
})

test('concurrent incremental pushes retain both updates rather than superseding one another', { skip: !runtime }, async () => {
  await withRoot('calendar-push-increments-', async root => withCalendar(root, async calendar => {
    const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar' })
    await Promise.all([
      source.apply({ events: [{ uid: 'a', title: 'A', start: '2026-10-06' }] }),
      source.apply({ events: [{ uid: 'b', title: 'B', start: '2026-10-07' }] }),
    ])
    assert.deepEqual(calendar.snapshot().events.map(event => event.uid).sort(), ['a', 'b'])
  }))
})

test('reordering a versioned snapshot does not redefine its content', { skip: !runtime }, async () => {
  await withRoot('calendar-revision-order-', async root => withCalendar(root, async calendar => {
    const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar' })
    const events = [{ uid: 'a', title: 'A', start: '2026-10-06' }, { uid: 'b', title: 'B', start: '2026-10-07' }]
    await source.apply({ revision: 1, complete: true, events })
    await source.apply({ revision: 1, complete: true, events: [...events].reverse() })
    assert.equal(calendar.snapshot().events.length, 2)
  }))
})

test('one update receipt can be submitted only once, including concurrent submissions', { skip: !runtime }, async () => {
  await withRoot('calendar-receipt-once-', async root => withCalendar(root, async calendar => {
    const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar' })
    const request = source.beginUpdate()
    const first = request.apply({ complete: true, events: [{ uid: 'one', title: 'First', start: '2026-10-06' }] })
    const second = request.apply({ complete: true, events: [] })
    assert.equal((await second).state, 'superseded')
    assert.equal((await first).state, 'ready')
    assert.equal(calendar.snapshot().events.length, 1)
  }))
})

test('bulk agent imports replay stable IDs and cannot replace a managed source without opt-in', { skip: !runtime }, async () => {
  await withRoot('calendar-agent-import-', async root => withCalendar(root, async calendar => {
    const batch = { source: 'agent:semester', complete: true, events: [{ uid: 'exam', title: 'Exam', start: '2026-12-07' }] }
    await calendar.importSource(batch)
    await calendar.importSource(batch)
    assert.equal(calendar.snapshot().events.length, 1)
    await assert.rejects(calendar.importSource({ ...batch, source: 'manual' }), /reserved/)
    const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar' })
    await source.apply({ complete: true, events: batch.events })
    await assert.rejects(calendar.importSource({ ...batch, source: source.source, events: [] }), /source_agent_write_denied/)
    assert.equal(calendar.snapshot().events.length, 2)
    source.dispose()
    const permitted = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar', allowAgentUpdates: true })
    await calendar.importSource({ ...batch, source: permitted.source, events: [] })
    assert.equal(calendar.snapshot().events.length, 1)
  }))
})

test('source revisions survive restart and reject old or redefined versions while retaining private settings', { skip: !runtime }, async () => {
  await withRoot('calendar-source-revision-', async root => {
    const config = { provider: 'example.edu', account: 'public', feed: 'calendar:2026' }
    const base = { uid: 'exam', title: 'Exam week', start: '2026-12-07' }
    await withCalendar(root, async calendar => {
      const source = calendar.registerSource(config)
      await source.apply({ complete: true, revision: 2, events: [base] })
      await calendar.putNote({ source: source.source, uid: base.uid, text: 'Keep my review plan' })
    })
    await withCalendar(root, async calendar => {
      const source = calendar.registerSource(config)
      await assert.rejects(source.apply({ complete: true, revision: 1, events: [] }), /stale_revision/)
      await assert.rejects(source.apply({ complete: true, revision: 2, events: [] }), /revision_conflict/)
      await source.apply({ complete: true, revision: 2, events: [base] })
      assert.equal(calendar.snapshot().events.length, 1)
      assert.equal(calendar.notes({ source: source.source })[0].note.text, 'Keep my review plan')
    })
  })
})

test('source registration accepts pushed batches without fetching and binds writes to its own identity', { skip: !runtime }, async () => {
  await withRoot('calendar-pushed-source-', async root => withCalendar(root, async calendar => {
    const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar:2026' })
    assert.equal(calendar.snapshot().events.length, 0)
    await source.apply({ complete: true, revision: 1, events: [{ uid: 'exam', title: 'Exam week', start: '2026-12-07' }] })
    assert.equal(calendar.snapshot().events[0].source, source.source)
    assert.equal(calendar.sourceStatuses()[0].state, 'ready')
    await assert.rejects(calendar.applySource({ source: source.source, complete: true, events: [] }), /source_handle_required/)
    assert.equal(calendar.snapshot().events.length, 1)
    await assert.rejects(source.apply({ source: 'another-source', complete: true, events: [] }), /source_mismatch/)
    source.dispose()
    assert.equal(calendar.snapshot().events.length, 0)
  }))
})
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


test('a rejected source batch preserves every event, note and personal change', { skip: !runtime }, async () => {
  await withRoot('calendar-source-batch-validation-', async root => {
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      await calendar.applyOverride({ source: SOURCE, uid: 'MATH101-01', date: '2026-10-13', patch: { location: 'Personal room' } })
      await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', originalStart: '2026-10-06T09:00', text: 'Keep my note' })
      const before = calendar.snapshot()
      const notes = calendar.notes({ source: SOURCE })
      await assert.rejects(calendar.applySource({ source: SOURCE, events: [
        classOn('2026-10-06T09:00', { title: 'Must not partially update' }),
        { uid: 'bad', title: 'Invalid later entry', start: '2026-02-30T09:00' },
      ] }), /date|exist/i)
      assert.deepEqual(calendar.snapshot(), before)
      assert.deepEqual(calendar.notes({ source: SOURCE }), notes)
    })
  })
})


test('a complete source snapshot removes only its missing events and keeps personal notes', { skip: !runtime }, async () => {
  await withRoot('calendar-complete-source-', async root => withCalendar(root, async calendar => {
    const first = classOn('2026-10-06T09:00')
    const second = { ...first, uid: 'removed', title: 'No longer listed' }
    await calendar.applySource({ source: SOURCE, events: [first, second] })
    await calendar.putEvent({ uid: 'personal', title: 'Personal', start: first.start })
    await calendar.applySource({ source: 'other', events: [{ ...first }] })
    await calendar.putNote({ source: SOURCE, uid: second.uid, originalStart: first.start, text: 'Keep removed class note' })
    const report = await calendar.applySource({ source: SOURCE, complete: true, events: [first] })
    assert.equal(report.removed, 1)
    assert.deepEqual(calendar.snapshot().events.map(e => `${e.source}/${e.uid}`).sort(), [`${SOURCE}/${first.uid}`, 'manual/personal', 'other/MATH101-01'].sort())
    const empty = await calendar.applySource({ source: SOURCE, complete: true, events: [] })
    assert.equal(empty.removed, 1)
    assert.equal(calendar.snapshot().events.length, 2)
    assert.equal(calendar.notes({ source: SOURCE, uid: second.uid })[0].note.text, 'Keep removed class note')
  }))
})

test('an incomplete source result is refused and an unattributable full snapshot changes nothing', { skip: !runtime }, async () => {
  await withRoot('calendar-incomplete-source-', async root => withCalendar(root, async calendar => {
    const first = classOn('2026-10-06T09:00')
    const second = { ...first, uid: 'second', title: 'Second' }
    await calendar.applySource({ source: SOURCE, events: [first, second] })
    const before = calendar.snapshot()
    await assert.rejects(calendar.applySource({ source: SOURCE, complete: false, events: [] }), /incomplete/i)
    assert.deepEqual(calendar.snapshot(), before)
    const report = await calendar.applySource({ source: SOURCE, complete: true, events: [
      { ...first, title: 'Must not partially change' },
      { ...second, start: '2026-10-07T09:00' },
    ] })
    assert.equal(report.unattributable.length, 1)
    assert.equal(report.applied, 0)
    assert.deepEqual(calendar.snapshot(), before)
  }))
})


test('registered writers isolate accounts and a newer request supersedes an old receipt', { skip: !runtime }, async () => {
  await withRoot('calendar-source-order-', async root => withCalendar(root, async calendar => {
    const config = { provider: 'example.edu', account: 'student-1', feed: 'timetable' }
    const first = calendar.registerSource(config)
    const older = first.beginUpdate()
    const newer = first.beginUpdate()
    await newer.apply({ complete: true, events: [classOn('2026-10-06T09:00', { title: 'Newest' })] })
    assert.equal((await older.apply({ complete: true, events: [classOn('2026-10-06T09:00', { title: 'Outdated' })] })).state, 'superseded')
    assert.equal(calendar.getEvent({ source: first.source, uid: 'MATH101-01' }).title, 'Newest')
    const other = calendar.registerSource({ ...config, account: 'student-2' })
    await other.apply({ complete: true, events: [classOn('2026-10-06T09:00')] })
    assert.notEqual(other.source, first.source)
    assert.equal(calendar.snapshot().events.length, 2)
    first.dispose()
    const again = calendar.registerSource({ ...config, label: 'Renamed' })
    assert.equal(again.source, first.source)
    await assert.rejects(first.apply({ complete: true, events: [] }), /source_inactive/)
    again.dispose()
    other.dispose()
  }))
})

test('failed and incomplete external updates retain old data while another writer updates', { skip: !runtime }, async () => {
  await withRoot('calendar-source-errors-', async root => withCalendar(root, async calendar => {
    const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar' })
    await source.apply({ complete: true, events: [{ uid: 'one', title: 'Keep', start: '2026-10-06' }] })
    source.beginUpdate().fail('private-token-never-display')
    assert.equal(source.status().error, 'sync_failed')
    await assert.rejects(source.apply({ complete: false, events: [] }), /incomplete/)
    const other = calendar.registerSource({ provider: 'example.edu', account: 'a', feed: 'timetable' })
    await other.apply({ complete: true, events: [{ uid: 'two', title: 'Other', start: '2026-10-07' }] })
    assert.equal(calendar.getEvent({ source: source.source, uid: 'one' }).title, 'Keep')
    assert.equal(calendar.getEvent({ source: other.source, uid: 'two' }).title, 'Other')
    assert.ok(!JSON.stringify(calendar.sourceStatuses()).includes('private-token'))
    assert.equal(typeof calendar.syncSources, 'undefined', 'calendar owns no polling or fetching')
    source.dispose()
    other.dispose()
  }))
})


test('change subscriptions cover source and personal commits and stop on cancellation', { skip: !runtime }, async () => {
  await withRoot('calendar-change-stream-', async root => withCalendar(root, async calendar => {
    const controller = new AbortController()
    const stream = calendar.changes(controller.signal)[Symbol.asyncIterator]()
    const initial = (await stream.next()).value.revision
    await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
    const changed = (await stream.next()).value.revision
    assert.ok(changed > initial)
    await calendar.putNote({ source: SOURCE, uid: 'MATH101-01', text: 'External edit' })
    assert.ok((await stream.next()).value.revision > changed)
    const pending = stream.next()
    controller.abort()
    assert.equal((await pending).done, true)
  }))
})


test('personal fields inherit independently and clearing a note preserves reminder settings', { skip: !runtime }, async () => {
  await withRoot('calendar-personal-fields-', async root => {
    const ref = { source: SOURCE, uid: 'MATH101-01' }
    const once = { ...ref, originalStart: '2026-10-06T09:00' }
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00')] })
      await calendar.setPersonal({ ...ref, patch: { note: { text: 'Series note' }, reminder: { kind: 'relative', minutes: 15 }, hidden: true } })
      await calendar.setPersonal({ ...once, patch: { hidden: false, note: { off: true } } })
      const effective = calendar.personalFor(once)
      assert.equal(effective.hidden, false)
      assert.deepEqual(effective.note, { off: true })
      assert.deepEqual(effective.reminder, { kind: 'relative', minutes: 15 })
      await calendar.setPersonal({ ...once, clear: ['note'] })
      assert.equal(calendar.personalFor(once).note.text, 'Series note')
      await calendar.putNote({ ...once, text: 'One class note' })
      await calendar.setPersonal({ ...once, patch: { reminder: { off: true } } })
      assert.equal((await calendar.removeNote(once)).removed, true)
      assert.equal(calendar.personalFor(once).note.text, 'Series note')
      assert.deepEqual(calendar.personalFor(once).reminder, { off: true })
      assert.equal(calendar.occurrences({ from: '2026-10-06', to: '2026-10-20' }).occurrences.length, 1)
      assert.equal(calendar.occurrences({ from: '2026-10-06', to: '2026-10-20', includeHidden: true }).occurrences.length, 3)
    })
    await withCalendar(root, async calendar => {
      assert.equal(calendar.personalFor(once).hidden, false)
      assert.deepEqual(calendar.personalFor(once).reminder, { off: true }, 'settings survive restart')
      const stored = calendar.notes(ref).find(record => record.originalStart)
      assert.equal(stored.note, undefined, 'inheritance is never written back')
    })
  })
})


test('editing an imported description preserves a private remark across source refreshes', { skip: !runtime }, async () => {
  await withRoot('calendar-private-remark-', async root => withCalendar(root, async calendar => {
    await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00', { description: 'School description' })] })
    const event = calendar.getEvent({ source: SOURCE, uid: 'MATH101-01' })
    await calendar.putEvent({ ...event, description: 'My private remark' })
    assert.equal(calendar.getEvent({ source: SOURCE, uid: event.uid }).description, 'School description')
    await calendar.applySource({ source: SOURCE, complete: true, events: [classOn(event.start, { description: 'School changed description' })] })
    assert.equal(calendar.personalFor(event).remark.text, 'My private remark')
    assert.equal(calendar.getEvent({ source: SOURCE, uid: event.uid }).description, 'School changed description')
    assert.ok(!calendar.exportIcs().text.includes('My private remark'), 'private remarks do not leave in ICS')
  }))
})


test('old unattributed descriptions remain available for review after upgrade and refresh', { skip: !runtime }, async () => {
  await withRoot('calendar-legacy-description-', async root => {
    await mkdir(join(root, 'storages'), { recursive: true })
    const record = { ...classOn('2026-10-06T09:00'), source: SOURCE, description: 'Possibly a user note in an old version', extensions: { 'X-LOCAL-REMINDER': '15' } }
    await writeFile(join(root, 'storages', 'calendar.json'), JSON.stringify({
      unit: { name: 'calendar', version: 1 }, global: null, tables: { events: { [record.uid]: record } },
    }))
    await withCalendar(root, async calendar => {
      await calendar.applySource({ source: SOURCE, events: [classOn(record.start, { description: 'Fresh school text' })] })
      assert.equal(calendar.personalFor(record).legacyDescription, record.description)
      assert.deepEqual(calendar.personalFor(record).legacyExtensions, record.extensions)
      assert.equal(calendar.personalFor(record).remark, undefined, 'unknown old ownership is not guessed')
    })
    await withCalendar(root, calendar => {
      assert.equal(calendar.personalFor(record).legacyDescription, record.description, 'backup survives restart')
    })
  })
})


test('relative reminders follow moves and cancellations while fixed reminders retain their own time', { skip: !runtime }, async () => {
  await withRoot('calendar-reminder-plan-', async root => withCalendar(root, async calendar => {
    const ref = { source: SOURCE, uid: 'MATH101-01' }
    const first = { ...ref, originalStart: '2026-10-06T09:00' }
    const second = { ...ref, originalStart: '2026-10-13T09:00' }
    const range = { from: '2026-10-05', to: '2026-10-20' }
    await calendar.applySource({ source: SOURCE, events: [classOn(first.originalStart)] })
    await calendar.setPersonal({ ...ref, patch: { reminder: { kind: 'relative', minutes: 15 } } })
    await calendar.setPersonal({ ...second, patch: { reminder: { kind: 'fixed', at: '2026-10-13T20:00' } } })
    let tasks = calendar.reminderPlan(range).tasks
    const initial = tasks.find(task => task.ref.originalStart === first.originalStart)
    assert.equal(initial.at, '2026-10-06T08:45')
    await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T10:00', { movedFrom: first.originalStart })] })
    tasks = calendar.reminderPlan(range).tasks
    assert.equal(tasks.find(task => task.id === initial.id).at, '2026-10-06T09:45')
    await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-08T14:00', { movedFrom: first.originalStart })] })
    tasks = calendar.reminderPlan(range).tasks
    assert.equal(tasks.find(task => task.id === initial.id).at, '2026-10-08T13:45')
    assert.equal(tasks.find(task => task.kind === 'fixed').at, '2026-10-13T20:00')
    await calendar.putNote({ ...first, text: 'Keep after cancellation' })
    await calendar.applySource({ source: SOURCE, events: [classOn(first.originalStart, { cancelledDates: [first.originalStart, second.originalStart] })] })
    tasks = calendar.reminderPlan(range).tasks
    assert.equal(tasks.some(task => task.id === initial.id), false)
    assert.equal(tasks.find(task => task.kind === 'fixed').at, '2026-10-13T20:00', 'fixed personal reminders are independent of class attendance')
    assert.equal(calendar.notes(first)[0].note.text, 'Keep after cancellation')
    assert.equal(new Set(tasks.map(task => task.id)).size, tasks.length)
  }))
})


test('scheduler reconciliation updates stable reminder IDs, removes cancelled tasks and retries failures', { skip: !runtime }, async () => {
  await withRoot('calendar-reminder-scheduler-', async root => withCalendar(root, async calendar => {
    const ref = { source: SOURCE, uid: 'MATH101-01' }
    await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T09:00', { recurrence: undefined })] })
    await calendar.setPersonal({ ...ref, patch: { reminder: { kind: 'relative', minutes: 15 } } })
    let calls = 0, fail = false
    const jobs = new Map()
    const binding = calendar.registerReminderScheduler({
      async replace({ owner, tasks }) {
        assert.equal(owner, 'calendar')
        ++calls
        if (fail) throw new Error('adapter private error')
        jobs.clear()
        for (const task of tasks) jobs.set(task.id, task)
      },
    }, { from: '2026-10-05', to: '2026-10-20' })
    await binding.refresh()
    assert.equal(jobs.size, 1)
    const id = [...jobs.keys()][0]
    await calendar.applySource({ source: SOURCE, events: [classOn('2026-10-06T10:00', { recurrence: undefined, movedFrom: '2026-10-06T09:00' })] })
    await binding.refresh()
    assert.equal(jobs.size, 1)
    assert.equal(jobs.get(id).at, '2026-10-06T09:45')
    const before = calls
    await calendar.putNote({ ...ref, text: 'A note does not create another reminder' })
    await binding.refresh()
    assert.equal(calls, before)
    fail = true
    await calendar.setPersonal({ ...ref, patch: { reminder: { off: true } } })
    await binding.refresh()
    assert.equal(binding.status().state, 'error')
    assert.equal(binding.status().error, 'scheduler_failed')
    fail = false
    await binding.refresh()
    assert.equal(jobs.size, 0)
    assert.equal(binding.status().state, 'ready')
    binding.dispose()
  }))
})


test('source updates and file imports cannot impersonate the manual or registered-source namespace', { skip: !runtime }, async () => {
  await withRoot('calendar-source-reserved-', async root => withCalendar(root, async calendar => {
    await calendar.putEvent({ uid: 'mine', title: 'My event', start: '2026-10-06T09:00' })
    const before = calendar.snapshot()
    await assert.rejects(calendar.applySource({ source: 'manual', complete: true, events: [] }), /reserved/i)
    const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n'
    await assert.rejects(calendar.importIcs({ source: 'manual', text }), /reserved/i)
    await assert.rejects(calendar.importIcs({ source: 'sync:registered', text }), /reserved/i)
    assert.deepEqual(calendar.snapshot(), before)
  }))
})


test('queued note removal observes preceding writes and preserves concurrently saved reminder fields', { skip: !runtime }, async () => {
  await withRoot('calendar-note-clear-queue-', async root => withCalendar(root, async calendar => {
    const ref = { source: SOURCE, uid: 'queued-note', originalStart: '2026-10-06T09:00' }
    const write = calendar.putNote({ ...ref, text: 'Queued write' })
    const clear = calendar.removeNote(ref)
    const reminder = calendar.setPersonal({ ...ref, patch: { reminder: { kind: 'relative', minutes: 30 }, hidden: false } })
    const [, removed] = await Promise.all([write, clear, reminder])
    assert.equal(removed.removed, true)
    assert.equal(calendar.personalFor(ref).note, undefined)
    assert.deepEqual(calendar.personalFor(ref).reminder, { kind: 'relative', minutes: 30 })
    assert.equal(calendar.personalFor(ref).hidden, false)
  }))
})


test('source activation suspends visibility and invalidates pending external writes', { skip: !runtime }, async () => {
  await withRoot('calendar-source-suspend-', async root => withCalendar(root, async calendar => {
    const config = { provider: 'example.edu', account: 'a', feed: 'calendar' }
    const source = calendar.registerSource(config)
    await source.apply({ complete: true, events: [{ uid: 'one', title: 'Keep', start: '2026-10-06' }] })
    const request = source.beginUpdate()
    source.setActive(false)
    assert.equal(calendar.snapshot().events.length, 0)
    assert.equal((await request.apply({ complete: true, events: [] })).state, 'superseded')
    source.setActive(true)
    assert.equal(calendar.snapshot().events.length, 1)
    source.dispose()
    assert.deepEqual(calendar.sourceStatuses(), [])
  }))
})


test('a later complete snapshot can restore school cancellations and moves while keeping personal exceptions', { skip: !runtime }, async () => {
  await withRoot('calendar-source-restoration-', async root => withCalendar(root, async calendar => {
    const base = classOn('2026-10-06T09:00')
    const ref = { source: SOURCE, uid: base.uid }
    await calendar.applySource({ source: SOURCE, complete: true, events: [base] })
    await calendar.cancelOccurrence({ ...ref, date: '2026-10-13' })
    await calendar.applyOverride({ ...ref, date: '2026-10-20', patch: { location: 'My room' } })
    await calendar.applySource({ source: SOURCE, complete: true, events: [{ ...base, cancelledDates: ['2026-10-06'] }] })
    assert.equal(calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences.length, 0)
    await calendar.applySource({ source: SOURCE, complete: true, events: [{ ...base, cancelledDates: [] }] })
    assert.equal(calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences.length, 1)
    await calendar.applySource({ source: SOURCE, complete: true, events: [{ ...base, start: '2026-10-08T14:00', movedFrom: base.start }] })
    await calendar.applySource({ source: SOURCE, complete: true, events: [base] })
    const week = calendar.occurrences({ from: '2026-10-05', to: '2026-10-25' }).occurrences
    assert.equal(week.find(item => item.originalStart === base.start).start, base.start)
    assert.equal(week.some(item => item.originalStart === '2026-10-13T09:00'), false)
    assert.equal(week.find(item => item.originalStart === '2026-10-20T09:00').location, 'My room')
  }))
})


test('logging out a registered account hides its cached classes without deleting notes or identity', { skip: !runtime }, async () => {
  await withRoot('calendar-source-account-visibility-', async root => withCalendar(root, async calendar => {
    const config = { provider: 'example.edu', account: 'student-a', feed: 'timetable' }
    const handle = calendar.registerSource(config)
    await handle.apply({ complete: true, events: [classOn('2026-10-06T09:00')] })
    await calendar.putNote({ source: handle.source, uid: 'MATH101-01', text: 'Account A note' })
    assert.equal(calendar.snapshot().events.length, 1)
    handle.dispose()
    assert.equal(calendar.snapshot().events.length, 0)
    assert.equal(calendar.occurrences({ from: '2026-10-06', to: '2026-10-06' }).occurrences.length, 0)
    assert.equal(calendar.notes({ source: handle.source })[0].note.text, 'Account A note')
    const again = calendar.registerSource(config)
    await again.apply({ complete: true, events: [classOn('2026-10-06T09:00')] })
    assert.equal(again.source, handle.source)
    assert.equal(calendar.snapshot().events.length, 1)
    again.dispose()
  }))
})


test('source moves must name an original instance instead of merely sharing its day', { skip: !runtime }, async () => {
  await withRoot('calendar-source-exact-anchor-', async root => withCalendar(root, async calendar => {
    const base = classOn('2026-10-06T09:00')
    await calendar.applySource({ source: SOURCE, complete: true, events: [base] })
    const before = calendar.snapshot()
    for (const movedFrom of ['2026-10-06T13:00', '2026-10-07T09:00', '2028-10-06T09:00']) {
      const report = await calendar.applySource({ source: SOURCE, complete: true, events: [{ ...base, start: '2026-10-08T14:00', movedFrom }] })
      assert.equal(report.unattributable[0]?.reason, 'no_such_original_occurrence')
      assert.deepEqual(calendar.snapshot(), before)
    }
  }))
})
