// ICS import and export: the field mapping, folding and escaping rules of
// RFC 5545 that this module implements, and the round trip that must not lose
// anything it did not understand. Pure text in, records out: no storage, no Host.
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

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

let modules
async function load() {
  bindRuntime()
  modules ??= {
    ics: await import('../lib/ics.js'),
    model: await import('../lib/model.js'),
  }
  return modules
}

test.after(() => hooks?.deregister())

/** Join content lines with CRLF, the way a real calendar file is written. */
const calendar = (...lines) => lines.join('\r\n') + '\r\n'

const WRAPPER = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//fixture//fixture//EN']

test('a VEVENT maps onto the record fields', { skip: !runtime }, async () => {
  const { ics, model } = await load()
  const { events, skipped, degraded } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-1',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'DTEND:20260302T093500',
    'LOCATION:理科楼 305',
    'DESCRIPTION:第 1 周',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.deepEqual(skipped, [])
  assert.deepEqual(degraded, [])
  assert.equal(events.length, 1)
  const [event] = events
  assert.equal(event.uid, 'fixture-1')
  assert.equal(event.title, '数据结构')
  assert.equal(event.start, '2026-03-02T08:00')
  assert.equal(event.end, '2026-03-02T09:35')
  assert.equal(event.location, '理科楼 305')
  assert.equal(event.description, '第 1 周')
  assert.equal(event.source, 'ics')
  // What the importer produces has to survive the durable record contract.
  assert.doesNotThrow(() => model.EventSchema.parse(event))
})

test('an all-day VEVENT keeps our inclusive end', { skip: !runtime }, async () => {
  const { ics } = await load()
  const { events } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-allday',
    'SUMMARY:校运动会',
    'DTSTART;VALUE=DATE:20260320',
    'DTEND;VALUE=DATE:20260323',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  // ICS ends on the next day, exclusively: the 20th to the 22nd are covered.
  assert.equal(events[0].start, '2026-03-20')
  assert.equal(events[0].end, '2026-03-22')
})

test('a UTC stamp becomes local time and a TZID is remembered', { skip: !runtime }, async () => {
  const { ics } = await load()
  const { events } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-utc',
    'SUMMARY:线上课',
    'DTSTART:20260302T000000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-tzid',
    'SUMMARY:另一节线上课',
    'DTSTART;TZID=Asia/Shanghai:20260303T080000',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  const utc = new Date(Date.UTC(2026, 2, 2, 0, 0))
  assert.equal(events[0].start, `${utc.getFullYear()}-${String(utc.getMonth() + 1).padStart(2, '0')}-${String(utc.getDate()).padStart(2, '0')}T${String(utc.getHours()).padStart(2, '0')}:00`)
  // No timezone database in this version: the wall clock is kept and the zone is
  // recorded rather than silently dropped.
  assert.equal(events[1].start, '2026-03-03T08:00')
  assert.equal(events[1].extensions['X-EDUWORK-TZID'], 'Asia/Shanghai')
})

test('folded lines are rejoined and a bare LF file is accepted', { skip: !runtime }, async () => {
  const { ics } = await load()
  const folded = calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-folded',
    'SUMMARY:很长的日程名称用来触发折行处理',
    'DTSTART:20260',
    ' 302T080000',
    'END:VEVENT',
    'END:VCALENDAR',
  )
  assert.equal(ics.parseIcs(folded).events[0].start, '2026-03-02T08:00')
  const bare = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:fixture-lf', 'SUMMARY:换行', 'DTSTART:20260304T100000', 'END:VEVENT', 'END:VCALENDAR', ''].join('\n')
  const parsed = ics.parseIcs(bare)
  assert.equal(parsed.events.length, 1)
  assert.equal(parsed.events[0].title, '换行')
  assert.equal(parsed.events[0].start, '2026-03-04T10:00')
})

test('escaped text is unescaped, and escaped again on the way out', { skip: !runtime }, async () => {
  const { ics } = await load()
  const title = '数据结构, 上机; 与实验\\练习'
  const { events } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-escaped',
    'SUMMARY:数据结构\\, 上机\\; 与实验\\\\练习',
    'DESCRIPTION:第一行\\n第二行',
    'DTSTART:20260302T080000',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.equal(events[0].title, title)
  assert.equal(events[0].description, '第一行\n第二行')
  const text = ics.buildIcs({ events: [{ ...events[0], source: undefined }] })
  assert.match(text, /SUMMARY:数据结构\\, 上机\\; 与实验\\\\练习/)
  assert.match(text, /DESCRIPTION:第一行\\n第二行/)
  assert.equal(ics.parseIcs(text).events[0].title, title)
})

