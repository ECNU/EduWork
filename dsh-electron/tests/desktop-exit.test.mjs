import test from 'node:test'
import assert from 'node:assert/strict'
import { DesktopExit } from '../src/desktop-exit.mjs'
import { updateCoordinator } from '../src/update-coordinator.mjs'
import { DesktopLifecycle } from '../src/lifecycle.mjs'

test('installed update stops the Host before installer handoff without awaiting its own queue', { timeout: 500 }, async () => {
  const events = [], lifecycle = new DesktopLifecycle()
  let operation, quitRequest
  const exit = new DesktopExit({ confirm: assert.fail, close: () => lifecycle.close(), relaunch: assert.fail,
    quit() {}, failed: assert.fail })
  lifecycle.trackHost({ async updateTasks(action) { assert.equal(action, 'lock'); return false },
    async stop(requireGraceful) { assert.equal(requireGraceful, true); events.push('host stopped') } })
  lifecycle.trackBridge({ async close() { await operation; events.push('update bridge closed') } })
  const coordinator = updateCoordinator({ beforeInstall: async () => { events.push('confirm'); return true },
    content: { snapshot: () => ({}) }, software: { async action() {
      await exit.prepareInstaller(() => lifecycle.prepareUpdateStop(false), assert.fail)
      assert.equal(exit.installerOwnsQuit, true)
      events.push('quitAndInstall')
      quitRequest = exit.request()
      return {}
    } } })
  operation = coordinator.action('install-update')
  await operation
  await quitRequest
  assert.deepEqual(events, ['confirm', 'host stopped', 'quitAndInstall', 'update bridge closed'])
})

for (const updateFirst of [false, true]) {
  test(`ordinary quit and installer share one stop (update first: ${updateFirst})`, { timeout: 500 }, async () => {
    const lifecycle = new DesktopLifecycle(), stopStarted = Promise.withResolvers(), stopFinished = Promise.withResolvers()
    const lockStarted = Promise.withResolvers(), lockGranted = Promise.withResolvers(), stops = [], failures = []
    lifecycle.trackHost({
      async updateTasks(action) {
        if (action === 'lock') { lockStarted.resolve(); await lockGranted.promise }
        return false
      },
      async stop(requireGraceful) { stops.push(requireGraceful); stopStarted.resolve(); await stopFinished.promise },
    })
    const exit = new DesktopExit({ confirm: async () => true, close: () => lifecycle.close(),
      relaunch: assert.fail, quit() {}, failed: failure => failures.push(failure) })
    let installerStarts = 0
    const install = (async () => {
      await exit.prepareInstaller(() => lifecycle.prepareUpdateStop(false))
      installerStarts++
    })()
    const result = Promise.allSettled([install])
    await lockStarted.promise
    if (updateFirst) { lockGranted.resolve(); await stopStarted.promise }
    const quit = exit.request()
    await stopStarted.promise
    lockGranted.resolve()
    stopFinished.resolve()
    await quit
    const [outcome] = await result
    assert.equal(outcome.status, updateFirst ? 'fulfilled' : 'rejected')
    assert.equal(installerStarts, updateFirst ? 1 : 0)
    assert.equal(exit.installerOwnsQuit, updateFirst)
    assert.deepEqual(stops, [updateFirst])
    assert.equal(failures.length, updateFirst ? 0 : 1)
  })
}

test('installed update RPC leaves Host admission before asynchronous shutdown waits for drain', { timeout: 500 }, async () => {
  const pendingRequests = new Set(), admitted = Promise.withResolvers(), installation = Promise.withResolvers()
  const lockAdmission = async () => {
    await Promise.all(pendingRequests)
    admitted.resolve()
  }
  const coordinator = updateCoordinator({ deferInstallResponse: true, content: { snapshot: () => ({}) },
    beforeInstall: async () => true,
    software: { async action(action) {
      if (action === 'install-update') {
        await lockAdmission()
        installation.resolve()
      }
      return { phase: 'installing' }
    } } })
  const rpc = (async () => {
    const request = Promise.withResolvers()
    pendingRequests.add(request.promise)
    try { return await coordinator.action('install-update') }
    finally { pendingRequests.delete(request.promise); request.resolve() }
  })()
  const response = await Promise.race([rpc, new Promise((_, reject) => setTimeout(() => reject(Error('install RPC waited for Host admission drain')), 200))])
  assert.equal(response.phase, 'installing')
  await admitted.promise
  await installation.promise
})

