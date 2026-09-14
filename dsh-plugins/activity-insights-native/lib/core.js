const DEFAULT_DAYS = 365
const canonicalTimeZones = new Map()
const localDateFormatters = new Map()

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

export function canonicalTimeZone(value) {
  const key = typeof value === 'string' ? value : ''
  const cached = canonicalTimeZones.get(key)
  if (cached) return cached
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: value || undefined }).resolvedOptions().timeZone
    canonicalTimeZones.set(key, resolved)
    return resolved
  } catch {
    canonicalTimeZones.set(key, 'UTC')
    return 'UTC'
  }
}

function localDateParts(time, timeZone) {
  let formatter = localDateFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    })
    localDateFormatters.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(new Date(time))
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

export function localDayKey(time, timeZone) {
  const value = localDateParts(time, canonicalTimeZone(timeZone))
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
}

function dayOrdinal(key) {
  const [year, month, day] = key.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

function ordinalKey(ordinal) {
  return new Date(ordinal * 86_400_000).toISOString().slice(0, 10)
}

function increment(map, key, amount = 1) {
  if (!key || !Number.isFinite(amount) || amount <= 0) return
  map.set(String(key), (map.get(String(key)) ?? 0) + amount)
}

function topEntries(map, limit = 6) {
  return [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}

function safeName(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 256) : ''
}

export function displayAffiliation(value) {
  const affiliation = safeName(value)
  return affiliation && affiliation.toLowerCase() !== 'other' ? affiliation : null
}

function skillNameFromToolCall(data) {
  if (safeName(data?.name) !== 'skill') return ''
  const projected = safeName(data?.skillName)
  if (projected) return projected
  try {
    const args = typeof data?.arguments === 'string'
      ? JSON.parse(data.arguments)
      : data?.arguments
    return safeName(args?.name)
  } catch {
    return ''
  }
}

function rankedEntries(map) {
  return [...map.entries()].map(([name, count]) => ({ name, count }))
}

function rankedMap(entries) {
  const result = new Map()
  for (const entry of entries ?? []) {
    const name = safeName(entry?.name)
    const count = Number(entry?.count)
    if (name && Number.isSafeInteger(count) && count > 0) result.set(name, count)
  }
  return result
}

function summaryDayMap(days) {
  const result = new Map()
  for (const day of days ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date ?? '')) continue
    result.set(day.date, {
      date: day.date,
      active: day.active === true,
      turns: boundedInteger(day.turns, 0, 0, Number.MAX_SAFE_INTEGER),
      assistantMessages: boundedInteger(day.assistantMessages, 0, 0, Number.MAX_SAFE_INTEGER),
      toolCalls: boundedInteger(day.toolCalls, 0, 0, Number.MAX_SAFE_INTEGER),
      tokens: boundedInteger(day.tokens, 0, 0, Number.MAX_SAFE_INTEGER),
    })
  }
  return result
}

function summaryDay(days, time, timeZone) {
  const key = localDayKey(time, timeZone)
  let day = days.get(key)
  if (!day) {
    day = { date: key, active: false, turns: 0, assistantMessages: 0, toolCalls: 0, tokens: 0 }
    days.set(key, day)
  }
  return day
}

export function exactUsageTotal(usage) {
  if (!usage || typeof usage !== 'object') return null
  const nonnegative = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  if (Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0) return Math.floor(usage.totalTokens)
  if (!Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens)) return null
  return nonnegative(usage.inputTokens) + nonnegative(usage.outputTokens)
    + nonnegative(usage.cacheReadTokens) + nonnegative(usage.cacheWriteTokens)
}

/**
 * Read DSH's canonical active runtime projection for one Session.  Model and
 * tool execution are accumulated by the built-in sessionStats projection, so
 * time spent with a chat closed or idle is never counted as chat duration.
 */
export function sessionRuntimeMs(projections) {
  const stats = projections?.values?.sessionStats
  if (!stats || typeof stats !== 'object') return null
  const llmMs = Number(stats.llmMs)
  const toolMs = Number(stats.toolMs)
  if (!Number.isFinite(llmMs) || llmMs < 0 || !Number.isFinite(toolMs) || toolMs < 0) return null
  return Math.max(0, Math.round(llmMs + toolMs))
}

function emptyDay(date) {
  return { date, sessions: new Set(), turns: 0, assistantMessages: 0, toolCalls: 0, tokens: 0 }
}

