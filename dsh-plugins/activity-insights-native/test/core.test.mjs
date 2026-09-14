import assert from 'node:assert/strict'
import test from 'node:test'
import {
  aggregateActivity,
  aggregateActivitySummaries,
  displayAffiliation,
  exactUsageTotal,
  localDayKey,
  projectActivitySnapshot,
  sessionRuntimeMs,
  summarizeActivitySnapshot,
} from '../lib/core.js'

const user = time => ({ type: 'user/message', time, data: { source: { kind: 'user' } } })
const header = (time, effort) => ({ type: 'request/header', time, data: { header: { config: { provider: 'test', model: 'm', reasoningEffort: effort } } } })
const assistant = (time, model, usage) => ({ type: 'assistant/message', time, data: { message: { source: { kind: 'model', provider: 'test', model } }, usage } })
const tool = (time, name, args) => ({ type: 'tool/call', time, data: { name, ...(args === undefined ? {} : { arguments: JSON.stringify(args) }) } })
const skill = (time, name) => tool(time, 'skill', { name })
const at = value => Date.parse(`${value}T04:00:00Z`)

test('generic affiliation placeholders are not presented as user identity', () => {
  assert.equal(displayAffiliation('other'), null)
  assert.equal(displayAffiliation(' OTHER '), null)
  assert.equal(displayAffiliation('教职工'), '教职工')
})

test('usage total prefers authoritative total and otherwise sums disjoint counters', () => {
  assert.equal(exactUsageTotal({ totalTokens: 10, inputTokens: 99, outputTokens: 99 }), 10)
  assert.equal(exactUsageTotal({ inputTokens: 10, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 2 }), 20)
  assert.equal(exactUsageTotal({ inputTokens: 10 }), null)
})

test('canonical session runtime sums DSH model and tool time', () => {
  assert.equal(sessionRuntimeMs({ values: { sessionStats: { llmMs: 28_541, toolMs: 1_682 } } }), 30_223)
  assert.equal(sessionRuntimeMs({ values: { sessionStats: { llmMs: -1, toolMs: 0 } } }), null)
  assert.equal(sessionRuntimeMs(undefined), null)
})

test('longest chat duration uses active DSH runtime rather than multi-day session wall span', () => {
  const result = aggregateActivity([{
    session: { id: 'resumed', createdAt: at('2026-09-01'), lastEventTime: at('2026-09-06') },
    events: [user(at('2026-09-01')), assistant(at('2026-09-06'), 'ecnu-max', { totalTokens: 12 })],
    projections: { values: { sessionStats: { llmMs: 28_541, toolMs: 1_682 } } },
  }], { now: at('2026-09-06'), timeZone: 'UTC', days: 30 })
  assert.equal(result.longestChatMs, 30_223)
})

test('projection counts canonical DSH event facts without retaining content', () => {
  const result = aggregateActivity([{ session: { id: 's1', createdAt: at('2026-09-01') }, events: [
    user(at('2026-09-01')), header(at('2026-09-01'), 'high'), assistant(at('2026-09-01'), 'ecnu-max', { inputTokens: 100, outputTokens: 20 }),
    tool(at('2026-09-01'), 'web_search'), skill(at('2026-09-01'), 'academic-research'),
    user(at('2026-09-02')), assistant(at('2026-09-02'), 'ecnu-max', undefined),
  ] }], { now: at('2026-09-03'), timeZone: 'UTC', days: 30 })
  assert.equal(result.totals.chats, 1)
  assert.equal(result.totals.userMessages, 2)
  assert.equal(result.totals.toolCalls, 2)
  assert.equal(result.totals.uniqueSkills, 1)
  assert.equal(result.tokens.recorded, 120)
  assert.equal(result.tokens.coveragePercent, 50)
  assert.deepEqual(result.topModels[0], { name: 'ecnu-max', count: 2 })
  assert.deepEqual(result.topTools, [{ name: 'skill', count: 1 }, { name: 'web_search', count: 1 }])
  assert.deepEqual(result.topSkills[0], { name: 'academic-research', count: 1 })
  assert.equal(result.streaks.currentDays, 2)
  assert.equal(JSON.stringify(result).includes('content'), false)
})

