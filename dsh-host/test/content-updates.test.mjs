import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ContentUpdates } from '../content-updates.mjs'
import { compareVersions, digest, verifiedManifest, validateBundle } from '../content-update-protocol.mjs'
import { loadUserConfig } from '../user-config.mjs'
import { createContentUpdate } from '../../scripts/create-content-update.mjs'

const version='0.3.6-dev.20260916.1'
const requires={minClient:version,dsh:'0.1.5-rc.2',capabilities:['package:@eduwork/dsh-oidc']}
const skill=(body='---\nname: example\ndescription: Example skill\n---\nUse the installed tools.')=>{
  const bytes=Buffer.from(body)
  return {entries:[{name:'example',requires}],files:[{path:'example/SKILL.md',data:bytes.toString('base64'),bytes:bytes.length,sha256:digest(bytes)}]}
}
async function fixture(t,permissions={}) {
  const root=await mkdtemp(join(tmpdir(),'eduwork-content-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const product=join(root,'resources/product'),configPath=join(root,'config/eduwork.jsonc')
  await mkdir(join(product,'skills/example'),{recursive:true});await mkdir(join(root,'config'))
  const builtin=Buffer.from('builtin skill'),keys=generateKeyPairSync('ed25519')
  await writeFile(join(product,'skills/example/SKILL.md'),builtin)
  await writeFile(join(root,'RELEASE-MANIFEST.json'),JSON.stringify({files:[{path:'resources/product/skills/example/SKILL.md',sha256:digest(builtin)}]}))
  const source={publisher:'example',baseURL:'https://updates.example.test/content',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),configuration:true,skills:false,...permissions}
  const base={schemaVersion:1,product:{name:'Custom name'},desktop:{closeAction:'exit'},features:{visionFallback:false,maxConcurrentRequests:3},organizations:[],contentUpdates:source}
  await writeFile(configPath,JSON.stringify(base))
  const environment={version,dshVersion:requires.dsh,capabilities:requires.capabilities},responses=new Map(),requests=[]
  const fetchImpl=async url=>{requests.push(url);return new Response(responses.get(url)??'',{status:responses.has(url)?200:404})}
  const options={root,product,configPath,version,distribution:'example',identity:{dshVersion:requires.dsh,managedPackages:{'@eduwork/dsh-oidc':{}}},policy:'development',fetchImpl}
  const open=async()=>new ContentUpdates(options).init()
  const release=(revision,components={configuration:revision},bundle={schemaVersion:1,configuration:{features:{visionFallback:true}}},extra={})=>{
    const bytes=Buffer.from(JSON.stringify(bundle)),manifest={schemaVersion:1,publisher:source.publisher,channel:'development',revision,requires,components,bundle:{url:`${source.baseURL}/bundles/${revision}.json`,bytes:bytes.length,sha256:digest(bytes)},...extra}
    const payload=Buffer.from(JSON.stringify(manifest)),envelope={schemaVersion:1,payload:payload.toString('base64url'),signature:sign(null,payload,keys.privateKey).toString('base64url')}
    responses.set(source.baseURL+'/'+manifest.channel+'/latest.json',JSON.stringify(envelope));responses.set(manifest.bundle.url,bytes)
    return {manifest,envelope,bytes}
  }
  return {root,product,configPath,base,source,keys,environment,responses,requests,options,open,release}
}

test('content activates only after restart, preserves base config and commits after desktop ready',async t=>{
  const f=await fixture(t,{skills:true}),original=await readFile(f.configPath,'utf8'),manager=await f.open()
  f.release(1,{configuration:1,skills:1},{schemaVersion:1,configuration:{features:{visionFallback:true}},skills:skill()})
  await manager.prepare();assert.equal((await manager.check()).state,'available')
  assert.equal((await manager.download()).state,'ready')
  assert.equal(manager.snapshot().configurationRevision,0)
  assert.equal(await readFile(f.configPath,'utf8'),original)
  const restarted=await f.open(),prepared=await restarted.prepare()
  assert.equal(prepared.configurationRevision,1);assert.equal(prepared.skillsRevision,1)
  const effective=loadUserConfig(f.configPath,{overlay:prepared.configurationPatch})
  assert.equal(effective.features.visionFallback,true);assert.equal(effective.features.maxConcurrentRequests,3)
  assert.equal(effective.closeAction,'exit');assert.equal(effective.product.name,'Custom name')
  assert.match(await readFile(join(prepared.skillRoot,'example/SKILL.md'),'utf8'),/installed tools/)
  assert.equal(await readFile(join(f.product,'skills/example/SKILL.md'),'utf8'),'builtin skill')
  await restarted.ready()
  const stable=await f.open();assert.equal((await stable.prepare()).configurationRevision,1)
  await stable.selectPolicy('stable');assert.equal(stable.snapshot().configurationRevision,1)
  f.release(1,{configuration:1,skills:1},{schemaVersion:1,configuration:{features:{visionFallback:true}},skills:skill()},{channel:'stable'})
  assert.equal((await stable.check()).state,'current')
  assert.equal(await readFile(f.configPath,'utf8'),original)
})

test('failed trial and interrupted startup roll back both components without a restart loop',async t=>{
  const f=await fixture(t,{skills:true})
  f.release(1,{configuration:1,skills:1},{schemaVersion:1,configuration:{features:{visionFallback:true}},skills:skill()})
  let manager=await f.open();await manager.check();await manager.download()
  manager=await f.open();await manager.prepare();await manager.ready()
  f.release(2,{configuration:2,skills:2},{schemaVersion:1,configuration:{features:{visionFallback:false}},skills:skill('updated')})
  await manager.check();await manager.download()
  const trial=await f.open();assert.equal((await trial.prepare()).configurationRevision,2)
  // Simulate termination before desktopReady; journal still points at revision 1.
  const afterCrash=await f.open(),restored=await afterCrash.prepare()
  assert.equal(restored.configurationRevision,1);assert.equal(restored.skillsRevision,1)
  assert.equal((await afterCrash.check()).state,'error')
  f.release(3,{configuration:3,skills:3},{schemaVersion:1,configuration:{features:{visionFallback:true}},skills:skill()});await afterCrash.check();await afterCrash.download()
  const next=await f.open();await next.prepare();assert.equal(await next.rollback(),true)
  assert.equal(await next.rollback(),false)
  assert.equal((await (await f.open()).prepare()).configurationRevision,1)
})

test('invalid signature, digest, dependencies and forbidden config never change installed content',async t=>{
  const f=await fixture(t),manager=await f.open()
  const offer=f.release(1)
  const other=generateKeyPairSync('ed25519')
  offer.envelope.signature=sign(null,Buffer.from(offer.envelope.payload,'base64url'),other.privateKey).toString('base64url')
  f.responses.set(f.source.baseURL+'/development/latest.json',JSON.stringify(offer.envelope))
  assert.equal((await manager.check()).state,'error')
  f.release(2);await manager.check()
  f.responses.set(f.source.baseURL+'/bundles/2.json','corrupt')
  assert.equal((await manager.download()).state,'error');assert.equal(manager.state.pending,null)
  f.release(3,undefined,undefined,{requires:{...requires,minClient:'0.4.0'}})
  assert.equal((await manager.check()).state,'requires_software')
  f.release(4,undefined,undefined,{requires:{...requires,capabilities:['tool:missing']}})
  assert.equal((await manager.check()).state,'requires_software')
  f.release(5,{configuration:5},{schemaVersion:1,configuration:{updates:{provider:'disabled'}}})
  await manager.check();assert.equal((await manager.download()).state,'error')
  assert.equal(manager.state.pending,null)
  f.release(6,{configuration:6},{schemaVersion:1,configuration:{features:{visionFallback:'invalid'}}})
  await manager.check();assert.equal((await manager.download()).state,'error')
  assert.equal(loadUserConfig(f.configPath).features.visionFallback,false)
  assert.equal((await readdir(manager.store)).filter(name=>name.startsWith('.stage-')).length,0)
})

test('a newer full package supersedes stale config and cancels incompatible pending content',async t=>{
  const f=await fixture(t);f.release(1)
  let manager=await f.open();await manager.check();await manager.download()
  manager=await f.open();await manager.prepare();await manager.ready()
  f.base.contentUpdates.bundled={configuration:2}
  await writeFile(f.configPath,JSON.stringify(f.base))
  manager=await f.open();assert.equal((await manager.prepare()).configurationPatch,undefined)
  assert.equal(manager.snapshot().configurationRevision,2)
  f.release(3);await manager.check();await manager.download()
  f.options.version='0.4.0';f.options.identity.dshVersion='0.2.0'
  manager=await f.open();assert.deepEqual(await manager.prepare(),{})
  assert.equal(manager.state.pending,null)
})

test('local bundled skill edits prevent replacement; personal and workspace skills are untouched',async t=>{
  const f=await fixture(t,{skills:true,configuration:false}),manager=await f.open()
  await mkdir(join(f.root,'data/personal-skills'),{recursive:true})
  await writeFile(join(f.root,'data/personal-skills/SKILL.md'),'personal')
  await writeFile(join(f.product,'skills/example/SKILL.md'),'local edit')
  f.release(1,{skills:1},{schemaVersion:1,skills:skill()})
  await manager.check();assert.equal((await manager.download()).state,'error')
  assert.equal(await readFile(join(f.product,'skills/example/SKILL.md'),'utf8'),'local edit')
  assert.equal(await readFile(join(f.root,'data/personal-skills/SKILL.md'),'utf8'),'personal')
})

test('configuration management is opt-in and a missing generic config remains usable',async t=>{
  const f=await fixture(t,{skills:true});f.base.contentUpdates.configuration=false
  await writeFile(f.configPath,JSON.stringify(f.base))
  const manager=await f.open();f.release(1)
  assert.equal((await manager.check()).state,'error')
  await rm(f.configPath)
  const disabled=await f.open();assert.equal(disabled.snapshot().enabled,false)
  assert.deepEqual(await disabled.prepare(),{})
})

test('signed skills reject path traversal, executable payloads, duplicate files and undeclared entries',async t=>{
  const f=await fixture(t)
  for(const path of ['../escape','example/../../escape','example/CON.txt','example/file.exe','example/file.dll','example/file:stream','/abs','example\\file','example/end.','unlisted/SKILL.md']) {
    const skills=skill();skills.files[0].path=path
    const item=f.release(1,{skills:1},{schemaVersion:1,skills})
    assert.throws(()=>validateBundle(item.bytes,item.manifest,f.environment),undefined,path)
  }
  const skills=skill();skills.files.push({...skills.files[0],path:'EXAMPLE/skill.md'})
  const item=f.release(1,{skills:1},{schemaVersion:1,skills})
  assert.throws(()=>validateBundle(item.bytes,item.manifest,f.environment),/重复/)
})

test('signed manifest is bound to publisher/channel and same-origin content root',async t=>{
  const f=await fixture(t)
  for(const extra of [{publisher:'other'},{channel:'stable'},{bundle:{url:'https://evil.example.test/x',bytes:2,sha256:'a'.repeat(64)}}]) {
    const item=f.release(1,undefined,undefined,extra)
    assert.throws(()=>verifiedManifest(item.envelope,f.source,'development'))
  }
  assert.equal(compareVersions('0.3.6-dev.20260916.10','0.3.6-dev.20260916.9'),1)
  assert.equal(compareVersions('0.3.6','0.3.6-dev.20260916.10'),1)
})

test('publisher CLI output is consumable and signing-key mismatches fail before output',async t=>{
  const f=await fixture(t,{skills:true}),planFile=join(f.root,'plan.json'),keyFile=join(f.root,'key.pem'),output=join(f.root,'release')
  await writeFile(keyFile,f.keys.privateKey.export({type:'pkcs8',format:'pem'}))
  await writeFile(join(f.root,'config-patch.json'),JSON.stringify({features:{visionFallback:true}}))
  await writeFile(planFile,JSON.stringify({channel:'development',revision:1,requires,configuration:{revision:1,path:'config-patch.json'},skills:{revision:1,path:'resources/product/skills',entries:[{name:'example',requires}]}}))
  const manifest=await createContentUpdate({config:f.configPath,planFile,keyFile,output})
  const envelope=JSON.parse(await readFile(join(output,'development/latest.json'),'utf8'))
  assert.equal(verifiedManifest(envelope,f.source,'development').bundle.sha256,manifest.bundle.sha256)
  const filename=new URL(manifest.bundle.url).pathname.split('/').at(-1)
  f.responses.set(f.source.baseURL+'/development/latest.json',JSON.stringify(envelope));f.responses.set(manifest.bundle.url,await readFile(join(output,'bundles',filename)))
  const manager=await f.open();await manager.check();assert.equal((await manager.download()).state,'ready')
  await writeFile(keyFile,generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}))
  await assert.rejects(createContentUpdate({config:f.configPath,planFile,keyFile,output:join(f.root,'bad')}),/签名/)
})

