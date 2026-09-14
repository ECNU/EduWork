import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,symlink,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import {ImageService} from '../packages/artifact-services/lib/images.js'
import {installImageTools} from '../packages/artifact-services/lib/image-tools.js'
import {installArtifactSkills} from '../packages/artifact-services/lib/skills.js'
import {ArtifactServices} from '../packages/artifact-services/lib/dsh.js'

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6WQAAAABJRU5ErkJggg==','base64')
async function fixture(){const root=await realpath(await mkdtemp(join(tmpdir(),'artifact-images-'))),path=join(root,'image.png');await writeFile(path,png);return {root,path}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('public host omits image tools and skills even when an adapter registers a provider',async()=>{
  for(const config of [{},{images:{enabled:false}}]) {
    const ctx=new Context(),registered=new Map(),skills=new Map()
    ctx.provide('tools',{register(tool){registered.set(tool.name,tool)}})
    ctx.provide('fs',{})
    ctx.provide('permissionPresets',{current:()=> 'workspace-write'})
    ctx.provide('skills',{register(skill){skills.set(skill.name,skill);return ()=>skills.delete(skill.name)}})
    const service=new ArtifactServices(ctx,config)
    let calls=0
    const unregister=service.registerImageProvider({id:'extension',available(){calls++;return true},generate(){calls++}})
    await service.ready;await tick()
    assert.equal(registered.has('image_generate'),false)
    assert.equal(registered.has('image_providers'),false)
    assert.equal(skills.has('artifact-images'),false)
    assert.ok(skills.has('artifact-presentations'))
    assert.ok(skills.has('artifact-video'))
    assert.deepEqual(await service.images.list(),[])
    await assert.rejects(service.images.generate({prompt:'unused'}),/disabled by host/)
    assert.equal(calls,0)
    unregister()
  }
})

test('images expose readiness and public capabilities, select only one available provider and preserve sizing results',async()=>{
  const {root,path}=await fixture(),source=join(root,'source.png');await writeFile(source,png)
  const calls=[],changes=[],service=new ImageService({onChange:()=>changes.push('changed')}),execution={name:'image_generate'},controller=new AbortController()
  let available=true
  const unregister=service.register({id:'extension',title:'Example images',local:false,available:async()=>available,secret:'credential-private',
    capabilities:{nativeSizes:['1536x1024'],customSize:true,fitModes:['crop','pad'],formats:['image/png'],secret:'private'},
    async generate(request){calls.push(request);return {path,mime:'image/png',relativePath:'wrong.png',size:'333x777',requestedSize:'333x777',generationSize:'1536x1024',sourceRelativePath:'source.png',sourceSize:'1536x1024',resized:true,secret:'provider-private'}}})
  service.register({id:'not-ready',available:async()=>{throw new Error('credential-private')},generate(){throw new Error('must not run')}})
  assert.deepEqual((await service.list())[0],{id:'extension',title:'Example images',local:false,available:true,capabilities:{nativeSizes:['1536x1024'],customSize:true,fitModes:['crop','pad'],formats:['image/png']}})
  assert.doesNotMatch(JSON.stringify(await service.list()),/private/)
  const result=await service.generate({prompt:'Exact visual request',size:'333x777',fit:'pad',projectPath:root,execution,sessionId:'s',signal:controller.signal})
  assert.deepEqual(result,{path,relativePath:'image.png',mime:'image/png',provider:'extension',size:'333x777',requestedSize:'333x777',generationSize:'1536x1024',sourceSize:'1536x1024',sourceRelativePath:'source.png',resized:true})
  assert.equal(calls[0].size,'333x777');assert.equal(calls[0].fit,'pad');assert.equal(calls[0].execution,execution);assert.equal(calls[0].sessionId,'s');assert.equal(calls[0].signal,controller.signal)
  available=false;await assert.rejects(service.generate({provider:'extension',prompt:'x',projectPath:root}),/unavailable/)
  await assert.rejects(service.generate({prompt:'x',projectPath:root}),/No image provider/)
  assert.throws(()=>service.register({id:'extension',generate(){}}),/Duplicate/)
  unregister();unregister();assert.equal(changes.length,3);assert.equal(calls.length,1)
})

test('ambiguous providers require explicit choice and failure or cancellation never invokes another provider',async()=>{
  const {root,path}=await fixture(),service=new ImageService(),calls=[]
  service.register({id:'one',generate:async()=>{calls.push('one');throw new Error('generation failed')}})
  const controller=new AbortController()
  service.register({id:'two',generate:async request=>{calls.push('two');request.signal?.throwIfAborted();controller.abort();return {path}}})
  await assert.rejects(service.generate({prompt:'x',projectPath:root}),/Multiple image providers/)
  await assert.rejects(service.generate({provider:'one',prompt:'x',projectPath:root}),/generation failed/)
  await assert.rejects(service.generate({provider:'two',prompt:'x',projectPath:root,signal:AbortSignal.abort()}),{name:'AbortError'})
  await assert.rejects(service.generate({provider:'two',prompt:'x',projectPath:root,signal:controller.signal}),{name:'AbortError'})
  assert.deepEqual(calls,['one','two'])
})

test('image files and preserved originals stay inside the real workspace and cannot be fake success',async()=>{
  const {root,path}=await fixture(),external=await fixture(),service=new ImageService();let response={path}
  service.register({id:'one',generate:async()=>response})
  const request={provider:'one',prompt:'x',projectPath:root}
  response={path:external.path};await assert.rejects(service.generate(request),/outside workspace/)
  await symlink(external.root,join(root,'outside'),process.platform==='win32'?'junction':'dir')
  response={path:join(root,'outside','image.png')};await assert.rejects(service.generate(request),/outside workspace/)
  response={path,mime:'image/jpeg'};await assert.rejects(service.generate(request),/MIME/)
  response={path,sourceRelativePath:'outside/image.png'};await assert.rejects(service.generate(request),/outside workspace/)
  response={path,sourceRelativePath:'../source.png'};await assert.rejects(service.generate(request),/outside workspace/)
  const fake=join(root,'fake.png');await writeFile(fake,'not an image')
  response={path:fake};await assert.rejects(service.generate(request),/unsupported image/)
  response={path:join(root,'missing.png')};await assert.rejects(service.generate(request),{code:'ENOENT'})
  response={path,size:'1024x1024',requestedSize:'1920x1080',generationSize:'1024x1024',sourceRelativePath:'image.png',sourceSize:'1024x1024',resized:false,resizeWarning:'Resize unavailable; original image preserved'}
  const fallback=await service.generate(request)
  assert.equal(fallback.resized,false);assert.equal(fallback.size,'1024x1024');assert.equal(fallback.requestedSize,'1920x1080');assert.match(fallback.resizeWarning,/original image preserved/)
})

test('unloading an image provider while readiness is being checked does not invoke it',async()=>{
  const {root,path}=await fixture(),service=new ImageService();let ready,started,calls=0
  const waiting=new Promise(resolve=>{started=resolve}),availability=new Promise(resolve=>{ready=resolve})
  const unregister=service.register({id:'one',available:async()=>{started();return availability},generate:async()=>{calls++;return {path}}})
  const pending=service.generate({provider:'one',prompt:'x',projectPath:root})
  await waiting;unregister();ready(true)
  await assert.rejects(pending,/unloaded/);assert.equal(calls,0)
})

test('image generation shares the Agent pre-execute permission boundary and preserves execution/cancellation context',async()=>{
  const {root,path}=await fixture(),service={images:new ImageService()},registered=new Map();let before,request
  service.images.register({id:'one',generate:async value=>{request=value;return {path}}})
  const ctx={tools:{register:tool=>registered.set(tool.name,tool)},on:(_,fn)=>{before=fn},permissionPresets:{current:()=> 'workspace-write'},fs:{resolve:async(path,{cwd})=>resolve(cwd,path),processPath:path=>path}}
  installImageTools(ctx,service)
  const exec={name:'image_generate',agent:{session:{id:'session',header:{cwd:root}}},signal:new AbortController().signal}
  assert.equal((await before(exec,()=>{throw new Error('not approved')})).kind,'ask')
  ctx.permissionPresets.current=()=> 'danger-full-access';assert.equal(await before(exec,()=> 'next'),'next')
  assert.equal((await before({...exec,agent:undefined},()=>{})).kind,'deny')
  assert.equal(await before({name:'image_providers'},()=> 'read'),'read')
  const tool=registered.get('image_generate')
  await assert.rejects(tool.execute({prompt:'x'},{...exec,agent:undefined}),/Agent workspace/)
  const result=await tool.execute({prompt:'x',size:'333x777',fit:'crop'},exec)
  assert.equal(request.execution,exec);assert.equal(request.execution.name,'image_generate');assert.equal(request.signal,exec.signal);assert.equal(request.sessionId,'session');assert.equal(request.projectPath,root)
  assert.deepEqual(tool.output.presentationMeta({},result),{relativePath:'image.png',mime:'image/png'})
  assert.equal(JSON.parse(result.reportJSON).provider,'one')
  assert.equal(JSON.parse((await registered.get('image_providers').execute({})).reportJSON)[0].available,true)
})

test('bundled image skill follows provider availability without duplicate registration or late resurrection',async()=>{
  const registrations=new Map(),listeners=new Map();let available=false,resolveCatalog
  const images={list:async()=>[{available}]},ctx={skills:{register(skill){assert.ok(!registrations.has(skill.name));registrations.set(skill.name,skill);return ()=>registrations.delete(skill.name)}},on(name,handler){listeners.set(name,handler);return ()=>listeners.delete(name)}}
  const dispose=installArtifactSkills(ctx,{images})
  await tick();assert.equal(registrations.has('artifact-images'),false)
  available=true;await listeners.get('artifact-services/images-changed')()
  assert.deepEqual(registrations.get('artifact-images').metadata,{artifact:{capability:'image-generation'}})
  await listeners.get('artifact-services/images-changed')();assert.equal(registrations.size,7)
  available=false;await listeners.get('artifact-services/images-changed')();assert.equal(registrations.has('artifact-images'),false)
  images.list=()=>new Promise(resolve=>{resolveCatalog=resolve})
  const pending=listeners.get('artifact-services/images-changed')();dispose();resolveCatalog([{available:true}]);await pending
  assert.equal(registrations.size,0);assert.equal(listeners.size,0)
})

test('ArtifactServices registry emits real Cordis events and refreshes bundled skills on credential changes',async()=>{
  const ctx=new Context(),registered=new Map(),skills=new Map(),events=[]
  ctx.provide('tools',{register(tool){registered.set(tool.name,tool)}})
  ctx.provide('fs',{})
  ctx.provide('permissionPresets',{current:()=> 'workspace-write'})
  ctx.provide('skills',{register(skill){skills.set(skill.name,skill);return ()=>skills.delete(skill.name)}})
  ctx.on('artifact-services/images-changed',()=>events.push('changed'))
  const service=new ArtifactServices(ctx,{images:{enabled:true}})
  await service.ready;await tick();assert.equal(skills.has('artifact-images'),false)
  let available=true
  const unregister=service.registerImageProvider({id:'one',available:async()=>available,generate(){}})
  await tick();assert.equal(events.length,1);assert.equal(skills.has('artifact-images'),true)
  available=false;service.refreshImageProviders();await tick();assert.equal(skills.has('artifact-images'),false)
  available=true;service.refreshImageProviders();await tick();assert.equal(skills.has('artifact-images'),true)
  unregister();await tick();assert.equal(events.length,4);assert.equal(skills.has('artifact-images'),false)
  assert.ok(registered.has('image_generate'));assert.ok(registered.has('image_providers'))
})
