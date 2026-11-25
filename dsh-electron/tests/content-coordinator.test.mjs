import test from 'node:test'
import assert from 'node:assert/strict'
import { updateCoordinator } from '../src/update-coordinator.mjs'

test('the default coordinator preserves the baseline status and never forwards migration actions', async () => {
  const calls = []
  const baseline = { shell: 'electron', version: '0.4.14', phase: 'ready', update: { enabled: true, installOnQuit: true } }
  const contentUpdate = { state: 'available' }
  const coordinator = updateCoordinator({ software: { action: async action => { calls.push(action); return baseline } },
    content: { snapshot: () => contentUpdate } })
  await assert.rejects(coordinator.action('start-portable-migration'), /未启用/)
  await assert.rejects(coordinator.action('dismiss-portable-migration'), /未启用/)
  assert.deepEqual(await coordinator.action('status'), { ...baseline, contentUpdate })
  assert.deepEqual(calls, ['status'])
})

test('one check exposes both statuses, and software download also starts compatible content',async()=>{
  const actions=[];let state='current',policy='stable',restarts=0,resolveDownload
  const content={state:{},snapshot:()=>({enabled:true,state,policy}),
    async check(){state='available'},async download(){state='downloading';await new Promise(resolve=>{resolveDownload=resolve});state='ready'},
    async selectPolicy(value){policy=value},async close(){resolveDownload?.()}}
  const software={async action(action){actions.push(action);return {shell:'electron',phase:'available',message:'',update:{state:'available',enabled:true,policy:action==='use-development-updates'?'development':policy}}},async close(){actions.push('close')}}
  const coordinator=updateCoordinator({software,content,version:'0.3.6',onRestart:()=>restarts++})
  assert.equal((await coordinator.action('check-updates')).contentUpdate.state,'available')
  assert.equal((await coordinator.action('download-update')).contentUpdate.state,'downloading')
  resolveDownload();await new Promise(resolve=>setImmediate(resolve))
  await coordinator.action('restart-content-update');await coordinator.action('restart-content-update')
  await new Promise(resolve=>setImmediate(resolve));assert.equal(restarts,1)
  await coordinator.close();assert.deepEqual(actions,['check-updates','status','download-update','status','status','close'])
})

test('content-only installations persist policy, pending content blocks a partial channel change',async()=>{
  let policy='stable',saved
  const content={state:{},snapshot:()=>({enabled:true,state:'current',policy}),async selectPolicy(value){policy=value},async close(){}}
  const coordinator=updateCoordinator({content,version:'0.3.6',onPolicy:async value=>{saved=value}})
  const value=await coordinator.action('use-development-updates')
  assert.equal(saved,'development');assert.equal(value.contentUpdate.policy,'development')
  content.state.pending='pending'
  await assert.rejects(coordinator.action('use-stable-updates'),/完成/)
  assert.equal(policy,'development')
  await assert.rejects(coordinator.action('restart-content-update'),/尚无/)
  await coordinator.close()
})

test('only an explicit check authorizes retrying a previously failed signed revision',async()=>{
  const checks=[]
  const content={snapshot:()=>({state:'current'}),async check(options){checks.push(options)},async close(){}}
  const coordinator=updateCoordinator({content,version:'0.3.6'})
  await coordinator.action('check-updates-background')
  await coordinator.action('check-updates')
  await coordinator.close()
  assert.deepEqual(checks,[{retryFailed:false},{retryFailed:true}])
})