test('failed Host stop reports recovery and never hands off to the installer', async () => {
  const error = Error('Synthetic Host stop failure'), failures = []
  const exit = new DesktopExit({ confirm: assert.fail, close: assert.fail, relaunch: assert.fail, quit: assert.fail,
    failed: failure => failures.push(failure) })
  const recoveries = []
  const lifecycle = new DesktopLifecycle()
  lifecycle.trackHost({ async stop() { throw error } })
  const install = async () => {
    await exit.prepareInstaller(() => lifecycle.stopHosts(), failure => recoveries.push(failure))
    assert.fail('quitAndInstall must not run')
  }
  await assert.rejects(install(), { errors: [error] })
  assert.deepEqual(recoveries, [exit.failure])
  assert.deepEqual(failures, [exit.failure])
  assert.equal(exit.installerOwnsQuit, false)
  assert.equal(exit.complete, false)
})

test('an update task that starts after confirmation unlocks the Host and blocks installation', async () => {
  const events = [], lifecycle = new DesktopLifecycle()
  lifecycle.trackHost({
    async updateTasks(action) { events.push(action); return action === 'lock' },
    async stop() { events.push('stop'); },
  })
  await assert.rejects(lifecycle.prepareUpdateStop(false), /New tasks started/)
  assert.deepEqual(events, ['lock', 'unlock'])
})

test('update installation requires a graceful Host stop', async () => {
  const events = [], lifecycle = new DesktopLifecycle()
  lifecycle.trackHost({
    async updateTasks(action) { events.push(action); return false },
    async stop(requireGraceful) { events.push(['stop', requireGraceful]); },
  })
  await lifecycle.prepareUpdateStop(false)
  assert.deepEqual(events, ['lock', ['stop', true]])
})

test('a forced Host termination blocks installer handoff and unlocks when possible', async () => {
  const events = [], lifecycle = new DesktopLifecycle()
  lifecycle.trackHost({
    async updateTasks(action) { events.push(action); return false },
    async stop(requireGraceful) { events.push(['stop', requireGraceful]); throw Error('forced termination') },
  })
  await assert.rejects(lifecycle.prepareUpdateStop(false), error => error instanceof AggregateError && /forced termination/.test(error.errors[0].message))
  assert.deepEqual(events, ['lock', ['stop', true], 'unlock'])
})

test('a Host without shutdown-complete blocks installer handoff', async () => {
  const lifecycle = new DesktopLifecycle()
  lifecycle.trackHost({
    async updateTasks() { return false },
    async stop(requireGraceful) {
      assert.equal(requireGraceful, true)
      throw Error('shutdown was not acknowledged')
    },
  })
  await assert.rejects(lifecycle.prepareUpdateStop(false), error => error instanceof AggregateError && /shutdown was not acknowledged/.test(error.errors[0].message))
})

test('an unavailable Host task inspection cannot authorize installer handoff', async () => {
  const lifecycle = new DesktopLifecycle()
  lifecycle.trackHost({ updateTasks: async () => { throw Error('Host unavailable') }, stop: assert.fail })
  await assert.rejects(lifecycle.updateTasks('inspect'), /Host unavailable/)
})

test('immediate teardown defers the final quit beyond the native event microtasks', async () => {
  let closed, quit = false
  const cleanup = new Promise(resolve => { closed = resolve })
  const exit = new DesktopExit({ confirm: async () => true, close: async () => closed(),
    relaunch: assert.fail, quit: () => { quit = true }, failed: assert.fail })
  const pending = exit.request()
  await cleanup
  await Promise.resolve()
  assert.equal(quit, false)
  await pending
  assert.equal(quit, true)
})

