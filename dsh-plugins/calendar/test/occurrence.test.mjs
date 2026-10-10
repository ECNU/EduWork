// Occurrence expansion of the public contract: how a weekly series, its
// cancellations and its per-date overrides become the occurrences a week view
// renders. Pure model tests: no storage, no Host, no browser.
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

// 2026-03-02 is a Monday; every week below is written as Monday..Sunday.
const week = monday => ({ from: monday, to: shift(monday, 6) })
const shift = (date, days) => {
  const value = new Date(`${date}T00:00`)
  value.setDate(value.getDate() + days)
  const pad = number => String(number).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

/** The recurring fixture: one entry every Monday, 16 weeks from 2026-03-02. */
async function weeklyEvent(extra = {}) {
  const { normalizeEvent } = await loadModel()
  return normalizeEvent({
    uid: 'event-data-structure',
    title: '数据结构',
    start: '2026-03-02T08:00',
    end: '2026-03-02T09:35',
    location: '理科楼 305',
    recurrence: { freq: 'weekly', count: 16 },
    ...extra,
  })
}

test('an occurrence keeps the days its record spans', { skip: !runtime }, async () => {
  const { normalizeEvent, occurrencesOf } = await loadModel()
  // A whole-day record covering three days, repeating: each occurrence carries the
  // same span rather than collapsing its end onto its own start date.
  const holiday = normalizeEvent({
    uid: 'event-holiday',
    title: '假期',
    start: '2026-03-02',
    end: '2026-03-04',
    recurrence: { freq: 'weekly', count: 3 },
  })
  assert.deepEqual(
    occurrencesOf(holiday, week('2026-03-16')).map(occurrence => [occurrence.start, occurrence.end]),
    [['2026-03-16', '2026-03-18']],
  )
  // A session that runs past midnight ends on the next day, not at one in the
  // morning of the day it started.
  const night = normalizeEvent({ uid: 'event-night', title: '夜间整理', start: '2026-03-02T22:00', end: '2026-03-03T01:00' })
  assert.deepEqual(
    occurrencesOf(night, week('2026-03-02')).map(occurrence => occurrence.end),
    ['2026-03-03T01:00'],
  )
})

test('a weekly series repeats in every week of the window', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent()
  const first = occurrencesOf(event, week('2026-03-02'))
  const third = occurrencesOf(event, week('2026-03-16'))
  assert.deepEqual(first.map(occurrence => occurrence.start), ['2026-03-02T08:00'])
  assert.deepEqual(third.map(occurrence => occurrence.start), ['2026-03-16T08:00'])
  assert.equal(third[0].end, '2026-03-16T09:35')
  assert.equal(third[0].occurrenceDate, '2026-03-16')
  assert.equal(third[0].occurrenceId, 'event-data-structure#2026-03-16')
  assert.equal(third[0].location, '理科楼 305')
  assert.equal('overridden' in third[0], false)
})

test('an occurrence carries no series bookkeeping', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent({ exceptions: ['2026-03-09'], overrides: [{ date: '2026-03-16', location: '文史楼 201' }] })
  const [occurrence] = occurrencesOf(event, week('2026-03-16'))
  assert.equal('overrides' in occurrence, false)
  assert.equal('exceptions' in occurrence, false)
  assert.equal(occurrence.recurrence.freq, 'weekly')
})

test('interval skips whole weeks', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent({ recurrence: { freq: 'weekly', interval: 2, count: 8 } })
  assert.deepEqual(occurrencesOf(event, week('2026-03-02')).map(o => o.start), ['2026-03-02T08:00'])
  assert.deepEqual(occurrencesOf(event, week('2026-03-09')), [])
  assert.deepEqual(occurrencesOf(event, week('2026-03-16')).map(o => o.start), ['2026-03-16T08:00'])
})

test('byDay produces every listed weekday and count stops the series', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent({ recurrence: { freq: 'weekly', count: 4, byDay: ['mo', 'we'] } })
  const span = { from: '2026-03-02', to: '2026-03-15' }
  assert.deepEqual(occurrencesOf(event, span).map(o => o.start), [
    '2026-03-02T08:00',
    '2026-03-04T08:00',
    '2026-03-09T08:00',
    '2026-03-11T08:00',
  ])
  assert.deepEqual(occurrencesOf(event, week('2026-03-16')), [])
})

test('until ends the series, with or without a time', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const dated = await weeklyEvent({ recurrence: { freq: 'weekly', until: '2026-03-16' } })
  assert.equal(occurrencesOf(dated, week('2026-03-16')).length, 1)
  assert.deepEqual(occurrencesOf(dated, week('2026-03-23')), [])
  const beforeStart = await weeklyEvent({ recurrence: { freq: 'weekly', until: '2026-03-16T07:00' } })
  assert.deepEqual(occurrencesOf(beforeStart, week('2026-03-16')), [])
  const afterStart = await weeklyEvent({ recurrence: { freq: 'weekly', until: '2026-03-16T09:00' } })
  assert.equal(occurrencesOf(afterStart, week('2026-03-16')).length, 1)
})

test('exceptions cancel one date only', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent({ exceptions: ['2026-03-09'] })
  assert.deepEqual(occurrencesOf(event, week('2026-03-09')), [])
  assert.equal(occurrencesOf(event, week('2026-03-02')).length, 1)
  assert.equal(occurrencesOf(event, week('2026-03-16')).length, 1)
  const withTime = await weeklyEvent({ exceptions: ['2026-03-09T08:00'] })
  assert.deepEqual(occurrencesOf(withTime, week('2026-03-09')), [])
})

