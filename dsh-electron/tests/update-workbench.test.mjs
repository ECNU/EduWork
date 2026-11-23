import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkbenchUpdateHandler } from '../src/update-workbench.mjs'
import { createProductUpdateObserver } from '../src/update-observer.mjs'

function fixture(coordinator) {
  const calls = [], recorded = [], fallback = []
  const observer = {
    async status() { calls.push('observer.status'); return { shell: 'electron', update: { state: 'checking' } } },
    record(value) { calls.push('observer.record'); recorded.push(value) },
  }
  const handler = createWorkbenchUpdateHandler({
    getCoordinator: () => coordinator,
    observer,
    runWorkbench: (action, updateStatus) => { fallback.push({ action, updateStatus }); return { fallback: true } },
  })
  return { handler, calls, recorded, fallback }
}

test('workbench status is served by the shared observer without touching the coordinator', async () => {
  const coordinator = { action: async () => assert.fail('status must not be read twice') }
  const { handler, calls } = fixture(coordinator)
  assert.deepEqual(await handler('status'), { shell: 'electron', update: { state: 'checking' } })
  assert.deepEqual(calls, ['observer.status'])
})

test('diagnostics keeps one direct authoritative status read', async () => {
  const status = { update: { state: 'ready' } }, calls = []
  const coordinator = { action: async action => { calls.push(action); return status } }
  const { handler, fallback, calls: observerCalls } = fixture(coordinator)
  assert.deepEqual(await handler('diagnostics'), { fallback: true })
  assert.deepEqual(calls, ['status'])
  assert.deepEqual(observerCalls, [])
  assert.deepEqual(fallback, [{ action: 'diagnostics', updateStatus: status }])
})

test('a failed diagnostics read is reported without flattening its cause', async () => {
  const coordinator = { action: async () => { throw new Error('synthetic read failure') } }
  const { handler, fallback } = fixture(coordinator)
  await handler('diagnostics')
  assert.deepEqual(fallback, [{ action: 'diagnostics', updateStatus: { error: 'synthetic read failure' } }])
})

test('every existing action returns the coordinator result unchanged and records it', async () => {
  for (const action of ['check-updates', 'download-update', 'install-update', 'use-development-updates', 'download-content-update', 'enable-software-updates']) {
    const result = { shell: 'electron', update: { state: 'idle' }, contentUpdate: { state: 'current' } }
    const calls = []
    const coordinator = { action: async value => { calls.push(value); return result } }
    const { handler, recorded, calls: observerCalls } = fixture(coordinator)
    assert.equal(await handler(action), result)
    assert.deepEqual(calls, [action])
    assert.deepEqual(recorded, [result])
    assert.deepEqual(observerCalls, ['observer.record'])
  }
})

test('a failed action propagates and is not recorded as a display result', async () => {
  const coordinator = { action: async () => { throw new Error('synthetic action failure') } }
  const { handler, recorded } = fixture(coordinator)
  await assert.rejects(handler('install-update'), /synthetic action failure/)
  assert.deepEqual(recorded, [])
})

test('without a coordinator the existing workbench implementation still runs', async () => {
  const { handler, fallback, calls } = fixture(undefined)
  assert.deepEqual(await handler('status'), { fallback: true })
  assert.deepEqual(fallback, [{ action: 'status', updateStatus: undefined }])
  assert.deepEqual(calls, [])
})

test('an unrepresentable software snapshot never blocks a valid content status', async () => {
  for (const update of [
    { enabled: true, state: 'mystery' },
    { enabled: true, state: 'error', error: '此更新需要前往发行页面查看说明。' },
    { enabled: false, state: 'error', error: 'startup component unavailable' },
  ]) {
    const raw = { shell: 'electron', update, contentUpdate: { enabled: true, state: 'ready' } }
    const coordinator = { action: async action => { assert.equal(action, 'status'); return raw } }
    const observer = createProductUpdateObserver({ getCoordinator: () => coordinator })
    const handler = createWorkbenchUpdateHandler({ getCoordinator: () => coordinator, observer, runWorkbench: assert.fail })
    assert.equal(await handler('status'), raw)
    assert.deepEqual((await handler('status')).contentUpdate, { enabled: true, state: 'ready' })
    await assert.rejects(observer.presentation(), /更新状态暂时不可用/)
    observer.dispose()
  }
})

test('a classified error still reaches the official software presentation', async () => {
  const raw = { shell: 'electron', update: { enabled: true, state: 'error', failedOperation: 'download' },
    contentUpdate: { enabled: true, state: 'current' } }
  const coordinator = { action: async action => { assert.equal(action, 'status'); return raw } }
  const observer = createProductUpdateObserver({ getCoordinator: () => coordinator })
  const handler = createWorkbenchUpdateHandler({ getCoordinator: () => coordinator, observer, runWorkbench: assert.fail })
  assert.equal(await handler('status'), raw)
  assert.deepEqual(await observer.presentation(), { phase: 'error', failure: 'download' })
  observer.dispose()
})

test('a raw status read failure still rejects workbench status', async () => {
  const coordinator = { action: async () => { throw new Error('synthetic update read failure') } }
  const observer = createProductUpdateObserver({ getCoordinator: () => coordinator })
  const handler = createWorkbenchUpdateHandler({ getCoordinator: () => coordinator, observer, runWorkbench: assert.fail })
  await assert.rejects(handler('status'), /更新状态暂时不可用/)
  observer.dispose()
})