test('cancelling a restart does not register a later surprise relaunch', async () => {
  const calls = []; let approve = false
  const exit = new DesktopExit({ confirm: async () => approve, close: async () => calls.push('close'),
    relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit'), failed: assert.fail })
  exit.restart(); await exit.request()
  assert.deepEqual(calls, ['quit']); assert.equal(exit.complete, false)
  assert.equal(exit.closing, false)
  approve = true; await exit.request()
  assert.deepEqual(calls, ['quit', 'close', 'quit'])
})

test('installation approval precedes the helper handoff and is never requested twice', async () => {
  const calls = []
  const confirm = async () => { calls.push('confirm'); return true }
  const exit = new DesktopExit({ confirm, close: async () => calls.push('close'), relaunch: assert.fail,
    quit: () => calls.push('quit'), failed: assert.fail })
  const coordinator = updateCoordinator({ version: '0.0.0', beforeInstall: confirm,
    content: { snapshot: () => ({}), close: async () => {} },
    software: { action: async action => { calls.push(action); if (action === 'install-update') exit.handoff(); return {} } } })
  await coordinator.action('install-update'); await exit.request()
  assert.deepEqual(calls, ['confirm', 'install-update', 'quit', 'close', 'quit'])
  assert.equal(exit.complete, true)
})

test('a cancelled installation never starts the helper; concurrent quit requests join cleanup', async () => {
  const actions = []
  const coordinator = updateCoordinator({ beforeInstall: async () => false,
    content: { snapshot: () => ({}) }, software: { action: async action => { actions.push(action); return {} } } })
  await coordinator.action('install-update'); assert.deepEqual(actions, ['status'])
  let release; let closes = 0
  const exit = new DesktopExit({ confirm: async () => true, close: () => { closes++; return new Promise(resolve => { release = resolve }) },
    relaunch: assert.fail, quit: () => {}, failed: assert.fail })
  const pending = exit.request(); assert.equal(exit.request(), pending)
  await new Promise(resolve => setImmediate(resolve)); assert.equal(closes, 1)
  assert.equal(exit.closing, true)
  exit.restart() // A late callback cannot change an accepted exit into a restart.
  release(); await pending; assert.equal(exit.complete, true)
})

test('an approved quit completes with a logged failure even when service cleanup fails', async () => {
  const calls = [], error = Error('Synthetic cleanup failure'); let recorded
  const exit = new DesktopExit({ confirm: async () => true, close: async () => { calls.push('close'); throw error },
    relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit'), failed: failure => { recorded = failure } })
  await exit.request()
  assert.equal(recorded, error)
  assert.equal(exit.failure, error)
  assert.equal(exit.complete, true)
  assert.deepEqual(calls, ['close', 'quit'])
})

test('an installer handoff completes even when service cleanup fails', async () => {
  const calls = [], error = Error('Synthetic Host stop failure')
  const exit = new DesktopExit({ confirm: assert.fail, close: async () => { calls.push('close'); throw error },
    relaunch: assert.fail, quit: () => calls.push('quit'), failed: () => {} })
  exit.handoff()
  await exit.request()
  assert.equal(exit.complete, true)
  assert.equal(calls.filter(value => value === 'quit').length, 2)
})

test('an installer handoff during a failed strict restart still completes the quit', async () => {
  const calls = [], error = Error('Synthetic Host stop failure')
  let rejectClose, startedClose
  const started = new Promise(resolve => { startedClose = resolve })
  const exit = new DesktopExit({ confirm: async () => true,
    close: () => { startedClose(); return new Promise((_, reject) => { rejectClose = reject }) },
    relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit'), failed: failure => calls.push(failure) })
  const restart = exit.restart({ strict: true })
  await started
  exit.handoff()
  rejectClose(error)
  await restart
  assert.equal(exit.complete, true)
  assert.equal(exit.failure, error)
  assert.equal(calls.includes('relaunch'), false)
  assert.equal(calls.filter(value => value === 'quit').length, 3)
})

test('a strict restart requires a confirmed stop and does not poison a later normal exit', async () => {
  const calls = [], error = Error('Synthetic cleanup failure')
  let fail = true
  const exit = new DesktopExit({ confirm: async () => true,
    close: async () => { calls.push('close'); if (fail) throw error },
    relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit'), failed: () => {} })
  await exit.restart({ strict: true })
  assert.equal(exit.complete, false)
  assert.equal(exit.failure, error)
  assert.equal(calls.includes('relaunch'), false)
  fail = false
  await exit.request()
  assert.equal(exit.complete, true)
  assert.equal(calls.includes('relaunch'), false, 'A failed strict restart must not retain a relaunch request')
})

test('a confirmation failure keeps the process running without cleanup or quit', async () => {
  const calls = [], error = Error('Synthetic quit dialog failure'); let recorded
  const exit = new DesktopExit({ confirm: async () => { throw error },
    close: async () => calls.push('close'), relaunch: () => calls.push('relaunch'),
    quit: () => calls.push('quit'), failed: failure => { recorded = failure } })
  await exit.request()
  assert.equal(recorded, error)
  assert.equal(exit.complete, false)
  assert.equal(exit.closing, false)
  assert.equal(exit.pending, undefined)
  assert.deepEqual(calls, [], 'A rejected confirmation must not run cleanup or quit')
})

test('an approved pending quit keeps its baseline outcome while a strict restart waits', async () => {
  const calls = []
  const exit = new DesktopExit({ confirm: async () => true,
    close: async () => { calls.push('close'); throw Error('Synthetic bridge cleanup failure') },
    relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit'), failed: () => {} })
  const pending = exit.request()
  const restarting = exit.restart({ strict: true })
  await pending
  assert.equal(exit.complete, true, 'The approved ordinary quit completes with baseline semantics')
  assert.equal(calls.includes('relaunch'), false, 'The waiting strict restart must not relaunch the approved quit')
  await restarting
  assert.equal(calls.includes('relaunch'), false)
})

test('a strict restart waits for a pending quit and does not leak into the next exit', async () => {
  let confirmations = 0, recorded
  const calls = []
  const exit = new DesktopExit({ confirm: async () => ++confirmations > 1,
    close: async () => { calls.push('close'); throw Error('Synthetic cleanup failure') },
    relaunch: () => calls.push('relaunch'), quit: () => calls.push('quit'), failed: error => { recorded = error } })
  const pending = exit.request()
  const restarting = exit.restart({ strict: true })
  await pending
  assert.equal(exit.complete, false)
  assert.equal(calls.includes('relaunch'), false, 'A cancelled quit must not relaunch')
  // The declined quit releases the strict restart; its cleanup failure stays strict.
  await restarting
  assert.equal(exit.complete, false)
  assert.equal(recorded.message, 'Synthetic cleanup failure')
  assert.equal(calls.includes('relaunch'), false)
  // A later normal exit is not poisoned by the strict attempt.
  await exit.request()
  assert.equal(exit.complete, true)
  assert.equal(calls.includes('relaunch'), false)
})

test('native updater termination uses the normal quit guard and cancellation permits a later retry', async () => {
  const calls=[];let approve=false
  const exit=new DesktopExit({confirm:async()=>{calls.push('confirm');return approve},
    close:async()=>calls.push('close'),quit:()=>calls.push('quit'),relaunch:assert.fail,failed:assert.fail})
  const coordinator=updateCoordinator({content:{snapshot:()=>({})},
    software:{action:async action=>{if(action==='install-update')await exit.request();return {}}}})
  await coordinator.action('install-update')
  assert.deepEqual(calls,['confirm']);assert.equal(exit.complete,false)
  approve=true;await coordinator.action('install-update')
  assert.deepEqual(calls,['confirm','confirm','close','quit']);assert.equal(exit.complete,true)
})
