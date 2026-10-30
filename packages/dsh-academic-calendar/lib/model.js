// Academic calendar data and date semantics. No host or institution dependencies.
const DAY_MS = 24 * 60 * 60 * 1000

function dayIndex(date) {
  return Math.floor(Date.parse(date + 'T00:00:00Z') / DAY_MS)
}

function requireDate(value, what) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    throw new Error(`校历数据 ${what} 不是合法日期：${value}`)
  }
}

/** Week `n` of a term: seven days from `firstDay`, the last week cut at `lastDay`. */
export function weekOf(term, date) {
  if (!term.weekCount) return undefined
  const offset = dayIndex(date) - dayIndex(term.firstDay)
  if (offset < 0) return undefined
  const week = Math.floor(offset / 7) + 1
  if (week > term.weekCount || dayIndex(date) > dayIndex(term.lastDay)) return undefined
  return week
}

export function validateDataset(dataset) {
  if (dataset?.schemaVersion !== 2) throw new Error('校历数据 schemaVersion 必须为 2')
  if (typeof dataset.academicYear !== 'string' || !dataset.academicYear) throw new Error('校历数据缺少学年标识')
  if (dataset.revision !== undefined && (!Number.isSafeInteger(dataset.revision) || dataset.revision < 1)) throw new Error('校历 revision 必须是正整数')
  const termIds = new Set()
  const eventIds = new Set()
  // Terms and breaks tile the year and must not overlap each other; phases sit
  // inside their own term and are checked against their siblings only.
  const topLevel = []
  const checkTopLevel = (span, what) => {
    requireDate(span.firstDay, `${what}.firstDay`)
    requireDate(span.lastDay, `${what}.lastDay`)
    if (dayIndex(span.lastDay) < dayIndex(span.firstDay)) throw new Error(`校历数据 ${what} 结束日期早于开始日期`)
    for (const [owner, kind] of topLevel) {
      if (dayIndex(span.firstDay) <= owner.last && dayIndex(span.lastDay) >= owner.first) {
        throw new Error(`校历数据 ${what} 与 ${kind} 日期重叠`)
      }
    }
    topLevel.push([{ first: dayIndex(span.firstDay), last: dayIndex(span.lastDay) }, what])
  }
  if (!Array.isArray(dataset.terms) || dataset.terms.length === 0) throw new Error('校历数据缺少学期')
  for (const term of dataset.terms) {
    if (typeof term.id !== 'string' || !term.id) throw new Error('校历学期缺少 id')
    if (termIds.has(term.id)) throw new Error('校历学期 id 重复')
    termIds.add(term.id)
    if (typeof term.name !== 'string' || !term.name) throw new Error(`校历学期 ${term.id} 缺少名称`)
    // The marker keeps the short summer term on its quiet band now that the
    // official grid numbers its weeks and weekCount no longer distinguishes it.
    if (term.shortTerm !== undefined && typeof term.shortTerm !== 'boolean') throw new Error(`校历学期 ${term.id} 的 shortTerm 必须是布尔值`)
    checkTopLevel(term, `学期 ${term.id}`)
    // Weeks derive from firstDay in seven-day steps, and the panel matches a
    // week label to the Monday its row starts on; a term beginning on any
    // other day would number weeks nobody can display, so it fails here.
    if (new Date(Date.parse(term.firstDay + 'T00:00:00Z')).getUTCDay() !== 1) {
      throw new Error(`校历学期 ${term.id} 的 firstDay 必须是周一`)
    }
    if (term.weekCount !== undefined) {
      if (!Number.isSafeInteger(term.weekCount) || term.weekCount < 1) throw new Error(`校历学期 ${term.id} 的 weekCount 必须是正整数`)
      // A term's last week may be cut short by lastDay, so the count is the
      // covered span rounded up, never more and never less.
      const covered = (dayIndex(term.lastDay) - dayIndex(term.firstDay) + 1) / 7
      if (term.weekCount !== Math.ceil(covered - 1e-9)) throw new Error(`校历学期 ${term.id} 的 weekCount 与日期范围不符`)
    }
    if (!Array.isArray(term.phases) || term.phases.length === 0) throw new Error(`校历学期 ${term.id} 缺少阶段`)
    const phaseSpans = []
    for (const phase of term.phases) {
      if (!['teaching', 'examination'].includes(phase.kind)) throw new Error(`校历学期 ${term.id} 含未知阶段类型 ${phase.kind}`)
      requireDate(phase.firstDay, `学期 ${term.id} 阶段 ${phase.kind}.firstDay`)
      requireDate(phase.lastDay, `学期 ${term.id} 阶段 ${phase.kind}.lastDay`)
      if (phase.lastDay < phase.firstDay) throw new Error('校历阶段结束日期早于开始日期')
      if (dayIndex(phase.firstDay) < dayIndex(term.firstDay) || dayIndex(phase.lastDay) > dayIndex(term.lastDay)) {
        throw new Error(`校历学期 ${term.id} 阶段 ${phase.kind} 超出学期范围`)
      }
      for (const [owner] of phaseSpans) {
        if (dayIndex(phase.firstDay) <= owner.last && dayIndex(phase.lastDay) >= owner.first) {
          throw new Error(`校历学期 ${term.id} 的阶段 ${phase.kind} 与其他阶段重叠`)
        }
      }
      phaseSpans.push([{ first: dayIndex(phase.firstDay), last: dayIndex(phase.lastDay) }])
      if (phase.weeks !== undefined) {
        if (!Array.isArray(phase.weeks) || phase.weeks.length !== 2 || phase.weeks.some(value => !Number.isSafeInteger(value) || value < 1)) {
          throw new Error(`校历学期 ${term.id} 阶段 ${phase.kind} 的 weeks 必须是 [起, 止] 周号`)
        }
        if (!term.weekCount || phase.weeks[1] > term.weekCount) throw new Error(`校历学期 ${term.id} 阶段 ${phase.kind} 的周号超出 weekCount`)
        if (phase.weeks[1] < phase.weeks[0]) throw new Error(`校历学期 ${term.id} 阶段 ${phase.kind} 的周号区间颠倒`)
        if (dayIndex(phase.firstDay) !== dayIndex(term.firstDay) + (phase.weeks[0] - 1) * 7) {
          throw new Error(`校历学期 ${term.id} 阶段 ${phase.kind} 的起始日期与周号不符`)
        }
        const naturalEnd = dayIndex(term.firstDay) + phase.weeks[1] * 7 - 1
        if (dayIndex(phase.lastDay) < naturalEnd - 6) throw new Error('校历阶段结束日期未到最后一周')
        if (dayIndex(phase.lastDay) > naturalEnd) {
          throw new Error(`校历学期 ${term.id} 阶段 ${phase.kind} 的结束日期超出周号范围`)
        }
      }
    }
  }
  for (const rest of dataset.breaks ?? []) {
    if (typeof rest.id !== 'string' || !rest.id || typeof rest.name !== 'string' || !rest.name) throw new Error('校历假期缺少 id 或名称')
    checkTopLevel(rest, `假期 ${rest.id}`)
  }
  for (const event of dataset.events ?? []) {
    if (typeof event.uid !== 'string' || !event.uid || typeof event.title !== 'string' || !event.title) throw new Error('校历事项缺少 uid 或标题')
    if (eventIds.has(event.uid)) throw new Error('校历事项 uid 重复')
    eventIds.add(event.uid)
    requireDate(event.date, `事项 ${event.uid}.date`)
    // `lastDay` widens a matter to a range, `note` carries the official wording
    // (停课、放假以学校通知为准) onto the calendar entry.
    if (event.lastDay !== undefined) {
      requireDate(event.lastDay, `事项 ${event.uid}.lastDay`)
      if (dayIndex(event.lastDay) < dayIndex(event.date)) throw new Error(`校历事项 ${event.uid} 的 lastDay 早于 date`)
    }
    if (event.note !== undefined && typeof event.note !== 'string') throw new Error(`校历事项 ${event.uid} 的 note 必须是文本`)
  }
  return dataset
}

