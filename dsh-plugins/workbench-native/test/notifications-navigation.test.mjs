import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtime = process.env.EDUWORK_TEST_RUNTIME
let install
async function loadNavigation() {
  if (install) return install
  const req = createRequire(join(runtime, 'package.json'))
  const reactURL = pathToFileURL(req.resolve('react')).href
  const hook = registerHooks({ resolve(name, context, next) {
    return name === 'react' ? { url: reactURL, shortCircuit: true } : next(name, context)
  } })
  try { install = (await import('../src/notifications.ts')).installNotificationNavigation }
  finally { hook.deregister() }
  return install
}

for (const native of [true, false]) test(`notification navigation follows ${native ? 'DSH 0.2 UI adapter' : 'legacy selection'} and releases subscriptions`, { skip: !runtime }, async () => {
  const navigation = await loadNavigation()
  let sessionId = 'one', target
  const listeners = new Set(), views = [], opened = [], tabs = []
  const source = {
    getSnapshot: () => native ? { props: { sessionId } } : { current: sessionId },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const select = id => { sessionId = id; listeners.forEach(listener => listener()) }
  const ctx = {
    sessions: { list: native ? {
      getSnapshot() { throw Error('The catalog does not own UI selection') },
      subscribe() { throw Error('Subscribe to the UI scope selection') },
    } : source },
    ...(native ? { uiSession: { adapter: { current: source } } } : {}),
    uiWorkspace: { openSession: id => { opened.push(id); select(id) } },
    get: name => {
      assert.equal(name, 'sidebarRight')
      return { openTab: (kind, options) => tabs.push({ kind, options }) }
    },
  }
  const environment = new EventTarget()
  Object.assign(environment, { setTimeout, clearTimeout })
  const controller = navigation(ctx, async view => {
    views.push(view)
    const value = target; target = undefined
    return { desktop: true, delivery: 'available', target: value }
  }, environment)
  const settle = () => new Promise(resolve => setImmediate(resolve))
  const until = async predicate => {
    const deadline = Date.now() + 1500
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'Notification target did not finish navigation')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  try {
    await settle()
    assert.equal(views.at(-1).sessionId, 'one')
    select('two'); await settle()
    assert.equal(views.at(-1).sessionId, 'two')
    target = { key: 'completed:three', sessionId: 'three' }
    environment.dispatchEvent(new Event('focus')); await settle()
    assert.deepEqual(opened, ['three'])
    environment.dispatchEvent(new Event('focus')); await settle()
    assert.equal(views.at(-1).sessionId, 'three')
    assert.equal(views.at(-1).openedKey, 'completed:three')
    const artifactId = 'artifact_' + 'a'.repeat(32)
    target = { key: 'studio:four', sessionId: 'four', artifactId }
    environment.dispatchEvent(new Event('focus'))
    await until(() => tabs.length === 1)
    await settle()
    assert.deepEqual(tabs, [{ kind: 'knowledge-studio', options: { params: { artifactId } } }])
    environment.dispatchEvent(new Event('focus')); await settle()
    assert.equal(views.at(-1).sessionId, 'four')
    assert.equal(views.at(-1).openedKey, 'studio:four')
    environment.dispatchEvent(new CustomEvent('eduwork:studio-visibility', { detail: { sessionId: 'four', artifactId, visible: true } }))
    await settle()
    assert.equal(views.at(-1).artifactId, artifactId)
    select('five'); await settle()
    assert.equal(views.at(-1).sessionId, 'five')
    assert.equal(views.at(-1).artifactId, undefined)
    select(undefined); await settle()
    assert.equal(views.at(-1).sessionId, '')
  } finally { controller.close() }
  assert.equal(listeners.size, 0)
  const count = views.length
  select('after-dispose'); environment.dispatchEvent(new Event('focus')); await settle()
  assert.equal(views.length, count)
})
