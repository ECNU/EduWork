import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionCwd } from '../lib/session-workspace.js'

test('live Session owns its cwd, including an absent cwd; no stale disk fallback', async () => {
  for (const cwd of ['/synthetic workspace', undefined]) {
    const ctx = { sessions: { get: () => ({ header: { cwd } }) }, get: () => { throw new Error('Unexpected disk read') } }
    assert.equal(await sessionCwd(ctx, 'session'), cwd)
  }
})

test('cold Session uses an exact read-only observation and releases its lease', async () => {
  const signal = new AbortController().signal
  let disposed = 0
  const ctx = { sessions: { get: () => undefined }, get: name => {
    assert.equal(name, 'sessionQuery')
    return { async observeSession(id, options) {
      assert.equal(id, 'stored'); assert.equal(options.signal, signal); assert.equal(options.projectionMode, 'none')
      return { header: { id, cwd: '/stored workspace' }, [Symbol.dispose]() { disposed++ } }
    } }
  } }
  assert.equal(await sessionCwd(ctx, 'stored', signal), '/stored workspace')
  assert.equal(disposed, 1)
})

test('older Hosts and missing Sessions remain unavailable; corrupt storage fails closed', async () => {
  const ctx = query => ({ sessions: { get: () => undefined }, get: () => query })
  assert.equal(await sessionCwd(ctx(undefined), 'absent'), undefined)
  assert.equal(await sessionCwd(ctx({ observeSession() { throw Object.assign(new Error('missing'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' }) } }), 'absent'), undefined)
  const corrupt = Object.assign(new Error('corrupt'), { code: 'SESSION_QUERY_CORRUPT_SESSION' })
  await assert.rejects(sessionCwd(ctx({ observeSession() { throw corrupt } }), 'corrupt'), error => error === corrupt)
})

test('identity mismatch and cancellation reject and release observed Sessions', async () => {
  for (const cancelled of [false, true]) {
    const abort = new AbortController(); let disposed = 0
    const ctx = { sessions: { get: () => undefined }, get: () => ({ observeSession() {
      if (cancelled) abort.abort(new Error('cancelled read'))
      return { header: { id: cancelled ? 'session' : 'another', cwd: '/forbidden' }, [Symbol.dispose]() { disposed++ } }
    } }) }
    await assert.rejects(sessionCwd(ctx, 'session', abort.signal), cancelled ? /cancelled read/ : /identity does not match/)
    assert.equal(disposed, 1)
  }
})
