import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startNativeBridge } from '../../../dsh-electron/src/native-vault.mjs'
import { TaskNotifications } from '../../../dsh-electron/src/task-notifications.mjs'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('real Cordis settings, session events and authenticated desktop bridge preserve pending decisions', { skip: !runtime }, async t => {
  const req = createRequire(join(runtime, 'package.json')), load = name => import(pathToFileURL(req.resolve(name)))
  const [{ Context, Service }, { default: Settings }, { default: Sessions }] = await Promise.all([load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-settings'), load('@deepseek-ai/dsh-session')])
  const hook = registerHooks({ resolve(name, context, next) { return next(name, name.startsWith('@deepseek-ai/') ? { ...context, parentURL: pathToFileURL(join(runtime, 'package.json')).href } : context) } })
  const { default: Desktop } = await import('../lib/index.js')
  hook.deregister()
  const shell = new TaskNotifications({ foreground: () => false, show() {}, publish() {}, dismiss() {}, changed() {} })
  const bridge = await startNativeBridge({ vault: { flush: async () => {} }, attention: value => shell.handle(value) })
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
  await ctx.plugin(MemorySettings)
  await ctx.plugin(Desktop, { notifications: { preview: true } })
  const service = ctx.desktopServices
  assert.ok(service?.attention)
  assert.equal(ctx.settings.get('eduwork-notifications').preview, true)
  await ctx.settings.update('eduwork-notifications', { preview: false })
  assert.equal(ctx.settings.get('eduwork-notifications').preview, false)
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
})