function streaks(activeKeys, todayKey) {
  const ordinals = [...new Set(activeKeys.map(dayOrdinal))].sort((a, b) => a - b)
  let longest = 0
  let run = 0
  let prior = null
  for (const ordinal of ordinals) {
    run = prior !== null && ordinal === prior + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    prior = ordinal
  }
  const set = new Set(ordinals)
  let current = 0
  let cursor = dayOrdinal(todayKey)
  // A streak remains current throughout the day after the latest active day.
  if (!set.has(cursor) && set.has(cursor - 1)) cursor -= 1
  while (set.has(cursor)) { current += 1; cursor -= 1 }
  return { current, longest }
}

function liveEvents(snapshot) {
  const seedLength = boundedInteger(snapshot?.session?.seedLength, 0, 0, snapshot?.events?.length ?? 0)
  return Array.isArray(snapshot?.events) ? snapshot.events.slice(seedLength) : []
}

function projectedUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const result = {}
  for (const key of ['totalTokens', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
    if (Number.isFinite(usage[key]) && usage[key] >= 0) result[key] = usage[key]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Strip one observed Session down to the metadata needed by the activity fold.
 * This is intentionally performed while the Session Query observation lease is
 * held, so the potentially large raw log can be released immediately after it.
 */
export function projectActivitySnapshot(snapshot) {
  const header = snapshot?.session ?? snapshot?.header ?? {}
  const sourceEvents = Array.isArray(snapshot?.events) ? snapshot.events : []
  const seedLength = boundedInteger(header.seedLength, 0, 0, sourceEvents.length)
  let lastEventTime = Number.isFinite(header.createdAt) ? header.createdAt : null
  const events = []
  for (const event of sourceEvents.slice(seedLength)) {
    if (Number.isFinite(event?.time)) lastEventTime = lastEventTime === null ? event.time : Math.max(lastEventTime, event.time)
    if (!['request/header', 'user/message', 'assistant/message', 'tool/call'].includes(event?.type)) continue
    const projected = { type: String(event?.type ?? ''), time: event?.time }
    if (event?.type === 'request/header') {
      const reasoningEffort = event.data?.header?.config?.reasoningEffort
      if (typeof reasoningEffort === 'string') projected.data = { header: { config: { reasoningEffort } } }
    } else if (event?.type === 'user/message') {
      const kind = event.data?.source?.kind
      const name = event.data?.source?.name
      if (typeof kind === 'string') {
        projected.data = { source: { kind, ...(kind === 'skill-invocation' && typeof name === 'string' ? { name } : {}) } }
      }
    } else if (event?.type === 'assistant/message') {
      const model = event.data?.message?.source?.model
      const usage = projectedUsage(event.data?.usage)
      projected.data = {
        ...(typeof model === 'string' ? { message: { source: { model } } } : {}),
        ...(usage ? { usage } : {}),
      }
    } else if (event?.type === 'tool/call') {
      const name = event.data?.name
      if (typeof name === 'string') {
        const skillName = skillNameFromToolCall(event.data)
        projected.data = { name, ...(skillName ? { skillName } : {}) }
      }
    }
    events.push(projected)
  }
  return {
    session: {
      id: String(header.id ?? ''),
      ...(Number.isFinite(header.createdAt) ? { createdAt: header.createdAt } : {}),
      ...(lastEventTime !== null ? { lastEventTime } : {}),
      ...(header.origin === 'subagent' ? { origin: 'subagent' } : {}),
      seedLength: 0,
    },
    events,
  }
}

/**
 * Fold one Session (or only its appended tail) into a content-free durable
 * summary.  The summary is independent from the backing persistence format
 * and is small enough to keep as a local read-model checkpoint.
 */
export function summarizeActivitySnapshot(snapshot, options = {}) {
  const timeZone = canonicalTimeZone(options.timeZone)
  const header = snapshot?.session ?? snapshot?.header ?? {}
  const sourceEvents = Array.isArray(snapshot?.events) ? snapshot.events : []
  const prior = options.previous && typeof options.previous === 'object' ? options.previous : undefined
  const events = options.tail === true
    ? sourceEvents
    : sourceEvents.slice(boundedInteger(header.seedLength, 0, 0, sourceEvents.length))
  const days = summaryDayMap(prior?.days)
  const tools = rankedMap(prior?.tools)
  const skills = rankedMap(prior?.skills)
  const models = rankedMap(prior?.models)
  const reasoning = rankedMap(prior?.reasoning)
  let firstHumanTime = Number.isFinite(prior?.firstHumanTime) ? prior.firstHumanTime : null
  let lastTime = Number.isFinite(prior?.lastTime)
    ? prior.lastTime
    : Number.isFinite(header.createdAt) ? header.createdAt : null
  let currentReasoning = safeName(prior?.currentReasoning)
  let userMessages = boundedInteger(prior?.userMessages, 0, 0, Number.MAX_SAFE_INTEGER)
  let assistantMessages = boundedInteger(prior?.assistantMessages, 0, 0, Number.MAX_SAFE_INTEGER)
  let toolCalls = boundedInteger(prior?.toolCalls, 0, 0, Number.MAX_SAFE_INTEGER)
  let skillInvocations = boundedInteger(prior?.skillInvocations, 0, 0, Number.MAX_SAFE_INTEGER)
  let usageCalls = boundedInteger(prior?.usageCalls, 0, 0, Number.MAX_SAFE_INTEGER)
  let recordedTokens = boundedInteger(prior?.recordedTokens, 0, 0, Number.MAX_SAFE_INTEGER)
  let peakTokens = boundedInteger(prior?.peakTokens, 0, 0, Number.MAX_SAFE_INTEGER)
  const projectedRuntimeMs = sessionRuntimeMs(options.projections ?? snapshot?.projections)
  const runtimeMs = projectedRuntimeMs ?? boundedInteger(prior?.runtimeMs, 0, 0, Number.MAX_SAFE_INTEGER)

  for (const event of events) {
    if (!event || !Number.isFinite(event.time)) continue
    lastTime = lastTime === null ? event.time : Math.max(lastTime, event.time)

    if (event.type === 'request/header') {
      currentReasoning = safeName(event.data?.header?.config?.reasoningEffort)
      continue
    }

    if (event.type === 'user/message') {
      const source = event.data?.source
      if (source?.kind === 'user') {
        const day = summaryDay(days, event.time, timeZone)
        userMessages += 1
        if (firstHumanTime === null) firstHumanTime = event.time
        day.active = true
        day.turns += 1
      } else if (source?.kind === 'skill-invocation') {
        const skillName = safeName(source.name)
        if (skillName) {
          skillInvocations += 1
          increment(skills, skillName)
        }
      }
      continue
    }

    if (event.type === 'assistant/message') {
      const day = summaryDay(days, event.time, timeZone)
      assistantMessages += 1
      increment(models, safeName(event.data?.message?.source?.model))
      increment(reasoning, currentReasoning || '默认')
      const total = exactUsageTotal(event.data?.usage)
      if (total !== null) {
        usageCalls += 1
        recordedTokens += total
        peakTokens = Math.max(peakTokens, total)
        day.tokens += total
      }
      day.assistantMessages += 1
      continue
    }

    if (event.type === 'tool/call') {
      const day = summaryDay(days, event.time, timeZone)
      const name = safeName(event.data?.name)
      toolCalls += 1
      increment(tools, name)
      const skillName = skillNameFromToolCall(event.data)
      if (skillName) {
        skillInvocations += 1
        increment(skills, skillName)
      }
      day.toolCalls += 1
    }
  }

  if (Number.isFinite(header.lastEventTime)) {
    lastTime = lastTime === null ? header.lastEventTime : Math.max(lastTime, header.lastEventTime)
  }
  return {
    schemaVersion: 3,
    sessionId: String(header.id ?? prior?.sessionId ?? ''),
    subagent: header.origin === 'subagent' || prior?.subagent === true,
    firstHumanTime,
    lastTime,
    currentReasoning,
    userMessages,
    assistantMessages,
    toolCalls,
    skillInvocations,
    usageCalls,
    recordedTokens,
    peakTokens,
    runtimeMs,
    days: [...days.values()].sort((left, right) => left.date.localeCompare(right.date)),
    tools: rankedEntries(tools),
    skills: rankedEntries(skills),
    models: rankedEntries(models),
    reasoning: rankedEntries(reasoning),
  }
}

/** Merge already-folded per-session checkpoints without retaining event rows. */
export function aggregateActivitySummaries(summaries, options = {}) {
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const timeZone = canonicalTimeZone(options.timeZone)
  const days = boundedInteger(options.days, DEFAULT_DAYS, 30, 366)
  const todayKey = localDayKey(now, timeZone)
  const todayOrdinal = dayOrdinal(todayKey)
  const firstOrdinal = todayOrdinal - days + 1
  const daily = new Map()
  for (let ordinal = firstOrdinal; ordinal <= todayOrdinal; ordinal += 1) {
    const key = ordinalKey(ordinal)
    daily.set(key, emptyDay(key))
  }

  const tools = new Map()
  const skills = new Map()
  const models = new Map()
  const reasoning = new Map()
  const activeDays = new Set()
  let totalChats = 0
  let subagentSessions = 0
  let userMessages = 0
  let assistantMessages = 0
  let toolCalls = 0
  let skillInvocations = 0
  let usageCalls = 0
  let recordedTokens = 0
  let peakTokens = 0
  let longestChatMs = 0

  for (const summary of summaries ?? []) {
    if (!summary || summary.schemaVersion !== 3) continue
    if (summary.subagent) subagentSessions += 1
    else if (Number.isFinite(summary.firstHumanTime)) {
      totalChats += 1
      longestChatMs = Math.max(longestChatMs, boundedInteger(summary.runtimeMs, 0, 0, Number.MAX_SAFE_INTEGER))
    }
    userMessages += boundedInteger(summary.userMessages, 0, 0, Number.MAX_SAFE_INTEGER)
    assistantMessages += boundedInteger(summary.assistantMessages, 0, 0, Number.MAX_SAFE_INTEGER)
    toolCalls += boundedInteger(summary.toolCalls, 0, 0, Number.MAX_SAFE_INTEGER)
    skillInvocations += boundedInteger(summary.skillInvocations, 0, 0, Number.MAX_SAFE_INTEGER)
    usageCalls += boundedInteger(summary.usageCalls, 0, 0, Number.MAX_SAFE_INTEGER)
    recordedTokens += boundedInteger(summary.recordedTokens, 0, 0, Number.MAX_SAFE_INTEGER)
    peakTokens = Math.max(peakTokens, boundedInteger(summary.peakTokens, 0, 0, Number.MAX_SAFE_INTEGER))
    for (const entry of summary.tools ?? []) increment(tools, safeName(entry?.name), boundedInteger(entry?.count, 0, 0, Number.MAX_SAFE_INTEGER))
    for (const entry of summary.skills ?? []) increment(skills, safeName(entry?.name), boundedInteger(entry?.count, 0, 0, Number.MAX_SAFE_INTEGER))
    for (const entry of summary.models ?? []) increment(models, safeName(entry?.name), boundedInteger(entry?.count, 0, 0, Number.MAX_SAFE_INTEGER))
    for (const entry of summary.reasoning ?? []) increment(reasoning, safeName(entry?.name), boundedInteger(entry?.count, 0, 0, Number.MAX_SAFE_INTEGER))
    for (const source of summary.days ?? []) {
      const target = daily.get(source?.date)
      if (!target) continue
      if (source.active === true) {
        target.sessions.add(summary.sessionId)
        activeDays.add(source.date)
      }
      target.turns += boundedInteger(source.turns, 0, 0, Number.MAX_SAFE_INTEGER)
      target.assistantMessages += boundedInteger(source.assistantMessages, 0, 0, Number.MAX_SAFE_INTEGER)
      target.toolCalls += boundedInteger(source.toolCalls, 0, 0, Number.MAX_SAFE_INTEGER)
      target.tokens += boundedInteger(source.tokens, 0, 0, Number.MAX_SAFE_INTEGER)
    }
  }

  const streak = streaks([...activeDays], todayKey)
  return {
    generatedAt: new Date(now).toISOString(),
    timeZone,
    totals: {
      chats: totalChats,
      subagentSessions,
      activeDays: activeDays.size,
      userMessages,
      assistantMessages,
      toolCalls,
      skillInvocations,
      uniqueSkills: skills.size,
    },
    tokens: {
      recorded: recordedTokens,
      peak: peakTokens,
      callsWithUsage: usageCalls,
      assistantCalls: assistantMessages,
      coveragePercent: assistantMessages === 0 ? 0 : Math.round(usageCalls / assistantMessages * 100),
    },
    streaks: { currentDays: streak.current, longestDays: streak.longest },
    longestChatMs,
    activity: [...daily.values()].map(day => ({
      date: day.date,
      sessions: day.sessions.size,
      turns: day.turns,
      assistantMessages: day.assistantMessages,
      toolCalls: day.toolCalls,
      tokens: day.tokens,
    })),
    topTools: topEntries(tools),
    topSkills: topEntries(skills),
    topModels: topEntries(models),
    reasoningEfforts: topEntries(reasoning),
  }
}

/**
 * Fold DSH's canonical session logs into content-free local usage statistics.
 * Message content, prompts, tool arguments, paths and result payloads are never
 * retained in or returned from this projection.
 */
export function aggregateActivity(snapshots, options = {}) {
  const timeZone = canonicalTimeZone(options.timeZone)
  return aggregateActivitySummaries(
    (snapshots ?? []).map(snapshot => summarizeActivitySnapshot(snapshot, { timeZone })),
    { ...options, timeZone },
  )
}