test('a weekly RRULE inside the subset becomes a recurrence', { skip: !runtime }, async () => {
  const { ics, model } = await load()
  const { events, degraded } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-rule',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=8;BYDAY=MO,WE',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.deepEqual(degraded, [])
  assert.deepEqual(events[0].recurrence, { freq: 'weekly', interval: 2, count: 8, byDay: ['mo', 'we'] })
  assert.doesNotThrow(() => model.EventSchema.parse(events[0]))

  const until = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-until',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'RRULE:FREQ=WEEKLY;UNTIL=20260630',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.deepEqual(until.events[0].recurrence, { freq: 'weekly', until: '2026-06-30' })
})

test('a rule outside the subset is kept as text, not dropped', { skip: !runtime }, async () => {
  const { ics, model } = await load()
  const { events, degraded } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-monthly',
    'SUMMARY:每月例会',
    'DTSTART:20260302T080000',
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=1',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.equal(events[0].recurrence, undefined)
  assert.equal(events[0].extensions.RRULE, 'FREQ=MONTHLY;BYMONTHDAY=1')
  assert.equal(degraded.length, 1)
  assert.match(degraded[0].reason, /unsupported frequency MONTHLY/)
  assert.equal(degraded[0].uid, 'fixture-monthly')
  assert.doesNotThrow(() => model.EventSchema.parse(events[0]))
})

test('EXDATE becomes exceptions, in every form a file may use', { skip: !runtime }, async () => {
  const { ics } = await load()
  const { events } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-exdate',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'RRULE:FREQ=WEEKLY;COUNT=16',
    'EXDATE:20260316T080000,20260323T080000',
    'EXDATE;VALUE=DATE:20260406',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.deepEqual(events[0].exceptions, ['2026-03-16', '2026-03-23', '2026-04-06'])
})

test('RECURRENCE-ID keeps only the fields that changed', { skip: !runtime }, async () => {
  const { ics, model } = await load()
  const { events } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-moved',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'DTEND:20260302T093500',
    'LOCATION:理科楼 305',
    'RRULE:FREQ=WEEKLY;COUNT=16',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-moved',
    'RECURRENCE-ID:20260309T080000',
    'SUMMARY:数据结构',
    'DTSTART:20260313T100000',
    'DTEND:20260313T113500',
    'LOCATION:文史楼 202',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].overrides, [
    { date: '2026-03-09', start: '2026-03-13T10:00', end: '2026-03-13T11:35', location: '文史楼 202' },
  ])
  // The title was unchanged, so it is inherited rather than pinned.
  assert.equal(events[0].overrides[0].title, undefined)
  assert.doesNotThrow(() => model.EventSchema.parse(events[0]))
})

test('a cancellation is an exception, not an event', { skip: !runtime }, async () => {
  const { ics } = await load()
  const { events } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-cancelled',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'RRULE:FREQ=WEEKLY;COUNT=16',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-cancelled',
    'RECURRENCE-ID:20260316T080000',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.equal(events.length, 1)
  assert.deepEqual(events[0].exceptions, ['2026-03-16'])
  assert.equal(events[0].overrides, undefined)
})

test('an override without its series is still an entry', { skip: !runtime }, async () => {
  const { ics } = await load()
  const { events, skipped } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-orphan',
    'RECURRENCE-ID:20260309T080000',
    'SUMMARY:补课 · 高等数学',
    'DTSTART:20260312T133000',
    'LOCATION:文史楼 201',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.deepEqual(skipped, [])
  assert.equal(events.length, 1)
  assert.equal(events[0].start, '2026-03-12T13:30')
  assert.equal(events[0].title, '补课 · 高等数学')
  assert.equal(events[0].overrides, undefined)
})

