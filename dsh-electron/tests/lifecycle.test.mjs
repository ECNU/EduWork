import assert from 'node:assert/strict'
import test from 'node:test'
import { DesktopLifecycle } from '../src/lifecycle.mjs'

test('closing during startup waits for a late bridge and closes it before quitting', async () => {
  const lifecycle = new DesktopLifecycle(), events = []
  let release
  const barrier = new Promise(resolve => { release = resolve })
  const preparing = lifecycle.prepare(async () => {
    await barrier
    lifecycle.trackBridge({ async close() { events.push('bridge closed') } })
  })
  const closing = lifecycle.close().then(() => events.push('quit'))
  assert.deepEqual(events, [])
  release()
  await assert.rejects(preparing, /shutting down/)
  await closing
  assert.deepEqual(events, ['bridge closed', 'quit'])
  assert.throws(() => lifecycle.trackHost({}), /shutting down/)
})

test('a closed lifecycle does not retry failed hosts on another close', async () => {
  let stops = 0
  const lifecycle = new DesktopLifecycle()
  lifecycle.trackHost({ async stop() { stops++; throw Error('Synthetic stop failure') } })
  await lifecycle.close()
  await lifecycle.close()
  assert.equal(stops, 1, 'A second close must not pretend to retry the cached Host stop')
  assert.equal(lifecycle.failures.length, 1)
})

test('shutdown remains one operation and stops Hosts before credential bridges', async () => {
  const lifecycle = new DesktopLifecycle(), events = []
  lifecycle.trackHost({ async stop() { await Promise.resolve(); events.push('host stopped') } })
  lifecycle.trackBridge({ async close() { events.push('vault flushed') } })
  const first = lifecycle.close()
  assert.equal(lifecycle.close(), first)
  await first
  assert.deepEqual(events, ['host stopped', 'vault flushed'])
})
