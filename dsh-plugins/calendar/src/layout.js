// View geometry of the week grid, plus the one piece of clock arithmetic the edit
// form needs: pure arithmetic, no DOM and no React.
//
// The week view is a time axis, so every timed occurrence becomes a block whose
// top and height come from its clock, and blocks that overlap inside one day
// share that day's width. That arithmetic is the part of the view worth testing
// on its own, so it lives here; `src/client.ts` only scales and paints it.
//
// Every returned position is in minutes from local midnight, not pixels, so the
// same layout serves any row height and cannot disagree with the axis labels.

/** Minutes in a whole day; also the exclusive upper bound of the axis. */
export const MINUTES_IN_DAY = 24 * 60

/** Length given to an occurrence that carries no end, in minutes. */
export const DEFAULT_DURATION = 45

const pad2 = value => String(value).padStart(2, '0')

/** Local midnight of a `YYYY-MM-DD` date. */
function parseDay(date) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** Whole days from one local date to another. */
function dayGap(from, to) {
  return Math.round((parseDay(to) - parseDay(from)) / 86400000)
}

/** The local `YYYY-MM-DD` date `days` away. */
function shiftDay(date, days) {
  const value = parseDay(date)
  value.setDate(value.getDate() + days)
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
}

/**
 * Minutes from local midnight of a local time string.
 * @param value - `YYYY-MM-DDTHH:mm`, or anything else.
 * @returns minutes in `[0, 1440)`, or `undefined` when the value carries no clock.
 */
export function minutesOf(value) {
  if (typeof value !== 'string' || value.length < 16) return undefined
  const hours = Number(value.slice(11, 13))
  const minutes = Number(value.slice(14, 16))
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return undefined
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined
  return hours * 60 + minutes
}

/**
 * The end that keeps an entry's length when only its start moved.
 *
 * An edit form that opens with both fields filled hands back an end that never
 * moved, so saving a new start on its own would keep the old clock time and can
 * finish before it begins. Carrying the span instead keeps a 90-minute entry 90
 * minutes long, and follows a start that crosses into another day.
 * @param start - New local start, `YYYY-MM-DDTHH:mm`.
 * @param from - Start the entry had.
 * @param to - End the entry had.
 * @returns Local end that keeps `to - from`, or `undefined` when a value has no clock.
 */