test('a single event yields one occurrence keyed by its own date', { skip: !runtime }, async () => {
  const { normalizeEvent, occurrencesOf } = await loadModel()
  const event = normalizeEvent({ uid: 'event-fixture-1', title: '示例讲座', start: '2026-03-04T14:00' })
  const [occurrence] = occurrencesOf(event, week('2026-03-02'))
  assert.equal(occurrence.occurrenceId, 'event-fixture-1#2026-03-04')
  assert.equal(occurrence.occurrenceDate, '2026-03-04')
  assert.equal('end' in occurrence, false)
  assert.deepEqual(occurrencesOf(event, week('2026-03-09')), [])
})

test('a whole-day series repeats without a clock', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent({
    uid: 'event-fixture-allday',
    title: '校园跑',
    start: '2026-03-06',
    end: undefined,
    location: undefined,
    recurrence: { freq: 'weekly', count: 3 },
  })
  assert.deepEqual(occurrencesOf(event, { from: '2026-03-06', to: '2026-03-20' }).map(o => o.start), ['2026-03-06', '2026-03-13', '2026-03-20'])
})

test('an override moves and relocates exactly one occurrence', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent({
    overrides: [{ date: '2026-03-09', start: '2026-03-13T10:00', end: '2026-03-13T11:35', location: '文史楼 201' }],
  })
  const target = occurrencesOf(event, week('2026-03-09'))
  assert.deepEqual(target.map(o => o.start), ['2026-03-13T10:00'])
  assert.equal(target[0].end, '2026-03-13T11:35')
  assert.equal(target[0].location, '文史楼 201')
  assert.equal(target[0].overridden, true)
  assert.equal(target[0].occurrenceId, 'event-data-structure#2026-03-09')
  assert.equal(target[0].occurrenceDate, '2026-03-09')
  assert.deepEqual(occurrencesOf(event, week('2026-03-16')).map(o => o.occurrenceId), ['event-data-structure#2026-03-16'])
})

test('an override that only changes a room keeps the original date and end', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent({ overrides: [{ date: '2026-03-09', location: '文史楼 201' }] })
  const [occurrence] = occurrencesOf(event, week('2026-03-09'))
  assert.equal(occurrence.start, '2026-03-09T08:00')
  assert.equal(occurrence.end, '2026-03-09T09:35')
  assert.equal(occurrence.location, '文史楼 201')
  assert.equal(occurrence.overridden, true)
})

test('an override moved weeks away is still found there', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  // A short series, so the target week holds the moved entry and nothing else.
  const event = await weeklyEvent({
    recurrence: { freq: 'weekly', count: 2 },
    overrides: [{ date: '2026-03-09', start: '2026-05-04T08:00', end: '2026-05-04T09:35' }],
  })
  assert.deepEqual(occurrencesOf(event, week('2026-03-09')), [])
  const moved = occurrencesOf(event, week('2026-05-04'))
  assert.deepEqual(moved.map(o => o.occurrenceId), ['event-data-structure#2026-03-09'])
  assert.equal(moved[0].start, '2026-05-04T08:00')
  assert.equal(moved[0].overridden, true)
})

test('an entry moved onto a day the series already uses yields both', { skip: !runtime }, async () => {
  const { occurrencesOf } = await loadModel()
  const event = await weeklyEvent({
    recurrence: { freq: 'weekly', count: 16, byDay: ['mo', 'fr'] },
    overrides: [{ date: '2026-03-09', start: '2026-03-13T08:00', end: '2026-03-13T09:35' }],
  })
  const found = occurrencesOf(event, week('2026-03-09'))
  assert.deepEqual(found.map(o => o.occurrenceId), ['event-data-structure#2026-03-09', 'event-data-structure#2026-03-13'])
  assert.deepEqual(found.map(o => Boolean(o.overridden)), [true, false])
  assert.deepEqual(found.map(o => o.start), ['2026-03-13T08:00', '2026-03-13T08:00'])
})

test('overrides are validated: one per date, and never a no-op', { skip: !runtime }, async () => {
  const { normalizeEvent } = await loadModel()
  const base = { uid: 'event-data-structure', title: '数据结构', start: '2026-03-02T08:00' }
  assert.throws(
    () => normalizeEvent({ ...base, overrides: [{ date: '2026-03-09', location: 'A' }, { date: '2026-03-09', location: 'B' }] }),
    /overridden once/,
  )
  assert.throws(() => normalizeEvent({ ...base, overrides: [{ date: '2026-03-09' }] }), /change at least one field/)
  assert.throws(() => normalizeEvent({ ...base, overrides: [{ date: '2026-03-09', room: 'A' }] }), /Unrecognized key/)
})

test('many events come back ordered by start, then by key', { skip: !runtime }, async () => {
  const { normalizeEvent, occurrencesIn } = await loadModel()
  const lecture = normalizeEvent({ uid: 'event-fixture-lecture', title: '示例讲座', start: '2026-03-04T14:00' })
  const series = await weeklyEvent()
  const found = occurrencesIn([lecture, series], week('2026-03-02'))
  assert.deepEqual(found.map(occurrence => occurrence.occurrenceId), ['event-data-structure#2026-03-02', 'event-fixture-lecture#2026-03-04'])
})

test('a date-only upper bound covers the whole day', { skip: !runtime }, async () => {
  const { overlaps } = await loadModel()
  assert.equal(overlaps({ start: '2026-03-02T08:00', end: '2026-03-02T09:35' }, { from: '2026-03-02', to: '2026-03-02' }), true)
  assert.equal(overlaps({ start: '2026-03-02T08:00' }, { from: '2026-03-03', to: '2026-03-08' }), false)
  assert.equal(overlaps({ start: '2026-03-02', end: '2026-03-02' }, { from: '2026-03-02T10:00', to: '2026-03-02T11:00' }), true)
})