/** What the official calendar says about one local date; unstated days are `unspecified`. */
export function describeDate(dataset, date) {
  requireDate(date, '查询日期')
  const answer = { date, academicYear: dataset.academicYear, status: 'unspecified' }
  for (const rest of dataset.breaks ?? []) {
    if (dayIndex(date) >= dayIndex(rest.firstDay) && dayIndex(date) <= dayIndex(rest.lastDay)) {
      return { ...answer, status: 'break', break: { id: rest.id, name: rest.name } }
    }
  }
  for (const term of dataset.terms) {
    if (dayIndex(date) < dayIndex(term.firstDay) || dayIndex(date) > dayIndex(term.lastDay)) continue
    const week = weekOf(term, date)
    const phase = term.phases.find(candidate => {
      const span = phaseRange(term, candidate)
      return date >= span.firstDay && date <= span.lastDay
    })
    return {
      ...answer,
      status: 'term',
      term: { id: term.id, name: term.name },
      ...(week === undefined ? {} : { week, weekParity: week % 2 === 1 ? '单周' : '双周' }),
      ...(phase ? { phase: { kind: phase.kind, name: phase.name } } : {}),
    }
  }
  return answer
}

// A numbered phase covers complete teaching weeks, capped by its term.
// Keep source dates intact for attribution; date queries and views share this rule.
export function phaseRange(term, phase) {
  if (!phase.weeks) return { firstDay: phase.firstDay, lastDay: phase.lastDay }
  return { firstDay: shiftDay(term.firstDay, (phase.weeks[0] - 1) * 7),
    lastDay: [shiftDay(term.firstDay, phase.weeks[1] * 7 - 1), term.lastDay].sort()[0] }
}