export function shiftedEnd(start, from, to) {
  const startMinutes = minutesOf(start)
  const fromMinutes = minutesOf(from)
  const toMinutes = minutesOf(to)
  if (startMinutes === undefined || fromMinutes === undefined || toMinutes === undefined) return undefined
  const length = dayGap(from.slice(0, 10), to.slice(0, 10)) * MINUTES_IN_DAY + (toMinutes - fromMinutes)
  const at = startMinutes + length
  const date = shiftDay(start.slice(0, 10), Math.floor(at / MINUTES_IN_DAY))
  const clock = ((at % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY
  return `${date}T${pad2(Math.floor(clock / 60))}:${pad2(clock % 60)}`
}

/**
 * Vertical bounds of the axis, in minutes.
 *
 * The default working day is always visible and the data may widen it, padded by
 * half an hour and rounded out to whole hours. Padding only applies to a side the
 * data actually leaves, so a week whose first lesson is at 08:00 still starts at
 * 08:00 instead of drifting to 07:00 to make room for padding it does not need.
 * Keeping a floor means the axis does not jump between weeks while the reader is
 * stepping through them.
 * @param occurrences - Occurrences of the visible days; whole-day ones carry no clock to place.
 * @param options - `from`/`to` are the guaranteed bounds, `pad` the slack, `step` the rounding.
 * @returns `{ start, end }` in minutes, `start < end`.
 */
export function dayWindow(occurrences, options = {}) {
  const from = options.from ?? 8 * 60
  const to = options.to ?? 20 * 60
  const pad = options.pad ?? 30
  const step = options.step ?? 60
  let first = Infinity
  let last = -Infinity
  for (const occurrence of occurrences ?? []) {
    const start = minutesOf(occurrence?.start)
    if (start === undefined) continue
    const end = minutesOf(occurrence?.end) ?? start + DEFAULT_DURATION
    first = Math.min(first, start)
    last = Math.max(last, end)
  }
  if (!Number.isFinite(first)) return { start: from, end: to }
  const start = first < from ? Math.max(0, floorTo(first - pad, step)) : from
  const end = last > to ? Math.min(MINUTES_IN_DAY, ceilTo(last + pad, step)) : to
  return { start, end }
}

/** Round down to a `step` grid, counting from midnight. */
function floorTo(minutes, step) {
  return Math.floor(minutes / step) * step
}

/** Round up to a `step` grid, counting from midnight. */
function ceilTo(minutes, step) {
  return Math.ceil(minutes / step) * step
}

/**
 * Place one day's timed occurrences.
 *
 * Blocks that overlap form a cluster and split the day's width between them;
 * a block starting no earlier than the last end of the current cluster opens a
 * new one and gets the full width, which is what keeps back-to-back lessons
 * readable. Lanes inside a cluster are assigned greedily: a block takes the
 * first lane free at its start.
 * @param occurrences - Occurrences of one day; entries without a clock are skipped.
 * @param options - `minHeight` keeps a very short block clickable, in minutes.
 * @returns one entry per timed occurrence, in start order, as
 *   `{ occurrence, start, end, top, height, lane, lanes }` in minutes.
 */
export function layoutDay(occurrences, options = {}) {
  const minHeight = options.minHeight ?? 22
  const items = []
  for (const occurrence of occurrences ?? []) {
    // A whole-day record (`DTSTART;VALUE=DATE`) has no clock, so the axis has no
    // slot for it: the week draws those in the day header instead, where they are
    // visible whatever the axis is scrolled to and claim no time of their own.
    const start = minutesOf(occurrence?.start)
    if (start === undefined) continue
    const rawEnd = minutesOf(occurrence?.end)
    // An end that is not after the start either crosses midnight or is a
    // zero-length record; the first runs to the end of the day, the second keeps
    // the minimum height without moving the clock.
    const end = rawEnd === undefined
      ? start + DEFAULT_DURATION
      : rawEnd > start
        ? rawEnd
        : rawEnd < start
          ? MINUTES_IN_DAY
          : start + 1
    items.push({ occurrence, start, end, lane: 0 })
  }
  items.sort((left, right) =>
    left.start - right.start
    || right.end - left.end
    || String(left.occurrence?.occurrenceId ?? '').localeCompare(String(right.occurrence?.occurrenceId ?? '')))

  const placed = []
  let cluster = []
  let clusterEnd = -Infinity
  const close = () => {
    if (cluster.length === 0) return
    const laneEnds = []
    for (const item of cluster) {
      let lane = laneEnds.findIndex(end => end <= item.start)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(item.end)
      } else {
        laneEnds[lane] = item.end
      }
      item.lane = lane
    }
    for (const item of cluster) {
      placed.push({
        occurrence: item.occurrence,
        start: item.start,
        end: item.end,
        top: item.start,
        height: Math.max(minHeight, item.end - item.start),
        lane: item.lane,
        lanes: laneEnds.length,
      })
    }
    cluster = []
  }
  for (const item of items) {
    if (cluster.length > 0 && item.start >= clusterEnd) close()
    cluster.push(item)
    clusterEnd = cluster.length === 1 ? item.end : Math.max(clusterEnd, item.end)
  }
  close()
  return placed
}

/**
 * Place a whole week, one day at a time.
 *
 * The date is part of a block's identity: two lessons that both start at 08:00
 * but fall on different weekdays are not in conflict and must not share lanes.
 * Callers hand in whatever the range query returned, so the grouping happens
 * here instead of being something every caller has to remember to do.
 * @param occurrences - Occurrences of the visible days.
 * @param options - forwarded to `layoutDay`.
 * @returns a `Map` from `YYYY-MM-DD` to that day's placed entries.
 */
export function layoutWeek(occurrences, options = {}) {
  const days = new Map()
  for (const occurrence of occurrences ?? []) {
    const date = String(occurrence?.start ?? '').slice(0, 10)
    if (date.length !== 10) continue
    const list = days.get(date)
    if (list) list.push(occurrence)
    else days.set(date, [occurrence])
  }
  const placed = new Map()
  for (const [date, list] of days) placed.set(date, layoutDay(list, options))
  return placed
}