test('observation projection strips content and inherited seed events before releasing the raw log', () => {
  const secret = 'SECRET-CONTENT-MUST-NOT-SURVIVE'
  const projected = projectActivitySnapshot({
    header: { id: 'fork', createdAt: at('2026-09-01'), seedLength: 1, cwd: secret },
    events: [
      { ...user(at('2026-09-01')), data: { source: { kind: 'user' }, content: secret } },
      { ...assistant(at('2026-09-02'), 'ecnu-max', { totalTokens: 12 }), data: { ...assistant(at('2026-09-02'), 'ecnu-max', { totalTokens: 12 }).data, content: secret } },
      { ...tool(at('2026-09-02'), 'mail_find'), data: { name: 'mail_find', arguments: secret, result: secret } },
      { ...skill(at('2026-09-02'), 'documents'), data: { name: 'skill', arguments: JSON.stringify({ name: 'documents', prompt: secret }), result: secret } },
      { type: 'assistant/text-delta', time: at('2026-09-03'), data: { text: secret } },
    ],
  })
  assert.equal(projected.session.seedLength, 0)
  assert.equal(projected.events.length, 3)
  assert.equal(projected.session.lastEventTime, at('2026-09-03'))
  assert.equal(JSON.stringify(projected).includes(secret), false)
  const result = aggregateActivity([projected], { now: at('2026-09-03'), timeZone: 'UTC', days: 30 })
  assert.equal(result.tokens.recorded, 12)
  assert.deepEqual(result.topTools[0], { name: 'mail_find', count: 1 })
  assert.deepEqual(result.topSkills[0], { name: 'documents', count: 1 })
})

test('seed history is excluded and subagents do not inflate chat totals', () => {
  const events = [user(at('2026-09-01')), tool(at('2026-09-01'), 'old'), user(at('2026-09-02')), tool(at('2026-09-02'), 'new')]
  const result = aggregateActivity([
    { session: { id: 'fork', seedLength: 2, createdAt: at('2026-09-02') }, events },
    { session: { id: 'child', origin: 'subagent', createdAt: at('2026-09-02') }, events: [tool(at('2026-09-02'), 'child_tool')] },
  ], { now: at('2026-09-03'), timeZone: 'UTC', days: 30 })
  assert.equal(result.totals.chats, 1)
  assert.equal(result.totals.subagentSessions, 1)
  assert.equal(result.totals.userMessages, 1)
  assert.deepEqual(result.topTools.map(row => row.name).sort(), ['child_tool', 'new'])
})

test('local day bucketing honors the requested IANA time zone', () => {
  assert.equal(localDayKey(Date.parse('2026-09-02T16:30:00Z'), 'Asia/Shanghai'), '2026-09-03')
  assert.equal(localDayKey(Date.parse('2026-09-02T16:30:00Z'), 'UTC'), '2026-09-02')
})

test('incremental tail folding is identical to a complete session fold', () => {
  const events = [
    { ...header(at('2026-09-01'), 'high'), seq: 0 },
    { ...user(at('2026-09-01')), seq: 1 },
    { ...assistant(at('2026-09-01'), 'ecnu-max', { totalTokens: 100 }), seq: 2 },
    { ...tool(at('2026-09-02'), 'mail_find'), seq: 3 },
    { ...user(at('2026-09-03')), seq: 4 },
    { ...assistant(at('2026-09-03'), 'ecnu-max', { inputTokens: 20, outputTokens: 5 }), seq: 5 },
  ]
  const session = { id: 'incremental', createdAt: at('2026-09-01') }
  const complete = summarizeActivitySnapshot({ session, events }, { timeZone: 'UTC' })
  const first = summarizeActivitySnapshot({ session, events: events.slice(0, 3) }, { timeZone: 'UTC' })
  const incremental = summarizeActivitySnapshot(
    { session, events: events.slice(3) },
    { timeZone: 'UTC', previous: first, tail: true },
  )
  assert.deepEqual(incremental, complete)
  assert.deepEqual(
    aggregateActivitySummaries([incremental], { now: at('2026-09-03'), timeZone: 'UTC', days: 30 }),
    aggregateActivity([{ session, events }], { now: at('2026-09-03'), timeZone: 'UTC', days: 30 }),
  )
})
