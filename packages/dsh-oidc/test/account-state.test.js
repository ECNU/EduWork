import assert from 'node:assert/strict'
import test from 'node:test'
import { createAccountState, selectConnectedModel } from '../src/client/account-state.js'

const signedOut = { profileID: 'school', state: 'signed_out', credentialReady: false }
const authenticated = { ...signedOut, state: 'authenticated', userName: 'Example' }
const connected = { ...authenticated, state: 'connected', credentialReady: true }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('one shared snapshot updates every consumer and rejects a stale mount read after provisioning', async () => {
  const old = deferred(), seen = [[], [], []], selected = []
  let reads = 0
  const { service } = createAccountState({ status: () => { reads++; return old.promise }, reconcile: async () => connected }, { connected: async id => selected.push(id) })
  seen.forEach(values => service.subscribeAccounts(id => values.push(service.accountSnapshot(id))))
  const a = service.status('school'), b = service.status('school')
  assert.equal(reads, 1)
  await service.reconcile('school', { allowProvision: true })
  old.resolve(signedOut)
  assert.equal(await a, connected)
  assert.equal(await b, connected)
  for (const values of seen) assert.deepEqual(values, [connected])
  assert.deepEqual(selected, ['school'])
})

test('desktop login publishes identity then provisioning connects all consumers and activates once', async () => {
  const selected = [], observed = []
  let ready = authenticated
  const { service } = createAccountState({
    begin: async () => ({ mode: 'external', loginID: 'attempt' }),
    loginStatus: async () => ({ state: 'completed', status: ready }),
    reconcile: async () => connected,
  }, { connected: async id => selected.push(id) })
  service.subscribeAccounts(id => observed.push(service.accountSnapshot(id).state))
  await service.begin('school')
  await service.loginStatus('attempt')
  assert.deepEqual(selected, [])
  await service.reconcile('school', { allowProvision: true })
  assert.deepEqual(observed, ['authenticated', 'connected'])
  assert.deepEqual(selected, ['school'])
  // A previous polling closure cannot roll the newly provisioned account back.
  await service.loginStatus('attempt')
  assert.equal(service.accountSnapshot('school'), connected)
  assert.deepEqual(selected, ['school'])
})

test('already provisioned desktop callback selects only once; passive refresh never overrides choices', async () => {
  let selected = 0
  const { service } = createAccountState({
    begin: async () => ({ mode: 'external', loginID: 'attempt' }),
    loginStatus: async () => ({ state: 'completed', status: connected }),
    status: async () => ({ ...connected }), reconcile: async () => ({ ...connected }),
  }, { connected: async () => { selected++ } })
  await service.begin('school')
  await Promise.all([service.loginStatus('attempt'), service.loginStatus('attempt')])
  const snapshot = service.accountSnapshot('school')
  await service.refreshAccounts(['school'])
  await service.reconcile('school', { allowProvision: false })
  assert.equal(service.accountSnapshot('school'), snapshot, 'unchanged snapshots stay referentially stable')
  assert.equal(selected, 1)
})

test('late desktop polling and stale status cannot revive an explicitly signed-out account', async () => {
  const late = deferred(), old = deferred()
  let selected = 0
  const { service } = createAccountState({ begin: async () => ({ mode: 'external', loginID: 'attempt' }),
    loginStatus: () => late.promise, status: () => old.promise, logout: async () => signedOut,
  }, { connected: async () => { selected++ } })
  await service.begin('school')
  const poll = service.loginStatus('attempt'), read = service.status('school')
  await service.logout('school')
  late.resolve({ state: 'completed', status: connected }); old.resolve(connected)
  await Promise.all([poll, read])
  assert.equal(service.accountSnapshot('school'), signedOut)
  assert.equal(selected, 0)
})

test('failed model selection keeps the connected account visible and permits a deliberate retry', async () => {
  let fail = true
  const { service } = createAccountState({ reconcile: async () => connected }, { connected: async () => { if (fail) throw new Error('model unavailable') } })
  await assert.rejects(service.reconcile('school', { allowProvision: true }), /model unavailable/)
  assert.equal(service.accountSnapshot('school'), connected)
  fail = false
  await service.reconcile('school', { allowProvision: true })
})

test('without a session, enterprise selection still persists the official global default', async () => {
  const calls = []
  await selectConnectedModel({ get: name => name === 'sessions' ? { list: { getSnapshot: () => ({ current: null }) } } : undefined }, {
    selectEnterpriseModel: async (...args) => { calls.push(args); return { changed: true, selection: { provider: 'school', model: 'chat' } } },
  }, 'school')
  assert.deepEqual(calls, [['school', { onlyIfMissing: false }]])
})

test('explicit login uses DSH 0.1.5 session ModelDirectory and leaves addressed subagents alone', async () => {
  const calls = [], selection = { provider: 'school', model: 'chat', reasoningEffort: 'high' }
  let subagent
  const ctx = { get: name => name === 'sessions' ? {
    list: { getSnapshot: () => ({ current: 'session-1' }) }, subagentAddress: () => subagent,
  } : { directoryFor: id => { calls.push(id); return { select: async value => calls.push(value) } } } }
  const service = { selectEnterpriseModel: async () => ({ changed: true, selection }) }
  await selectConnectedModel(ctx, service, 'school')
  assert.deepEqual(calls, ['session-1', selection])
  subagent = { id: 'subagent' }
  await selectConnectedModel(ctx, service, 'school')
  assert.equal(calls.length, 2)
})

test('upgrade recovery preserves a valid current personal model while repairing the future default', async () => {
  let selected = 0, available = true
  const ctx = { get: name => name === 'sessions' ? {
    list: { getSnapshot: () => ({ current: 'session-1' }) }, subagentAddress: () => undefined,
  } : { directoryFor: () => ({ load: async () => ({ current: { provider: 'personal', model: 'chat' }, routable: available }), select: async () => { selected++ } }) } }
  const service = { selectEnterpriseModel: async () => ({ changed: true, selection: { provider: 'school', model: 'chat' } }) }
  await selectConnectedModel(ctx, service, 'school', true)
  assert.equal(selected, 0)
  available = false
  await selectConnectedModel(ctx, service, 'school', true)
  assert.equal(selected, 1)
})
