// Geometry of the week grid: the axis window and the block placement.
//
// These are the decisions a reader sees but cannot check from the outside, so
// each one is pinned: the axis never moves while stepping weeks, side-by-side
// blocks are the overlap case, back-to-back lessons are not, and moving a start
// in the edit form carries the entry's length along with it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_DURATION, MINUTES_IN_DAY, dayWindow, layoutDay, layoutWeek, minutesOf, shiftedEnd } from '../src/layout.js'

const LESSON = (start, end, occurrenceId = start) => ({ occurrenceId, start, end })

test('shiftedEnd keeps the length of an entry whose start moved', () => {
  assert.equal(shiftedEnd('2026-10-05T19:00', '2026-10-05T08:00', '2026-10-05T09:35'), '2026-10-05T20:35')
  assert.equal(shiftedEnd('2026-10-05T08:30', '2026-10-05T08:00', '2026-10-05T08:45'), '2026-10-05T09:15', 'a quarter of an hour stays a quarter of an hour')
  assert.equal(shiftedEnd('2026-10-05T23:30', '2026-10-05T22:00', '2026-10-05T23:00'), '2026-10-06T00:30', 'a start near midnight carries into the next day')
  assert.equal(shiftedEnd('2026-10-08T22:00', '2026-10-05T22:00', '2026-10-06T01:00'), '2026-10-09T01:00', 'an entry that already crossed midnight keeps its three hours')
  assert.equal(shiftedEnd('2026-10-05T08:00', '2026-10-05T08:00', '2026-10-05T09:35'), '2026-10-05T09:35', 'an unchanged start is left alone')
  assert.equal(shiftedEnd('2026-10-06', '2026-10-05', '2026-10-07'), undefined, 'whole-day records have no clock to move')
  assert.equal(shiftedEnd('2026-10-05T08:00', '2026-10-05T08:00', ''), undefined)
})

test('minutesOf reads a clock and rejects everything else', () => {
  assert.equal(minutesOf('2026-10-05T08:30'), 8 * 60 + 30)
  assert.equal(minutesOf('2026-10-05T00:00'), 0)
  assert.equal(minutesOf('2026-10-05T23:59'), 23 * 60 + 59)
  assert.equal(minutesOf('2026-10-05'), undefined, 'a whole-day value has no clock')
  assert.equal(minutesOf('2026-10-05T8:30'), undefined, 'the clock is fixed-width')
  assert.equal(minutesOf('2026-10-05T25:00'), undefined, 'hours outside a day are not a clock')
  assert.equal(minutesOf('2026-10-05T08:75'), undefined)
  assert.equal(minutesOf(undefined), undefined)
  assert.equal(minutesOf(830), undefined)
})

test('dayWindow keeps the working day visible and widens for the data', () => {
  assert.deepEqual(dayWindow([]), { start: 8 * 60, end: 20 * 60 }, 'an empty week keeps the default axis')
  assert.deepEqual(
    dayWindow([LESSON('2026-10-05T10:00', '2026-10-05T11:35')]),
    { start: 8 * 60, end: 20 * 60 },
    'lessons inside the working day do not move the axis',
  )
  assert.deepEqual(
    dayWindow([LESSON('2026-10-05T07:00', '2026-10-05T07:45')]),
    { start: 6 * 60, end: 20 * 60 },
    'an early lesson widens the axis and is rounded out to the hour',
  )
  assert.deepEqual(
    dayWindow([LESSON('2026-10-05T19:00', '2026-10-05T21:20')]),
    { start: 8 * 60, end: 22 * 60 },
    'a late lesson widens it the other way',
  )
})

test('dayWindow ignores all-day entries and counts a missing end', () => {
  const window = dayWindow([
    LESSON('2026-10-05', '2026-10-06'),
    LESSON('2026-10-06T21:00', undefined),
  ])
  assert.deepEqual(
    window,
    { start: 8 * 60, end: 23 * 60 },
    `the all-day entry has no clock to place, the ${DEFAULT_DURATION}-minute assumption widens the axis`,
  )
})

test('dayWindow pads a side only when the data leaves it', () => {
  assert.deepEqual(
    dayWindow([LESSON('2026-10-05T08:00', '2026-10-05T09:35')]),
    { start: 8 * 60, end: 20 * 60 },
    'padding alone must not push the axis to 07:00, or every week would start half an hour early for nothing',
  )
  assert.deepEqual(
    dayWindow([LESSON('2026-10-05T19:30', '2026-10-05T20:00')]),
    { start: 8 * 60, end: 20 * 60 },
    'an end exactly on the default bound does not widen it either',
  )
})

test('layoutDay places one block at its clock', () => {
  const placed = layoutDay([LESSON('2026-10-05T10:00', '2026-10-05T11:35')])
  assert.equal(placed.length, 1)
  assert.equal(placed[0].top, 10 * 60)
  assert.equal(placed[0].height, 95)
  assert.equal(placed[0].lane, 0)
  assert.equal(placed[0].lanes, 1)
})

