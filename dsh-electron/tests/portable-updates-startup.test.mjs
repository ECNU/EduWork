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
import { isContentFileError } from '../../dsh-host/content-updates.mjs'

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

test('EACCES and EPERM stop startup, preserve the cause and leave configuration and pending updates intact',async t=>{
 for(const code of ['EACCES','EPERM']) {
  const options=await fixture(t),pending=join(options.root,'data/state/pending-update.json'),config=join(options.root,'config/eduwork.jsonc')
  await mkdir(join(options.root,'data/state'),{recursive:true})
  await mkdir(join(options.root,'config'),{recursive:true})
  await writeFile(pending,'synthetic pending transaction')
  await writeFile(config,'// synthetic user configuration\n{}')
  await assert.rejects(startPortableUpdates({...options,spawnProcess:denied(code)}),error=>{
   assert.equal(error.code,'EDUWORK_UPDATER_START_FAILED')
   assert.equal(error.cause.code,code)
   assert.equal(error.executable,join(options.root,'resources/update/EduWork-Updater.exe'))
   assert.match(error.message,new RegExp(code))
   assert.equal(isContentFileError(error),true,'OS denial must not be reclassified as invalid publisher content')
   return true
  })
  assert.equal(await readFile(pending,'utf8'),'synthetic pending transaction')
  assert.equal(await readFile(config,'utf8'),'// synthetic user configuration\n{}')
 }
})

test('real child_process spawn of a missing helper rejects application preparation',async t=>{
 const options=await fixture(t)
 await assert.rejects(startPortableUpdates(options),error=>{
  assert.equal(error.code,'EDUWORK_UPDATER_START_FAILED')
  assert.equal(error.cause.code,'ENOENT')
  assert.match(error.cause.message,/spawn .*EduWork-Updater\.exe ENOENT/)
  return true
 })
})

test('disabling automatic updates does not bypass required component startup',async t=>{
 const options=await fixture(t)
 await assert.rejects(startPortableUpdates({...options,updates:{provider:'disabled'},spawnProcess:denied('EACCES')}),{code:'EDUWORK_UPDATER_START_FAILED'})
 assert.equal(JSON.parse(await readFile(join(options.root,'data/state/updates/electron-edition.json'),'utf8')).enabled,false)
})

test('configuration errors retain their own diagnosis before spawning a helper',async t=>{
 const options=await fixture(t)
 await assert.rejects(startPortableUpdates({...options,updates:{provider:'invalid'},spawnProcess:()=>assert.fail('Invalid configuration must not spawn')}),/不支持/)
})

test('synchronous process creation failures retain the same fatal component diagnosis',async t=>{
 const options=await fixture(t),cause=Object.assign(Error('Synthetic invalid executable'),{code:'ENOEXEC'})
 await assert.rejects(startPortableUpdates({...options,spawnProcess:()=>{throw cause}}),error=>{
  assert.equal(error.code,'EDUWORK_UPDATER_START_FAILED');assert.equal(error.cause,cause);return true
 })
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
  spawnProcess:(_file,_args,settings)=>spawn(process.execPath,[script],settings),
 }),/Invalid scheduled package/)
})