test('course properties of an earlier shape are read and dropped', { skip: !runtime }, async () => {
  const { ics, model } = await load()
  const { events } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-course',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'X-EDUWORK-COURSE-ID:course-cs-1',
    'X-EDUWORK-COURSE-NAME:数据结构',
    'X-EDUWORK-COURSE-TEACHER:张老师',
    'X-EDUWORK-COURSE-DEFAULT-LOCATION:理科楼 305',
    'X-EDUWORK-NOTE:实验课在 305',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.equal(events.length, 1)
  assert.equal('courseId' in events[0], false)
  // Not parked in the preserved area either: a round trip should not carry an
  // entity this module no longer has.
  assert.deepEqual(events[0].extensions, {})
  assert.doesNotThrow(() => model.EventSchema.parse(events[0]))
  const text = ics.buildIcs({ events })
  for (const name of ['X-EDUWORK-COURSE-ID', 'X-EDUWORK-COURSE-NAME', 'X-EDUWORK-COURSE-TEACHER', 'X-EDUWORK-COURSE-DEFAULT-LOCATION', 'X-EDUWORK-NOTE']) {
    assert.equal(text.includes(name), false, `${name} should not be written back`)
  }
})

test('a calendar-level catalogue is ignored rather than carried on', { skip: !runtime }, async () => {
  const { ics } = await load()
  const source = calendar(
    ...WRAPPER,
    `X-EDUWORK-COURSES:${ics.escapeText(JSON.stringify([{ id: 'course-cs-1', name: '数据结构' }]))}`,
    'BEGIN:VEVENT',
    'UID:fixture-course',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'X-EDUWORK-COURSE-ID:course-cs-1',
    'END:VEVENT',
    'END:VCALENDAR',
  )
  const { events, skipped } = ics.parseIcs(source)
  assert.deepEqual(skipped, [])
  assert.equal(events.length, 1)
  assert.equal(ics.buildIcs({ events }).includes('X-EDUWORK-COURSES'), false)
})

test('unknown properties and unplaceable events are reported, never dropped silently', { skip: !runtime }, async () => {
  const { ics, model } = await load()
  const { events, skipped } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-extra',
    'SUMMARY:带扩展的事件',
    'DTSTART:20260302T080000',
    'X-FOO-BAR:kept as it came',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-nowhere',
    'SUMMARY:没有开始时间',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:fixture-dropped',
    'SUMMARY:整条取消',
    'DTSTART:20260305T080000',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  assert.equal(events.length, 1)
  assert.equal(events[0].extensions['X-FOO-BAR'], 'kept as it came')
  assert.doesNotThrow(() => model.EventSchema.parse(events[0]))
  assert.deepEqual(skipped, [
    { uid: 'fixture-nowhere', reason: 'a VEVENT without a readable DTSTART cannot be placed' },
    { uid: 'fixture-dropped', reason: 'the event is cancelled' },
  ])
})