test('layoutDay keeps back-to-back lessons full width', () => {
  const placed = layoutDay([
    LESSON('2026-10-05T08:00', '2026-10-05T09:35', 'a'),
    LESSON('2026-10-05T09:35', '2026-10-05T11:10', 'b'),
  ])
  assert.deepEqual(placed.map(entry => entry.lanes), [1, 1], 'touching blocks do not overlap')
  assert.deepEqual(placed.map(entry => entry.lane), [0, 0])
})

test('layoutDay splits the width of overlapping blocks', () => {
  const placed = layoutDay([
    LESSON('2026-10-05T08:00', '2026-10-05T09:35', 'a'),
    LESSON('2026-10-05T08:30', '2026-10-05T10:05', 'b'),
  ])
  assert.deepEqual(placed.map(entry => entry.lanes), [2, 2])
  assert.deepEqual(placed.map(entry => entry.lane), [0, 1])
})

test('layoutDay opens a new cluster when the overlap ends', () => {
  const placed = layoutDay([
    LESSON('2026-10-05T08:00', '2026-10-05T09:00', 'a'),
    LESSON('2026-10-05T08:30', '2026-10-05T09:30', 'b'),
    LESSON('2026-10-05T09:30', '2026-10-05T10:30', 'c'),
  ])
  assert.deepEqual(placed.map(entry => entry.lane), [0, 1, 0])
  assert.deepEqual(placed.map(entry => entry.lanes), [2, 2, 1], 'the third lesson starts when the cluster ends')
})

test('layoutDay reuses a lane freed inside one cluster', () => {
  const placed = layoutDay([
    LESSON('2026-10-05T08:00', '2026-10-05T09:00', 'a'),
    LESSON('2026-10-05T08:30', '2026-10-05T10:30', 'b'),
    LESSON('2026-10-05T09:00', '2026-10-05T09:30', 'c'),
  ])
  assert.deepEqual(placed.map(entry => entry.lane), [0, 1, 0], 'the short lesson takes the lane the first one freed')
  assert.deepEqual(placed.map(entry => entry.lanes), [2, 2, 2])
})

test('layoutDay keeps a three-way overlap readable', () => {
  const placed = layoutDay([
    LESSON('2026-10-05T10:00', '2026-10-05T12:00', 'a'),
    LESSON('2026-10-05T10:15', '2026-10-05T11:00', 'b'),
    LESSON('2026-10-05T10:30', '2026-10-05T11:15', 'c'),
  ])
  assert.deepEqual(placed.map(entry => entry.lanes), [3, 3, 3])
  assert.deepEqual(placed.map(entry => entry.lane), [0, 1, 2])
})

test('layoutDay gives a short block a clickable height and clamps to the day', () => {
  const placed = layoutDay([
    LESSON('2026-10-05T10:00', '2026-10-05T10:05', 'a'),
    LESSON('2026-10-05T23:30', '2026-10-06T01:00', 'b'),
  ])
  assert.equal(placed[0].height, 22, 'the minimum height applies, the clock does not move')
  assert.equal(placed[0].top, 10 * 60)
  assert.equal(placed[1].end, MINUTES_IN_DAY, 'a block crossing midnight ends with the day')
})

test('layoutDay sorts by start and skips entries without a clock', () => {
  const placed = layoutDay([
    LESSON('2026-10-05', '2026-10-06', 'whole-day'),
    LESSON('2026-10-05T14:00', '2026-10-05T15:00', 'late'),
    LESSON('2026-10-05T09:00', '2026-10-05T10:00', 'early'),
  ])
  assert.deepEqual(placed.map(entry => entry.occurrence.occurrenceId), ['early', 'late'], 'a value without a clock is not on the axis')
})

test('layoutDay assumes a duration for a missing end', () => {
  const placed = layoutDay([LESSON('2026-10-05T18:00', undefined)])
  assert.equal(placed[0].height, DEFAULT_DURATION)
})

test('layoutWeek keeps the same clock on different days out of each other way', () => {
  const week = layoutWeek([
    LESSON('2026-10-05T08:00', '2026-10-05T09:35', 'monday'),
    LESSON('2026-10-07T08:00', '2026-10-07T09:35', 'wednesday'),
  ])
  assert.deepEqual([...week.keys()], ['2026-10-05', '2026-10-07'])
  for (const day of week.values()) {
    assert.equal(day.length, 1)
    assert.equal(day[0].lane, 0, 'a lesson on another day is not a conflict')
    assert.equal(day[0].lanes, 1, 'so it keeps the full width of its column')
  }
})

test('layoutWeek still splits a same-day overlap and skips entries without a date', () => {
  const week = layoutWeek([
    LESSON('2026-10-05T10:00', '2026-10-05T11:35', 'a'),
    LESSON('2026-10-05T10:30', '2026-10-05T12:00', 'b'),
    { occurrenceId: 'no-date', start: undefined, end: undefined },
  ])
  assert.deepEqual([...week.keys()], ['2026-10-05'])
  assert.deepEqual(week.get('2026-10-05').map(entry => entry.lanes), [2, 2])
  assert.deepEqual(week.get('2026-10-05').map(entry => entry.lane), [0, 1])
})
