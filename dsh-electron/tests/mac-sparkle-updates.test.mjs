import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import { startMacSparkleUpdates } from '../src/mac-sparkle-updates.mjs'

test('Sparkle stays disabled on Windows or in a candidate without a feed', () => {
  const fail = () => { throw Error('native module must not load') }
  assert.equal(startMacSparkleUpdates({ appPath: '/synthetic', version: '0.3.6', platform: 'win32', enabled: true, loadAddon: fail }), null)
  assert.equal(startMacSparkleUpdates({ appPath: '/synthetic', version: '0.3.6', platform: 'darwin', loadAddon: fail }), null)
})

test('manual check delegates once to native Sparkle without inventing Windows update states', async () => {
  const calls = []
  const bridge = startMacSparkleUpdates({ appPath: '/synthetic.app/Contents/Resources/app', version: '0.3.6', platform: 'darwin', enabled: true, feeds:{stable:'https://updates.example.org/stable.xml'},
    loadAddon: path => { calls.push(path); return { probe:()=>{},snapshot:()=>({state:'idle'}), start: () => calls.push('start'), check: () => calls.push('check'), setFeed:()=>{} } } })
  const before = await bridge.action('status')
  assert.equal(before.update.nativeUI, true)
  assert.equal(before.update.state, 'idle')
  assert.equal((await bridge.action('check-updates')).phase, 'ready')
  assert.deepEqual(calls, [join('/synthetic.app/Contents/Resources/app','native/sparkle.node'), 'start', 'check'])
  await bridge.action('download-update');assert.equal(calls.at(-1),'check')
})

test('missing native framework disables updates without aborting the desktop', async () => {
  const bridge = startMacSparkleUpdates({appPath:'/synthetic.app',version:'0.3.6',platform:'darwin',enabled:true,
    loadAddon:()=>{throw Error('framework missing')}})
  assert.equal((await bridge.action('status')).update.enabled,false)
  assert.match((await bridge.action('status')).message,/framework missing/)
  await assert.rejects(bridge.action('check-updates'),/framework missing/)
})

const feeds={stable:'https://updates.example.org/stable.xml',development:'https://updates.example.org/dev.xml'}
test('startup leaves native dialogs closed; explicit checks and channels preserve signed content updates', async()=>{
  const {updateCoordinator}=await import('../src/update-coordinator.mjs')
  const calls=[];let policy='stable',saved
  const software=startMacSparkleUpdates({appPath:'/app',version:'0.3.6',platform:'darwin',enabled:true,feeds,
    onPolicy:async value=>{saved=value},loadAddon:()=>({probe:()=>{},snapshot:()=>({state:'idle'}),start:url=>calls.push(url),check:()=>calls.push('check'),setFeed:url=>calls.push(url)})})
  const content={state:{},snapshot:()=>({enabled:true,state:'current',policy}),check:async()=>calls.push('content'),selectPolicy:async value=>{policy=value},close:async()=>{}}
  const coordinator=updateCoordinator({software,content,version:'0.3.6'})
  await coordinator.action('check-updates-background')
  assert.deepEqual(calls,[feeds.stable,'content'])
  await coordinator.action('check-updates')
  assert.deepEqual(calls.slice(-2),['check','content'])
  const status=await coordinator.action('use-development-updates')
  assert.equal(saved,'development');assert.equal(status.update.policy,'development');assert.equal(status.contentUpdate.policy,'development')
  assert.equal(calls.at(-1),feeds.development)
  await coordinator.close()
})
test('channel persistence failure restores the previous appcast',async()=>{
  const calls=[]
  const bridge=startMacSparkleUpdates({appPath:'/app',version:'0.3.6',platform:'darwin',enabled:true,feeds,
    onPolicy:async()=>{throw Error('disk full')},loadAddon:()=>({probe:()=>{},snapshot:()=>({state:'idle'}),start:()=>{},check:()=>{},setFeed:url=>calls.push(url)})})
  await assert.rejects(bridge.action('use-development-updates'),/disk full/)
  assert.deepEqual(calls,[feeds.development,feeds.stable]);assert.equal((await bridge.action('status')).update.policy,'stable')
})
test('unsafe or unconfigured channels fail closed before starting native updates',async()=>{
  for(const feeds of [{stable:'http://updates.example.org/a.xml'},{stable:'https://user:password@updates.example.org/a.xml'},{}]){
    let started=false
    const bridge=startMacSparkleUpdates({appPath:'/app',version:'0.3.6',platform:'darwin',enabled:true,feeds,
      loadAddon:()=>({probe:()=>{},snapshot:()=>({state:'idle'}),start:()=>{started=true},check:()=>{},setFeed:()=>{}})})
    assert.equal((await bridge.action('status')).update.enabled,false);assert.equal(started,false)
  }
})
