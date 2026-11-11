import test from 'node:test'
import assert from 'node:assert/strict'
import { DesktopExit } from '../src/desktop-exit.mjs'
import { updateCoordinator } from '../src/update-coordinator.mjs'

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
