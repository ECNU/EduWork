import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { softwareUpdateControl, updatesWhenEnabled } from '../src/software-update-control.mjs'
import { updateCoordinator } from '../src/update-coordinator.mjs'

async function fixture(t, changes={}) {
  const dataRoot=await mkdtemp(join(tmpdir(),'eduwork-update-choice-'))
  t.after(()=>rm(dataRoot,{recursive:true,force:true}))
  const calls=[], starts=[], state={enabled:true,state:'up_to_date',policy:'development'}
  const options={dataRoot,version:'0.4.4-dev.20261016.1',policy:'development',
    start:async options=>{starts.push(options);return {
      action:async action=>{calls.push(action);if(action.startsWith('use-'))state.policy=action==='use-stable-updates'?'stable':'development';return {shell:'electron',version:'0.4.4-dev.20261016.1',phase:'ready',update:{...state}}},
      close:async()=>calls.push('close'),
    }},...changes}
  return {options,calls,starts,state,prefs:join(dataRoot,'state/software-update-preferences.json')}
}
test('development updates default on; off survives restart and does not start or check the backend',async t=>{
  const f=await fixture(t), control=await softwareUpdateControl(f.options)
  assert.equal((await control.action('status')).update.userEnabled,true)
  assert.deepEqual(f.starts,[{policy:'development',applyScheduled:true}])
  await control.action('disable-software-updates')
  const before=f.calls.length
  assert.equal((await control.action('check-updates-background')).update.enabled,false)
  assert.equal(f.calls.length,before)
  await assert.rejects(control.action('download-update'),/已关闭/)
  await control.close()
  const again=await softwareUpdateControl(f.options)
  assert.equal(f.starts.length,1)
  assert.equal((await again.action('status')).update.userEnabled,false)
  await again.close()
})
test('first runtime enable skips pending install; later ordinary startup resumes it',async t=>{
  const f=await fixture(t,{defaultEnabled:false}), control=await softwareUpdateControl(f.options)
  await control.action('enable-software-updates')
  assert.deepEqual(f.starts,[{policy:'development',applyScheduled:false}])
  await control.action('disable-software-updates');await control.action('enable-software-updates')
  assert.equal(f.starts.length,1,'Reuse the same native controller')
  await control.close()
  const again=await softwareUpdateControl(f.options)
  assert.equal(f.starts[1].applyScheduled,true)
  await again.close()
})
test('channels can change while disabled and survive first backend creation',async t=>{
  const saved=[], f=await fixture(t,{defaultEnabled:false,onPolicy:async policy=>saved.push(policy)})
  const control=await softwareUpdateControl(f.options)
  assert.equal((await control.action('use-stable-updates')).update.policy,'stable')
  assert.deepEqual(saved,['stable']);assert.equal(f.starts.length,0)
  await control.action('enable-software-updates')
  assert.equal(f.starts[0].policy,'stable')
  await control.close()
})
for(const changes of [{busy:true},{installOnQuit:true},{installOnNextStart:true},...['checking','downloading','ready','applying'].map(state=>({state}))]) {
  test('toggle cannot hide an active or scheduled installation '+JSON.stringify(changes),async t=>{
    const f=await fixture(t), control=await softwareUpdateControl(f.options)
    Object.assign(f.state,changes)
    await assert.rejects(control.action('disable-software-updates'),/正在处理/)
    await assert.rejects(control.action('use-stable-updates'),/正在处理/)
    assert.equal((await control.action('status')).update.userEnabled,true)
    await assert.rejects(readFile(f.prefs),{code:'ENOENT'})
    await control.close()
  })
}
test('failure to save leaves the backend and existing preference intact',async t=>{
  const f=await fixture(t), control=await softwareUpdateControl(f.options)
  await mkdir(f.prefs,{recursive:true})
  await assert.rejects(control.action('disable-software-updates'))
  assert.equal((await control.action('status')).update.userEnabled,true)
  await control.close()
})
test('failed runtime startup is visible and can be retried without resetting user data',async t=>{
  const f=await fixture(t,{defaultEnabled:false}), start=f.options.start
  let first=true
  f.options.start=async options=>{if(first){first=false;throw Error('Synthetic component failure')}return start(options)}
  const control=await softwareUpdateControl(f.options)
  await assert.rejects(control.action('enable-software-updates'),/Synthetic/)
  assert.match((await control.action('status')).update.error,/Synthetic/)
  assert.equal((await control.action('enable-software-updates')).update.enabled,true)
  await control.close()
})
test('software off does not stop independent signed content checks',async t=>{
  const f=await fixture(t,{defaultEnabled:false}), software=await softwareUpdateControl(f.options)
  let checks=0
  const content={snapshot:()=>({enabled:true,state:'current'}),check:async()=>{checks++},close:()=>{}}
  const coordinator=updateCoordinator({software,content,version:f.options.version})
  const result=await coordinator.action('check-updates')
  assert.equal(result.update.userEnabled,false);assert.equal(result.contentUpdate.enabled,true)
  await coordinator.close();assert.equal(checks,1);assert.equal(f.starts.length,0)
})
test('legacy opt-out is respected and sources are restored only in memory',async t=>{
  const updates={provider:'disabled',manifestURL:'https://example.org/stable/latest-windows-amd64.json',defaultPolicy:'development'}
  assert.deepEqual(updatesWhenEnabled(updates),{...updates,provider:'static'})
  assert.equal(updates.provider,'disabled')
  const f=await fixture(t,{defaultEnabled:false}), control=await softwareUpdateControl(f.options)
  assert.equal((await control.action('status')).update.userEnabled,false)
  await control.action('enable-software-updates');await control.close()
  const next=await softwareUpdateControl(f.options)
  assert.equal((await next.action('status')).update.userEnabled,true)
  await next.close()
})
test('invalid preferences are preserved and never silently interpreted as enabled',async t=>{
  const f=await fixture(t)
  await mkdir(join(f.options.dataRoot,'state'))
  for(const body of ['{"schemaVersion":1,"enabled":"false"}','null','false','0','""','[]']) {
    await writeFile(f.prefs,body)
    await assert.rejects(softwareUpdateControl(f.options),/偏好文件无效/)
    assert.equal(f.starts.length,0)
    assert.equal(await readFile(f.prefs,'utf8'),body)
  }
})
