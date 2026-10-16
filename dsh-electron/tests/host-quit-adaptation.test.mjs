import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { adaptHostQuit } from '../scripts/host-quit-adaptation.mjs'

// Mirrors the official compiled stop(); only the graceful wait is adapted.
const official = `const exitsWithin = (promise, ms) => Promise.race([promise.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
export class Host {
  async stop(requireGraceful = false) {
    const child = this.child;
    this.stopping = true;
    child.send({ type: 'shutdown' });
    const exited = this.exitPromise;
    const graceful = await exitsWithin(exited, 10_000);
    if (!graceful) child.kill('SIGTERM');
    return { graceful, signals: child.signals };
  }
}
`

async function load(source) {
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).Host
}

function lingeringChild(host, { acknowledgeAfter = 20, exitOnSignal = true } = {}) {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null, signals: [],
    send() { setTimeout(() => { host.shutdownCompleted = true }, acknowledgeAfter) },
    kill(signal) { child.signals.push(signal); if (exitOnSignal) { child.signalCode = signal; child.emit('exit') } } })
  host.child = child
  // The child never exits on its own: a leftover handle keeps its event loop alive.
  host.exitPromise = new Promise((resolve) => child.once('exit', resolve))
  return host
}

test('an acknowledged shutdown ends a lingering Host shortly instead of after the graceful window', async () => {
  const Host = await load(adaptHostQuit(official))
  const host = lingeringChild(new Host())
  const started = Date.now()
  const result = await host.stop()
  assert.ok(Date.now() - started < 2000, `stop took ${Date.now() - started} ms`)
  assert.equal(result.graceful, true)
  assert.deepEqual(result.signals, ['SIGKILL'])
})

test('update installs keep the strict official wait', async () => {
  const adapted = adaptHostQuit(official).replace('10_000', '300')
  const Host = await load(adapted)
  const host = lingeringChild(new Host())
  const result = await host.stop(true)
  assert.equal(result.graceful, false, 'a lingering Host is not reported graceful for updates')
})

test('a Host that exits by itself is never signalled', async () => {
  const Host = await load(adaptHostQuit(official))
  const host = lingeringChild(new Host(), { acknowledgeAfter: 5 })
  setTimeout(() => { host.child.exitCode = 0; host.child.emit('exit') }, 10)
  const result = await host.stop()
  assert.equal(result.graceful, true)
  assert.deepEqual(result.signals, [])
})

test('a changed official anchor fails the build instead of silently skipping', () => {
  assert.throws(() => adaptHostQuit('export class Host {}'), /anchor changed/)
})