test('offline clients catch every component from the latest snapshot and unchanged revisions stay active',async t=>{
  const f=await fixture(t,{skills:true}),snapshot=(configuration,skills)=>({schemaVersion:1,configuration:{features:{maxConcurrentRequests:configuration}},skills:skill('skill revision '+skills)})
  let manager=await f.open()
  f.release(1,{configuration:1,skills:1},snapshot(1,1));await manager.check();await manager.download()
  manager=await f.open();await manager.prepare();await manager.ready()
  f.release(2,{configuration:2,skills:1},snapshot(2,1))
  // The device misses release 2, then sees a later Skills-only change.
  f.release(3,{configuration:2,skills:2},snapshot(2,2));await manager.check();await manager.download()
  manager=await f.open();let prepared=await manager.prepare();await manager.ready()
  assert.equal(prepared.configurationRevision,2);assert.equal(prepared.skillsRevision,2)
  assert.equal(prepared.configurationPatch.features.maxConcurrentRequests,2)
  const oldSkillRoot=prepared.skillRoot
  f.release(4,{configuration:3,skills:2},snapshot(3,2));await manager.check();await manager.download()
  manager=await f.open();prepared=await manager.prepare();await manager.ready()
  assert.equal(prepared.configurationRevision,3);assert.equal(prepared.skillsRevision,2)
  assert.equal(prepared.skillRoot,oldSkillRoot)
  // Reopening must not drop newer configuration because another component is bundled.
  f.base.contentUpdates.bundled={configuration:1,skills:2};await writeFile(f.configPath,JSON.stringify(f.base))
  manager=await f.open();prepared=await manager.prepare()
  assert.equal(prepared.configurationRevision,3);assert.equal(prepared.skillRoot,undefined)
  f.release(5,{configuration:4},{schemaVersion:1,configuration:{features:{maxConcurrentRequests:4}}})
  assert.equal((await manager.check()).state,'error')
  assert.match(manager.snapshot().message,/所有组件/)
})