test('exported text is well formed: CRLF, folded at 75 octets, escaped', { skip: !runtime }, async () => {
  const { ics } = await load()
  const title = '很长的日程名称，用来确认折行不会把一个汉字切成两半，也不会超过七十五个八位组'
  const text = ics.buildIcs({
    events: [{
      uid: 'fixture-1',
      title,
      start: '2026-03-02T08:00',
      end: '2026-03-02T09:35',
      location: '理科楼 305, 三楼',
      recurrence: { freq: 'weekly', count: 16, byDay: ['mo', 'we'] },
      exceptions: ['2026-03-16'],
      source: 'manual',
      extensions: {},
    }],
  })
  assert.match(text, /\r\n/)
  assert.equal(/\n(?!\r)/.test(text) === false || !text.includes('\n\n'), true)
  const physical = text.split('\r\n')
  assert.equal(physical.at(-1), '')
  assert.ok(physical.some(line => line.startsWith(' ')), 'a long line should have been folded')
  for (const line of physical) {
    assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line over 75 octets: ${JSON.stringify(line)}`)
    // A continuation line is content of the property above it, so it is the
    // lines that begin a property that have to look like one.
    if (line && !line.startsWith(' ')) assert.match(line, /^[A-Za-z0-9-]+(;[^:]*)?:/)
  }
  const lines = ics.unfoldLines(text)
  assert.ok(lines.includes('VERSION:2.0'))
  assert.match(lines.find(line => line.startsWith('PRODID:')), /EduWork/)
  assert.equal(lines.find(line => line.startsWith('SUMMARY:')), `SUMMARY:${ics.escapeText(title)}`)
  assert.equal(lines.find(line => line.startsWith('DTSTART')), 'DTSTART:20260302T080000')
  assert.equal(lines.find(line => line.startsWith('EXDATE')), 'EXDATE:20260316T080000')
  assert.equal(lines.find(line => line.startsWith('RRULE')), 'RRULE:FREQ=WEEKLY;COUNT=16;BYDAY=MO,WE')
  assert.equal(lines.find(line => line.startsWith('LOCATION')), `LOCATION:${ics.escapeText('理科楼 305, 三楼')}`)
})

test('an empty calendar is valid in both directions', { skip: !runtime }, async () => {
  const { ics } = await load()
  const text = ics.buildIcs({ events: [] })
  assert.deepEqual(ics.parseIcs(text), { events: [], skipped: [], degraded: [] })
})

test('a round trip through ICS changes nothing it understood', { skip: !runtime }, async () => {
  const { ics, model } = await load()
  const events = [
    {
      uid: 'fixture-series',
      title: '数据结构',
      start: '2026-03-02T08:00',
      end: '2026-03-02T09:35',
      location: '理科楼 305',
      description: '第 1 周\n带上电脑',
      recurrence: { freq: 'weekly', interval: 1, count: 16, byDay: ['mo', 'we'] },
      exceptions: ['2026-03-16', '2026-03-23'],
      overrides: [{ date: '2026-03-09', start: '2026-03-13T10:00', location: '文史楼 202' }],
      source: 'manual',
      extensions: { 'X-FOO-BAR': 'kept', RRULE: undefined },
    },
    {
      uid: 'fixture-monthly',
      title: '每月例会',
      start: '2026-03-02T10:00',
      source: 'manual',
      extensions: { RRULE: 'FREQ=MONTHLY;BYMONTHDAY=1' },
    },
    {
      uid: 'fixture-allday',
      title: '校运动会',
      start: '2026-03-20',
      end: '2026-03-22',
      source: 'manual',
      extensions: {},
    },
  ].map(event => {
    const clean = { ...event }
    if (clean.extensions?.RRULE === undefined) delete clean.extensions.RRULE
    return model.normalizeEvent(clean)
  })

  const text = ics.buildIcs({ events })
  const parsed = ics.parseIcs(text)
  assert.deepEqual(parsed.skipped, [])
  assert.deepEqual(parsed.degraded.map(entry => entry.uid), ['fixture-monthly'])
  const before = events.map(event => model.normalizeEvent(event))
  const after = parsed.events
    .map(event => model.normalizeEvent({ ...event, source: 'manual' }))
    .sort((left, right) => left.uid.localeCompare(right.uid))
  assert.deepEqual(after, [...before].sort((left, right) => left.uid.localeCompare(right.uid)))

  // And the expansion agrees with what the original records produce, which is
  // what a re-import has to preserve in the end.
  const range = { from: '2026-03-01', to: '2026-04-30' }
  for (const event of before) {
    const match = after.find(candidate => candidate.uid === event.uid)
    assert.deepEqual(
      model.occurrencesOf(match, range).map(occurrence => [occurrence.occurrenceDate, occurrence.start, occurrence.end, occurrence.location]),
      model.occurrencesOf(event, range).map(occurrence => [occurrence.occurrenceDate, occurrence.start, occurrence.end, occurrence.location]),
      `occurrences of ${event.uid} differ after a round trip`,
    )
  }
})

test('a date-only UNTIL keeps meaning the end of that day', { skip: !runtime }, async () => {
  const { ics, model } = await load()
  const { events } = ics.parseIcs(calendar(
    ...WRAPPER,
    'BEGIN:VEVENT',
    'UID:fixture-until',
    'SUMMARY:数据结构',
    'DTSTART:20260302T080000',
    'RRULE:FREQ=WEEKLY;UNTIL=20260316',
    'END:VEVENT',
    'END:VCALENDAR',
  ))
  const range = { from: '2026-03-01', to: '2026-04-30' }
  const text = ics.buildIcs({ events })
  const [again] = ics.parseIcs(text).events
  assert.deepEqual(
    model.occurrencesOf(again, range).map(occurrence => occurrence.occurrenceDate),
    model.occurrencesOf(events[0], range).map(occurrence => occurrence.occurrenceDate),
  )
})
