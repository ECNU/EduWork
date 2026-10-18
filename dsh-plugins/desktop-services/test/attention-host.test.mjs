import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startNativeBridge } from '../../../dsh-electron/src/native-vault.mjs'
import { TaskNotifications } from '../../../dsh-electron/src/task-notifications.mjs'
import { notificationDefaults } from '../lib/attention.js'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('real Cordis session events and authenticated desktop bridge preserve pending decisions under both configuration APIs', { skip: !runtime }, async t => {
  const req = createRequire(join(runtime, 'package.json')), load = name => import(pathToFileURL(req.resolve(name)))
  const [{ Context, Service }, { default: Settings }, { default: Sessions }] = await Promise.all([load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-settings'), load('@deepseek-ai/dsh-session')])
  const hook = registerHooks({ resolve(name, context, next) { return next(name, name.startsWith('@deepseek-ai/') ? { ...context, parentURL: pathToFileURL(join(runtime, 'package.json')).href } : context) } })
  const { default: Desktop } = await import('../lib/index.js')
  hook.deregister()
  const shell = new TaskNotifications({ foreground: () => false, show() {}, publish() {}, dismiss() {}, changed() {} })
  let bridgeUnavailable = true
  const bridge = await startNativeBridge({ vault: { flush: async () => {} }, attention: value => {
    if (bridgeUnavailable) throw new Error('fixture bridge unavailable')
    return shell.handle(value)
  } })
  t.after(() => bridge.close())
  class MemorySettings extends Settings {
    writable = true
    async load() { return {} }
    async persist(ns, value) { this.publish({ [ns]: value }) }
  }
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const boundary = new Service(ctx, 'desktopBoundary'); boundary.ready = Promise.resolve(bridge.bootstrap)
  new Sessions(ctx)
  const agents = new Service(ctx, 'agents'); agents.roots = () => [{ id: 'fixture' }]
  const nativeSettings = typeof Settings.prototype.register !== 'function'
  if (nativeSettings) {
    // Native forms belong to Loader; this test supplies its presentation seam.
    // Full Loader/configuration wiring is exercised in desktop acceptance.
    const presentation = new Service(ctx, 'settings')
    presentation.configure = () => () => {}
  } else await ctx.plugin(MemorySettings)
  const preferences = { ...notificationDefaults, preview: !nativeSettings }
  await ctx.plugin(Desktop, nativeSettings
    ? preferences
    : { notifications: { preview: true } })
  const service = ctx.desktopServices
  assert.ok(service?.attention)
  if (!nativeSettings) {
    assert.equal(ctx.settings.get('eduwork-notifications').preview, true)
    await ctx.settings.update('eduwork-notifications', { preview: false })
    assert.equal(ctx.settings.get('eduwork-notifications').preview, false)
  }
  await assert.rejects(service.calendarReminder({ id: 'd'.repeat(64), title: 'Unavailable' }), /暂时不可用/)
  bridgeUnavailable = false
  const session = ctx.sessions.create('fixture')
  session.append('turn/start', { turn: 0 })
  session.append('approval/asked', { id: 'permit', toolName: 'fixture' })
  await service.attention.flush()
  assert.equal(shell.items.size, 1)
  assert.equal(shell.preferences.preview, false)
  const entry = shell.menu()[0]; entry.click()
  const view = await service.attention.view({ sessionId: '' })
  assert.equal(view.target.sessionId, 'fixture')
  session.append('approval/decided', { id: 'permit', outcome: 'rejected' })
  await service.attention.flush()
  assert.equal(shell.items.size, 0)
  const { baseURL, token } = bridge.bootstrap.nativeBridge
  const call = (body, headers) => fetch(baseURL + '/v1/extensions/attention', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  assert.equal((await call({ action: 'view', sessionId: '' }, { origin: 'dsh-app://app', authorization: 'Bearer ' + token })).status, 403)
  assert.equal((await call({ action: 'view', sessionId: '' }, {})).status, 403)
  assert.equal((await call({ action: 'execute', command: 'bad' }, { authorization: 'Bearer ' + token })).status, 400)
  const id = 'c'.repeat(64)
  await service.calendarReminder({ id, title: '上课提醒' })
  assert.equal(shell.items.get('calendar:' + id).kind, 'calendar')
  await service.dismissCalendarReminder(id)
  assert.equal(shell.items.has('calendar:' + id), false)
  // An older shell does not advertise calendar support. Do not send it unknown
  // rows: that would reject the entire snapshot, including approval notices.
  const nativeBridge = service.notificationBridge.bind(service)
  service.notificationBridge = async body => { const result = await nativeBridge(body); delete result.calendarReminders; return result }
  await service.attention.flush()
  await assert.rejects(service.calendarReminder({ id, title: 'Unsupported' }), /尚不支持/)
  service.attention.put({ key: 'still-works', kind: 'approval', sessionId: 'fixture', title: '' })
  await service.attention.flush()
  assert.equal(shell.items.get('still-works').kind, 'approval')
  assert.equal(shell.items.has('calendar:' + id), false)
})

test('real session headers attribute subagent turns to the conversation that delegated them', { skip: !runtime }, async t => {
  const req = createRequire(join(runtime, 'package.json')), load = name => import(pathToFileURL(req.resolve(name)))
  const [{ Context, Service }, { default: Sessions }] = await Promise.all([load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-session')])
  const { DesktopAttention, notificationDefaults, observeDesktopAttention } = await import('../lib/attention.js')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new Sessions(ctx)
  const live = new Map(), agents = new Service(ctx, 'agents')
  agents.roots = () => [live.get('root')]; agents.get = id => live.get(id)
  const attention = new DesktopAttention({ bridge: async () => ({ seen: [] }), preferences: () => notificationDefaults })
  observeDesktopAttention(ctx, attention)
  const open = (id, meta) => { const session = ctx.sessions.create(id, meta && { meta }); live.set(id, { id, session }); return session }
  const root = open('root'), child = open('child', { parentSession: 'root', origin: 'subagent', delegationDepth: 1 })
  const grandchild = open('grandchild', { parentSession: child.id, origin: 'subagent', delegationDepth: 2 })
  // A fork shares the lineage field without the subagent origin.
  const fork = open('fork', { parentSession: 'root' })
  root.append('turn/start', { turn: 0 }); grandchild.append('turn/start', { turn: 0 }); fork.append('turn/start', { turn: 0 })
  assert.deepEqual([...attention.delegated], [['grandchild', 'root']])
  root.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
  assert.equal(attention.items.size, 0)
  grandchild.append('turn/end', { turn: 0, reason: { kind: 'completed' } })
  root.append('turn/start', { turn: 1 }); root.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal([...attention.items.values()][0].kind, 'completed')
})

test('real goal driver: a round-limit or queue-failure block after the held turn is reported once as needing attention', { skip: !runtime }, async t => {
  const req = createRequire(join(runtime, 'package.json')), load = name => import(pathToFileURL(req.resolve(name)))
  const [{ Context, Service }, { default: Sessions }, { default: Projections }, { default: Goals }, driver] = await Promise.all([load('@deepseek-ai/cordis'),
    load('@deepseek-ai/dsh-session'), load('@deepseek-ai/dsh-session-projection'), load('@deepseek-ai/dsh-goal'), load('@deepseek-ai/dsh-goal-round-driver')])
  const { DesktopAttention, notificationDefaults, observeDesktopAttention } = await import('../lib/attention.js')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new Sessions(ctx); new Projections(ctx)
  const live = new Map(), agents = new Service(ctx, 'agents')
  Object.assign(agents, { roots: () => [...live.values()], get: id => live.get(id), list: () => [...live.values()], withoutInitiator: run => run(), currentInitiator: () => undefined })
  await ctx.plugin(Goals); await ctx.plugin(driver)
  const attention = new DesktopAttention({ bridge: async () => ({ seen: [] }), preferences: () => notificationDefaults, goal: id => ctx.goals.get(live.get(id)) })
  observeDesktopAttention(ctx, attention)
  const settle = () => new Promise(resolve => setTimeout(resolve, 20))
  // An idle root agent whose follow-up either queues the driver's round or throws.
  const open = id => {
    const agent = { id, session: ctx.sessions.create(id), status: 'idle', queued: [], refuse: false, inbox: { nextStep: [], nextTurn: [], prepend() {} },
      followup(message) { if (this.refuse) throw Error('queue closed'); this.queued.push(message) }, cancel() {}, whenIdle: async () => {} }
    live.set(id, agent); return agent
  }
  const turn = async (agent, n, run = () => {}) => {
    agent.status = 'running'; agent.session.append('turn/start', { turn: n }); run()
    agent.session.append('turn/end', { turn: n, reason: { kind: 'completed' } })
    agent.status = 'idle'; ctx.emit('agent/status', { agent, status: 'idle' }); await settle()
  }
  const kinds = () => [...attention.items.values()].map(item => item.kind)

  // Round limit: the first turn arms the goal, the driver queues round 1, and after it the driver blocks.
  const limited = open('limited')
  await turn(limited, 0, () => ctx.goals.create(limited, { objective: 'synthetic', maxGoalRounds: 1 }))
  assert.equal(limited.queued.length, 1); assert.deepEqual(kinds(), [])
  const [round] = limited.queued
  ctx.emit('agent/inbox/claimed', { agent: limited, message: round })
  await turn(limited, 1, () => limited.session.append('user/message', round, { surfaceOp: 'append' }))
  assert.equal(ctx.goals.get(limited).blockedReason.code, 'round-limit')
  assert.deepEqual(kinds(), ['failed'])

  // Queue failure: no further turn ends after the driver blocks the goal.
  const stuck = open('stuck'); stuck.refuse = true
  await turn(stuck, 0, () => ctx.goals.create(stuck, { objective: 'synthetic', maxGoalRounds: 3 }))
  assert.equal(ctx.goals.get(stuck).blockedReason.code, 'queue-failed')
  assert.deepEqual(kinds(), ['failed', 'failed'])

  // Without a goal a completed turn is reported at once, and only once.
  const plain = open('plain')
  await turn(plain, 0)
  ctx.emit('goal/changed', { agent: plain, change: { operation: 'block' } })
  assert.deepEqual(kinds(), ['failed', 'failed', 'completed'])
})
