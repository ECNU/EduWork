import test from 'node:test'
import assert from 'node:assert/strict'
import { createBuiltinPasswordAgent } from '../src/builtin-password-agent.mjs'

const request = { action: 'login', provider: 'builtin', url: 'https://example.test/login', sessionId: 'conversation' }
function fixture({ approveResult = true, failure, entries = [{ id: 'one', username: 'demo' }] } = {}) {
  const trace = [], secret = 'synthetic-password-never-in-result'
  const vault = { findForOrigin: () => ({ ok: true, value: { exact: entries } }),
    getPassword: () => { trace.push('decrypt'); return { ok: true, value: secret } }, markUsed: () => trace.push('used') }
  const handle = createBuiltinPasswordAgent({ vault, isEnabled: () => true,
    approve: async () => { trace.push('approve'); return approveResult ? entries[0] : null },
    getDestination: async session => { trace.push(session); return {} },
    login: { open: async (_target, _destination, _signal, options) => {
      assert.equal(options.automatic, true); trace.push('open')
      return { fill: async credential => { assert.equal(credential.password, secret); trace.push('fill'); if (failure) throw Error(failure) },
        submit: async () => trace.push('submit'), transfer: async () => trace.push('transfer'), close: async () => trace.push('close') }
    } } })
  return { handle, trace, secret }
}
test('authorization precedes decryption; results contain status only; grant is conversation-scoped', async () => {
  const { handle, trace, secret } = fixture()
  assert.deepEqual(await handle(request), { status: 'session-ready' })
  assert.ok(trace.indexOf('approve') < trace.indexOf('decrypt'))
  assert.deepEqual(trace.slice(-4), ['submit', 'transfer', 'used', 'close'])
  assert.equal(JSON.stringify(await handle(request)).includes(secret), false)
  assert.equal(trace.filter(value => value === 'approve').length, 1)
  await handle({ ...request, sessionId: 'other' })
  assert.equal(trace.filter(value => value === 'approve').length, 2)
  handle.revoke(); await handle(request)
  assert.equal(trace.filter(value => value === 'approve').length, 3)
})
test('Agent use is disabled by default before touching vault', async () => {
  const handle = createBuiltinPasswordAgent({ vault: { findForOrigin() { throw Error('must not read') } } })
  assert.deepEqual(await handle(request), { status: 'agent-login-disabled' })
})
test('denial and absent account never decrypt or create a credential page', async () => {
  const denied = fixture({ approveResult: false })
  assert.deepEqual(await denied.handle(request), { status: 'cancelled' })
  assert.deepEqual(denied.trace, ['approve'])
  const absent = fixture({ entries: [] })
  assert.deepEqual(await absent.handle(request), { status: 'no-saved-account' })
  assert.deepEqual(absent.trace, [])
})
test('unsafe requests and cancellation stop before credentials', async () => {
  const { handle, trace } = fixture()
  for (const url of ['http://example.test', 'https://user:password@example.test', 'https://example.test/?password=x', 'https://example.test/#x']) {
    assert.deepEqual(await handle({ ...request, url }), { status: 'invalid-request' })
  }
  assert.deepEqual(await handle({ ...request, targetId: 'another' }), { status: 'invalid-request' })
  const controller = new AbortController(); controller.abort(Error('secret'))
  assert.deepEqual(await handle(request, controller.signal), { status: 'cancelled' })
  assert.deepEqual(trace, [])
})
test('provider errors cannot leak into model context and never hand off a failed login', async () => {
  const { handle, trace } = fixture({ failure: 'synthetic-password-never-in-result' })
  assert.deepEqual(await handle(request), { status: 'operation-failed' })
  assert.ok(!trace.includes('transfer')); assert.equal(trace.at(-1), 'close')
})
test('revocation during account approval stops before decryption', async () => {
  let resume
  const entry = { id: 'one', username: 'demo' }
  const handle = createBuiltinPasswordAgent({ isEnabled: () => true,
    vault: { findForOrigin: () => ({ ok: true, value: { exact: [entry] } }), getPassword() { assert.fail('must not decrypt') } },
    approve: () => new Promise(resolve => { resume = resolve }) })
  const pending = handle(request)
  assert.deepEqual(await handle(request), { status: 'busy' })
  handle.revoke(); resume(entry)
  assert.deepEqual(await pending, { status: 'cancelled' })
})

test('revoking during fill prevents submit and session handoff', async () => {
  const trace = [], entry = {id:'one',username:'demo'}
  let handle
  handle = createBuiltinPasswordAgent({isEnabled:()=>true,
    vault:{findForOrigin:()=>({ok:true,value:{exact:[entry]}}),getPassword:()=>({ok:true,value:'synthetic'})},
    approve:async()=>entry,getDestination:async()=>({}),
    login:{open:async()=>({fill:async()=>handle.revoke(),submit:async()=>trace.push('submit'),transfer:async()=>trace.push('transfer'),close:async()=>trace.push('close')})}})
  assert.deepEqual(await handle(request),{status:'cancelled'})
  assert.deepEqual(trace,['close'])
})
