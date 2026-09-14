import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { zstdCompressSync } from 'node:zlib'
import { DataImporter, findImportHomes } from '../lib/data-import.js'
import { inspectSession } from '../lib/import-inspection.js'

const runtime = process.env.EDUWORK_TEST_RUNTIME
test('legacy v0 descriptor v2 imports losslessly and remains usable by the current subagent runtime', {skip:!runtime},async t=>{
 const req=createRequire(join(runtime,'package.json')),load=name=>import(pathToFileURL(req.resolve(name)))
 const [{Context},{default:Jsonl},{sessionFormatCatalog:formats},{foldSubagentDescriptor}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-session-persistence-jsonl'),load('@deepseek-ai/dsh-session-format-catalog'),load('@deepseek-ai/dsh-subagent')])
 const root=await mkdtemp(join(tmpdir(),'eduwork-descriptor-v2-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const source=join(root,'old'),home=join(root,'new'),cwd=join(root,'workspace')
 await mkdir(home);await mkdir(cwd)
 const dir=join(source,'data/dsh/sessions/project/child');await mkdir(dir,{recursive:true})
 const file=join(dir,'session.jsonl.zstd'),header={type:'session',version:0,id:'child',createdAt:100,cwd,delegationDepth:1,parentSession:'parent',agentPreset:'standard'}
 const descriptor={version:2,mode:'continuable',provider:'spawn',label:'Historical child',agentProvider:'provider',agentModel:'model',persona:'Keep this persona',toolFilter:{deny:['write']}}
 const row=data=>({type:'subagent/descriptor',seq:0,time:100,data})
 const encode=data=>zstdCompressSync(Buffer.from([header,row(data)].map(r=>JSON.stringify(r)).join('\n')+'\n'))
 const bytes=encode(descriptor);await writeFile(file,bytes)
 const openStore=async path=>{const ctx=new Context();await ctx.plugin(Jsonl,{root:path,compression:'zstd'});return {persistence:ctx.sessionPersistence,close:()=>ctx.fiber.dispose()}}
 const dst=await openStore(join(home,'sessions')),importer=new DataImporter({home,persistence:dst.persistence,openStore,loadFormats:async()=>formats})
 try {
  importer.preview(source);await importer.running;assert.equal(importer.status().excluded,0,JSON.stringify(importer.status()));assert.equal(importer.status().total,1)
  importer.start(importer.status().id);await importer.running;assert.equal(importer.status().imported,1,JSON.stringify(importer.status()))
  const handle=await dst.persistence.open('child','read')
  try{const {events}=await handle.read();assert.deepEqual(foldSubagentDescriptor(events),{...descriptor,version:3});assert.equal(handle.header.parentSession,'parent')}finally{await handle.close()}
  assert.deepEqual(await readFile(file),bytes)
  for(const invalid of [{...descriptor,version:4},{...descriptor,futureComposition:true},{...descriptor,toolFilter:{deny:[42]}},{...descriptor,label:undefined}]){
   await writeFile(file,encode(invalid))
   await assert.rejects(inspectSession({path:file,version:0,compression:'zstd'},formats))
  }
 }finally{await importer.close();await dst.close()}
})

for (const location of ['external', 'inside-program']) test(`missing ${location} workspace preserves and registers the conversation in a new empty directory`, {skip:!runtime},async t=>{
 const req=createRequire(join(runtime,'package.json')),load=name=>import(pathToFileURL(req.resolve(name)))
 const [{Context},{default:Jsonl},{sessionFormatCatalog:formats}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-session-persistence-jsonl'),load('@deepseek-ai/dsh-session-format-catalog')])
 const root=await mkdtemp(join(tmpdir(),'eduwork-cross-machine-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const source=join(root,'old'),home=join(root,'new'),missing=join(location==='external'?root:source,'not-on-this-machine','project')
 await mkdir(home)
 const openStore=async path=>{const ctx=new Context();await ctx.plugin(Jsonl,{root:path,compression:'zstd'});return{persistence:ctx.sessionPersistence,close:()=>ctx.fiber.dispose()}}
 const src=await openStore(join(source,'data/dsh/sessions')),dst=await openStore(join(home,'sessions'))
 const registered=[]
 const importer=new DataImporter({home,persistence:dst.persistence,openStore,loadFormats:async()=>formats,register:async(cwd,id)=>registered.push({cwd,id})})
 try{
  const h=await src.persistence.create({version:3,id:'cross-machine-fixture',createdAt:100,cwd:missing,isSeeded:false,delegationDepth:0,agentPreset:'standard'})
  await h.append([{seq:0,type:'session/title',time:100,data:{title:'Retained history',source:{kind:'user'},messageSeqs:[]}}]);await h.flush();await h.close()
  importer.preview(source);await importer.running;assert.equal(importer.status().total,1)
  importer.start(importer.status().id);await importer.running
  assert.equal(importer.status().imported,1,JSON.stringify(importer.status()))
  assert.ok(importer.status().warnings.some(w=>w.includes('原工作区不在此机器上')))
  const restored=await dst.persistence.open('cross-machine-fixture','read')
  try{assert.notEqual(restored.header.cwd,missing);assert.equal((await stat(restored.header.cwd)).isDirectory(),true);assert.deepEqual(await readdir(restored.header.cwd),[]);assert.equal((await restored.read()).events[0].data.title,'Retained history');assert.deepEqual(registered,[{cwd:restored.header.cwd,id:'cross-machine-fixture'}])}finally{await restored.close()}
 }finally{await importer.close();await src.close();await dst.close()}
})
test('imports old and current logs through official persistence, keeps conflicts and skips repeats', { skip: !runtime }, async () => {
 const req=createRequire(join(runtime,'package.json')),load=name=>import(pathToFileURL(req.resolve(name)))
 const [{Context},{default:Jsonl}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-session-persistence-jsonl')])
 const loadFormats=async()=>(await load('@deepseek-ai/dsh-session-format-catalog')).sessionFormatCatalog
 const runImport=async(importer,source)=>{importer.preview(source);await importer.running;assert.equal(importer.status().state,'ready',JSON.stringify(importer.status()));assert.ok(importer.status().total,JSON.stringify(importer.status()));importer.start(importer.status().id);await importer.running}
 const openStore=async(root,compression='zstd')=>{const ctx=new Context();await ctx.plugin(Jsonl,{root,compression});return {persistence:ctx.sessionPersistence,close:()=>ctx.fiber.dispose()}}
 const root=await mkdtemp(join(tmpdir(),'eduwork-import-test-')),source=join(root,'旧版 客户端'),home=join(root,'新客户端','data','dsh'),srcHome=join(source,'data','dsh'),workspace=join(source,'workspace')
 await mkdir(home,{recursive:true});await mkdir(workspace,{recursive:true});await writeFile(join(workspace,'notes.md'),'# 资料')
 await mkdir(join(srcHome,'attachments'),{recursive:true});await writeFile(join(srcHome,'attachments','中文.txt'),'attachment')
 await writeFile(join(home,'settings.yaml'),'keep-model-config')
 const src=await openStore(join(srcHome,'sessions')),dst=await openStore(join(home,'sessions'))
 const header={version:3,id:'session-import-fixture',createdAt:100,cwd:workspace,isSeeded:false,delegationDepth:0,agentPreset:'standard'}
 const event=title=>({seq:0,type:'session/title',time:100,data:{title,messageSeqs:[],source:{kind:'user'}}})
 let handle
 try {
  handle=await src.persistence.create(header);await handle.append([event('跨机的会话')]);await handle.flush();await handle.close()
  const importer=new DataImporter({home,persistence:dst.persistence,openStore,loadFormats});await runImport(importer,source)
  assert.equal(importer.status().state,'complete',JSON.stringify(importer.status()));assert.equal(importer.status().imported,1,JSON.stringify(importer.status()))
  handle=await dst.persistence.open(header.id,'read');const imported=await handle.read();assert.equal(imported.events[0].data.title,'跨机的会话');assert.notEqual(handle.header.cwd,workspace);assert.equal(await readFile(join(handle.header.cwd,'notes.md'),'utf8'),'# 资料');await handle.close()
  await runImport(importer,source);assert.equal(importer.status().skipped,1);assert.equal(importer.status().imported,0)
  // A second copy of the same ID with different history is retained separately.
  const other=join(root,'other');await mkdir(join(other,'data','dsh'),{recursive:true});const branch=await openStore(join(other,'data','dsh','sessions'))
  try{handle=await branch.persistence.create({...header,cwd:'Z:\\unavailable\\project'});await handle.append([event('另一个分支')]);await handle.flush();await handle.close()}finally{await branch.close()}
  await runImport(importer,other);assert.equal(importer.status().imported,1);assert.equal(importer.status().conflicts,1);assert.equal((await dst.persistence.list()).length,2)
  assert.match(importer.status().warnings.join('\n'),/原工作区/)
  await runImport(importer,other);assert.equal(importer.status().skipped,1);assert.equal((await dst.persistence.list()).length,2)
  assert.equal(await readFile(join(home,'settings.yaml'),'utf8'),'keep-model-config')
  assert.equal(await readFile(join(workspace,'notes.md'),'utf8'),'# 资料')
  const legacy=join(root,'legacy-v1'),legacyHome=join(legacy,'data','dsh'),legacyStore=await openStore(join(legacyHome,'sessions'))
  try{handle=await legacyStore.persistence.create({...header,id:'session-v1-fixture'});await handle.flush();await handle.close()}finally{await legacyStore.close()}
  const folders=await readdir(join(legacyHome,'sessions'),{recursive:true})
  const file=folders.find(f=>f.endsWith('.jsonl.zstd'));assert.ok(file)
  const physical=join(legacyHome,'sessions',file),v1=physical.replace('session.v3.jsonl.zstd','session.v1.jsonl')
  assert.notEqual(v1,physical)
  const oldText=JSON.stringify({type:'session',version:1,id:'session-v1-fixture',createdAt:100,cwd:workspace,delegationDepth:0,agentPreset:'standard'})+'\n'+JSON.stringify({...event('旧版 v1 会话'),data:{title:'旧版 v1 会话',messageSeqs:[],source:{kind:'user'}}})+'\n'
  await rm(physical);await writeFile(v1,oldText)
  await runImport(importer,legacy);assert.equal(importer.status().imported,1,JSON.stringify(importer.status()));assert.equal(await readFile(v1,'utf8'),oldText)
  // A pre-existing junction must not redirect imported attachments elsewhere.
  const linkRoot=join(root,'linked'),outside=join(root,'outside');await mkdir(linkRoot);await mkdir(outside)
  await symlink(outside,join(linkRoot,'attachments'),'junction')
  const linked=new DataImporter({home:linkRoot,persistence:dst.persistence,openStore,loadFormats});linked.preview(source);await linked.running
  assert.equal(linked.status().state,'error');assert.match(linked.status().message,/链接/);assert.deepEqual(await readdir(outside),[])
  await assert.rejects(findImportHomes(join(root,'新客户端'),home),/自身/)
  await assert.rejects(findImportHomes(join(root,'other','data'),home),/根目录/)
 }finally{await handle?.close();await src.close();await dst.close();await rm(root,{recursive:true,force:true})}
})

test('preflight accounts for future, malformed, mixed-generation and compressed logs before writing sessions', { skip: !runtime }, async () => {
 const req=createRequire(join(runtime,'package.json')),load=name=>import(pathToFileURL(req.resolve(name)))
 const [{Context},{default:Jsonl},{sessionFormatCatalog:formats}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-session-persistence-jsonl'),load('@deepseek-ai/dsh-session-format-catalog')])
 const openStore=async(root,compression='zstd')=>{const ctx=new Context();await ctx.plugin(Jsonl,{root,compression});return {persistence:ctx.sessionPersistence,close:()=>ctx.fiber.dispose()}}
 const root=await mkdtemp(join(tmpdir(),'eduwork-import-preflight-')),source=join(root,'旧客户端'),home=join(root,'target'),workspace=join(source,'workspace')
 await mkdir(home);await mkdir(workspace,{recursive:true});await writeFile(join(source,'release.json'),'{"version":"0.2.0-dev.20260909.3"}')
 const sessions=join(source,'data/dsh/sessions'),target=await openStore(join(home,'sessions'))
 const header=id=>({type:'session',version:3,id,createdAt:100,cwd:workspace,isSeeded:false,delegationDepth:0,agentPreset:'standard'})
 const event=(seq,title)=>({seq,type:'session/title',time:100+seq,data:{title,messageSeqs:[],source:{kind:'user'}}})
 const write=async(id,name,bytes)=>{const dir=join(sessions,'project',id);await mkdir(dir,{recursive:true});const file=join(dir,name);await writeFile(file,bytes);return file}
 const text=(id,version=3)=>JSON.stringify({...header(id),version})+'\n'+JSON.stringify(event(0,id))+'\n'
 const importer=new DataImporter({home,persistence:target.persistence,openStore,loadFormats:async()=>formats})
 try {
  await write('future','session.v4.jsonl',text('future',4))
  await write('future','session.v3.jsonl',text('future')) // must not silently use this older generation
  await write('broken','session.v3.jsonl',JSON.stringify(header('broken'))+'\n{bad\n')
  await write('mismatch','session.v2.jsonl',text('mismatch'))
  await write('v2','session.v2.jsonl',text('v2',2))
  const compressed=await write('compressed','session.v3.jsonl.zstd',Buffer.concat([
   zstdCompressSync(Buffer.from(JSON.stringify(header('compressed'))+'\n')),
   zstdCompressSync(Buffer.from(JSON.stringify(event(0,'first'))+'\n')),
   zstdCompressSync(Buffer.from(JSON.stringify(event(1,'second'))+'\n')),
  ]))
  const original=await readFile(compressed)
  await write('torn','session.v3.jsonl.zstd',Buffer.concat([zstdCompressSync(Buffer.from(text('torn'))),Buffer.from([0x28,0xb5,0x2f])]))
  await writeFile(join(sessions,'obsolete.jsonl'),text('obsolete'))
  assert.throws(()=>importer.start(source),/先检查/)
  importer.preview(source);await importer.running
  const job=importer.status()
  assert.equal(job.state,'ready',JSON.stringify(job));assert.equal(job.sourceVersion,'0.2.0-dev.20260909.3')
  assert.deepEqual(job.formats,[2,3,4]);assert.equal(job.total,2,JSON.stringify(job));assert.equal(job.excluded,5);assert.equal(job.found,7);assert.equal(job.scanned,7);assert.equal(job.olderCopies,1)
  assert.equal((await target.persistence.list()).length,0,'preflight must not merge live sessions')
  assert.ok(job.issues.some(row=>row.category==='unsupported'&&/更新客户端/.test(row.reason)))
  assert.ok(job.issues.some(row=>/第 2 行/.test(row.reason)))
  assert.throws(()=>importer.start('stale-preview'),/先检查/)
  importer.start(job.id);await importer.running
  assert.equal(importer.status().imported,2,JSON.stringify(importer.status()));assert.match(importer.status().message,/有未导入项/)
  const read=await target.persistence.open('compressed','read');try{assert.deepEqual((await read.read()).events.map(e=>e.data.title),['first','second'])}finally{await read.close()}
  assert.deepEqual(await readFile(compressed),original)
  const report=JSON.parse(await readFile(importer.status().report,'utf8'));assert.equal(report.issues.length,5)
  importer.preview(source);await importer.running;const stage=importer.prepared.staging;await importer.cancel();await assert.rejects(readFile(join(stage,'missing')),/ENOENT/)
 } finally {await importer.cleanup();await target.close();await rm(root,{recursive:true,force:true})}
})




