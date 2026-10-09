import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopQuitConfirmation, inspectLegacyDesktopQuit } from '../src/quit-confirmation.mjs'
import { DesktopExit } from '../src/desktop-exit.mjs'

const locale = () => ({ id: 'zh-CN', messages: { application: 'Synthetic app' } })

test('cancelling a real quit decision preserves cleanup and permits a freshly inspected retry', async () => {
  let inspections = 0, dialogs = 0, cleaned = 0
  const answer = Promise.withResolvers()
  const guard = new DesktopQuitConfirmation({ locale, focus() {},
    inspect: async () => { inspections++; return { activeTasks: true, scheduledTasks: false } },
    show: options => { dialogs++; assert.deepEqual(options.buttons, ['退出', '取消']); return answer.promise },
  })
  const exit = new DesktopExit({ confirm: () => guard.confirm(), close: async () => { cleaned++ }, quit() {}, relaunch: assert.fail, failed: assert.fail })
  const first = exit.request()
  assert.equal(exit.request(), first)
  answer.resolve({ response: 1 })
  await first
  assert.equal(cleaned, 0); assert.equal(exit.complete, false); assert.equal(dialogs, 1)
  guard.options.show = async () => ({ response: 0 })
  await exit.request()
  assert.equal(inspections, 2); assert.equal(cleaned, 1); assert.equal(exit.complete, true)
})

test('only an absent Host or a successful idle inspection permits silent quit', async () => {
  const guard = new DesktopQuitConfirmation({ locale, focus() {}, show: assert.fail, inspect: () => undefined })
  assert.equal(await guard.confirm(), true)
  guard.options.inspect = async () => ({ activeTasks: false, scheduledTasks: false })
  assert.equal(await guard.confirm(), true)
  guard.options.inspect = async () => { throw Error('Host unavailable') }
  guard.options.show = async options => { assert.match(options.detail, /中断/); return { response: 1 } }
  assert.equal(await guard.confirm(), false)
})

test('concurrent decisions share one prompt and disposal cannot approve a pending quit', async () => {
  const answer = Promise.withResolvers(), opened = Promise.withResolvers()
  let dialogs = 0, focused = 0
  const guard = new DesktopQuitConfirmation({ locale, inspect: async () => ({ activeTasks: false, scheduledTasks: true }),
    show: options => { dialogs++; assert.match(options.detail, /定时任务/); opened.resolve(); return answer.promise }, focus: () => { focused++ },
  })
  const first = guard.confirm()
  assert.equal(guard.confirm(), first)
  await opened.promise
  guard.dispose(); answer.resolve({ response: 0 })
  assert.equal(await first, false); assert.equal(await guard.confirm(), false)
  assert.equal(dialogs, 1); assert.equal(focused, 1)
})

test('legacy inspection uses the bounded Host transport and rejects invalid responses', async () => {
  const host = { fetch: async request => {
    assert.equal(request.url, 'dsh-app://app/_eduwork/quit-inspection')
    assert.equal(request.method, 'GET'); assert.ok(request.signal)
    return Response.json({ activeTasks: true, scheduledTasks: false })
  } }
  assert.deepEqual(await inspectLegacyDesktopQuit(host), { activeTasks: true, scheduledTasks: false })
  host.fetch = async () => Response.json({ activeTasks: 'false', scheduledTasks: false })
  await assert.rejects(inspectLegacyDesktopQuit(host), /Invalid/)
  host.fetch = async () => new Response('', { status: 503 })
  await assert.rejects(inspectLegacyDesktopQuit(host), /unavailable/)
})
