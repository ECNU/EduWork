import test from 'node:test'
import assert from 'node:assert/strict'
import { DesktopExit } from '../src/desktop-exit.mjs'
import { updateCoordinator } from '../src/update-coordinator.mjs'

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

test('failed shutdown permits another exit without retaining a restart request', async () => {
  const calls = []; let fail = true
  const exit = new DesktopExit({ confirm: async () => true,
    close: async () => { calls.push('close'); if (fail) throw Error('Synthetic cleanup failure') },
    relaunch: assert.fail, quit: () => calls.push('quit'), failed: () => calls.push('failed') })
  exit.restart(); await exit.request()
  assert.equal(exit.closing, false); assert.equal(exit.complete, false)
  fail = false; await exit.request()
  assert.equal(exit.complete, true)
  assert.deepEqual(calls, ['quit', 'close', 'failed', 'close', 'quit'])
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
