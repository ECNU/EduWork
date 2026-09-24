import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startPortableUpdates } from '../src/portable-updates.mjs'
import { updateCoordinator } from '../src/update-coordinator.mjs'

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'eduwork-updater-startup-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 return {root,version:'0.0.0-dev.test',platform:'win32',updates:{provider:'github',repository:'example/product'},onQuit:()=>assert.fail('Must not quit')}
}
function denied(code) {
 return (_file,_args,options)=>{
  assert.equal(options.windowsHide,true)
  const child=new EventEmitter();child.stdin=new PassThrough()
  child.stdin.on('data',()=>assert.fail('Must not write before the OS confirms process creation'))
  process.nextTick(()=>child.emit('error',Object.assign(Error('Synthetic spawn '+code),{code})))
  return child
 }
}

test('EACCES and EPERM leave the app usable, report the cause and do not apply a pending update',async t=>{
 for(const code of ['EACCES','EPERM']) {
  const options=await fixture(t),pending=join(options.root,'data/state/pending-update.json'),errors=[]
  await mkdir(join(options.root,'data/state'),{recursive:true})
  await writeFile(pending,'synthetic pending transaction')
  const bridge=await startPortableUpdates({...options,spawnProcess:denied(code),onUnavailable:error=>errors.push(error)})
  const status=await bridge.action('status')
  assert.equal(status.phase,'error');assert.equal(status.update.enabled,false)
  assert.match(status.update.error,/Windows 拒绝启动更新器/)
  assert.match(status.update.error,new RegExp(code))
  assert.equal(errors[0].code,code)
  assert.equal((await bridge.action('check-updates')).update.state,'error')
  await assert.rejects(bridge.action('install-update'),/自动更新暂不可用/)
  assert.equal(await readFile(pending,'utf8'),'synthetic pending transaction')
  await bridge.close()
 }
})

test('real child_process spawn of a missing helper does not reject application preparation',async t=>{
 const options=await fixture(t),errors=[]
 const bridge=await startPortableUpdates({...options,onUnavailable:error=>errors.push(error)})
 assert.equal(errors[0].code,'ENOENT')
 assert.match((await bridge.action('status')).update.error,/未找到更新器/)
 await bridge.close()
})

test('disabled updates never spawn a helper or write updater state; invalid configuration remains an error',async t=>{
 const options=await fixture(t),spawnProcess=()=>assert.fail('Disabled updates must not spawn')
 assert.equal(await startPortableUpdates({...options,updates:{provider:'disabled'},spawnProcess}),null)
 await assert.rejects(readFile(join(options.root,'data/state/updates/electron-edition.json')),{code:'ENOENT'})
 await assert.rejects(startPortableUpdates({...options,updates:{provider:'invalid'},spawnProcess}),/不支持/)
})

test('signed content checks remain independent when the software updater cannot start',async t=>{
 const options=await fixture(t),checks=[]
 const software=await startPortableUpdates({...options,spawnProcess:denied('EACCES')})
 const content={snapshot:()=>({enabled:true,state:'current'}),async check(value){checks.push(value)},async close(){}}
 const coordinator=updateCoordinator({software,content,version:options.version})
 assert.equal((await coordinator.action('check-updates-background')).update.state,'error')
 assert.equal((await coordinator.action('check-updates')).contentUpdate.enabled,true)
 await coordinator.close()
 assert.deepEqual(checks,[{retryFailed:false},{retryFailed:true}])
})

test('successful process creation keeps the real pipe protocol and scheduled-install handoff',async t=>{
 const options=await fixture(t),script=join(options.root,'helper.mjs'),actions=[],quit=[]
 await writeFile(script,`import {createInterface} from 'node:readline';
 const lines=createInterface({input:process.stdin});
 lines.on('line',line=>{const {id,action}=JSON.parse(line);
 process.stdout.write(JSON.stringify({id,status:{enabled:true,state:'idle',action}})+'\\n');
 if(action==='install-update')process.stdout.write(JSON.stringify({event:'quit-for-update'})+'\\n');
 });`)
 const bridge=await startPortableUpdates({...options,onQuit:()=>quit.push(true),spawnProcess:(_file,args,settings)=>{
  assert.equal(args[0],'serve')
  const child=spawn(process.execPath,[script],settings)
  createInterface({input:child.stdout}).on('line',line=>actions.push(JSON.parse(line)))
  return child
 }})
 assert.deepEqual(actions.slice(0,2).map(row=>row.status.action),['apply-scheduled','check-updates'])
 assert.equal((await bridge.action('status')).phase,'idle')
 await bridge.action('install-update')
 await bridge.close()
 assert.equal(quit.length,1)
})

test('errors reported after the helper has launched remain fatal instead of bypassing update checks',async t=>{
 const options=await fixture(t),script=join(options.root,'reject-helper.mjs')
 await writeFile(script,`import {createInterface} from 'node:readline';
 createInterface({input:process.stdin}).on('line',line=>{
 const {id}=JSON.parse(line);process.stdout.write(JSON.stringify({id,error:'Invalid scheduled package'})+'\\n');
 });`)
 await assert.rejects(startPortableUpdates({...options,
  onUnavailable:()=>assert.fail('Only OS launch failures may degrade to unavailable'),
  spawnProcess:(_file,_args,settings)=>spawn(process.execPath,[script],settings),
 }),/Invalid scheduled package/)
})