function shiftDay(date, days) {
  return new Date(dayIndex(date) * DAY_MS + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The dataset as the public calendar's annotation contract reads it: week
 * labels for every numbered week overlapping the range, and one band per
 * phase or break. Ordinary teaching weeks carry no tone — the semester is the
 * background — while examinations highlight and breaks and the short summer
 * term sit quiet, so the coloured stretches are the ones a reader plans around.
 * Weeks the official calendar never numbered are not invented here; the short
 * summer term, which the grid numbers 1 to 4, gets its numbers like any term.
 */
export function annotationsForDataset(dataset, range = {}) {
  const from = typeof range.from === 'string' ? range.from : '0000-01-01'
  const to = typeof range.to === 'string' ? range.to : '9999-12-31'
  const overlaps = (firstDay, lastDay) => firstDay <= to && lastDay >= from
  const weeks = []
  const spans = []
  for (const term of dataset.terms) {
    for (const phase of term.phases) {
      const span = phaseRange(term, phase)
      if (!overlaps(span.firstDay, span.lastDay)) continue
      const shortTerm = term.shortTerm === true
      const tone = phase.kind === 'examination' ? 'highlight' : shortTerm ? 'quiet' : 'neutral'
      // A teaching phase names the term it belongs to — that is the context a
      // reader cannot see otherwise. An examination band carries the term too:
      // the weeks it covers label themselves 考试周, so without the term in the
      // band an exam week loses the semester it belongs to. Breaks and the
      // short term speak for themselves and keep their own short names.
      const text = phase.kind === 'teaching' && !shortTerm
        ? term.name
        : phase.kind === 'examination'
          ? `${term.name} · ${phase.name}`
          : term.name
      spans.push({
        firstDay: span.firstDay < from ? from : span.firstDay,
        lastDay: span.lastDay > to ? to : span.lastDay,
        text: `${dataset.academicYear} ${text}`.slice(0, 32),
        ...(tone === 'neutral' ? {} : { tone }),
      })
    }
    if (!term.weekCount) continue
    for (let week = 1; week <= term.weekCount; week++) {
      const firstDay = shiftDay(term.firstDay, (week - 1) * 7)
      const lastDay = week === term.weekCount ? term.lastDay : shiftDay(firstDay, 6)
      if (!overlaps(firstDay, lastDay)) continue
      const examination = term.phases.find(phase => phase.kind === 'examination' && phase.weeks && week >= phase.weeks[0] && week <= phase.weeks[1])
      weeks.push(examination
        ? { firstDay, text: `第 ${week} 周 · 考试周`, tone: 'highlight' }
        : { firstDay, text: `第 ${week} 周 · ${week % 2 === 1 ? '单周' : '双周'}` })
    }
  }
  for (const rest of dataset.breaks ?? []) {
    if (!overlaps(rest.firstDay, rest.lastDay)) continue
    spans.push({
      firstDay: rest.firstDay < from ? from : rest.firstDay,
      lastDay: rest.lastDay > to ? to : rest.lastDay,
      text: rest.name,
      tone: 'quiet',
    })
  }
  return { weeks, spans }
}

/**
 * The dataset's whole-school matters as public-calendar events: date-only
 * starts make them all-day, a `lastDay` widens one to a range, and `note`
 * becomes the entry's description. Terms, weeks and phases stay annotations —
 * those are the background every day already knows — while a sports meet or a
 * registration day is a happening someone plans around, exactly what an entry
 * is for. Festival entries mark the day the calendar names, never an inferred
 * holiday span: 放假安排以学校通知为准.
 */
export function eventsForDataset(dataset) {
  return (dataset.events ?? []).map(event => ({
    uid: event.uid,
    title: event.title,
    start: event.date,
    ...(event.lastDay === undefined ? {} : { end: event.lastDay }),
    ...(event.note === undefined ? {} : { description: event.note }),
  }))
}
