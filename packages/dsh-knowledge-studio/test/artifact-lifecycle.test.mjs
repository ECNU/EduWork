import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {ArtifactEngine,ArtifactStore} from '../lib/artifacts.js'
import {StudioUIPreferences} from '../lib/ui-preferences.js'
import {installKnowledgeStudioTools} from '../lib/tools.js'

async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'studio-turn-')),path=join(dir,'artifacts.json')
  const workspace={id:'workspace',title:'合成工作区'},evidence={evidenceId:'source',path:'synthetic.md',content:'合成资料',excerpt:'合成资料',revisionHash:'r',excerptHash:'e',lineStart:1,lineEnd:1}
  const events=[{type:'turn/start',data:{turn:1}}],session={id:'session',snapshotEvents:()=>events}
  let valid=false,handler,calls=0
  const ctx={on:(_name,fn)=>{handler=fn},workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(){calls++;yield {type:'text-delta',index:0,text:JSON.stringify({title:'合成成果',nodes:[{id:'root',parentId:valid?'':'invalid',label:'主题',body:'完整内容',evidenceIds:['S1']}]})};yield {type:'finish',reason:{kind:'stop'}}}}}
  const manager={workspaceForAgent:async()=>workspace,status:async()=>({indexed:true}),searchDetailed:async()=>({results:[evidence]}),sample:async()=>[evidence],readEvidence:async()=>evidence}
  const engine=new ArtifactEngine(ctx,manager,{artifactPath:path});t.after(()=>engine.close())
  return {engine,path,workspace,session,ctx,manager,valid:value=>{valid=value},
    run:async(params={},signal=new AbortController().signal)=>engine.wait((await engine.start(workspace,'mindmap',params,session.id,signal,{agent:{session},callId:'call-'+calls})).id),
    end:async(reason='completed')=>{const event={type:'turn/end',data:{turn:1,reason:{kind:reason}}};events.push(event);handler(session,event);await engine.settleTurn(session.id,1,event.data.reason)}}
}
test('failure then repair shares an artifact and waits for real turn end after success',async t=>{
  const f=await fixture(t),failed=await f.run({targetKey:'map'})
  assert.equal(failed.status,'failed');assert.equal((await f.engine.read(failed.id)).status,'running')
  f.valid(true);const done=await f.run({retryArtifactId:failed.id})
  assert.equal(done.id,failed.id);assert.equal(done.status,'completed')
  const during=await f.engine.list('workspace');assert.equal(during.length,1);assert.equal(during[0].status,'running');assert.equal(during[0].attemptStatus,'completed')
  assert.equal(done.attempts.length,1);assert.match(done.attempts[0].draft.text,/invalid/)
  await f.end();assert.equal((await f.engine.read(done.id)).status,'completed')
  const disk=JSON.parse(await readFile(f.path,'utf8'));assert.equal(disk.artifacts.length,1);assert.equal(disk.artifacts[0].lifecycle.state,'settled')
})
test('separate deliverables keep their keys, while a successful target accepts further revisions',async t=>{
  const f=await fixture(t),one=await f.run({targetKey:'one'}),two=await f.run({targetKey:'two'})
  assert.notEqual(one.id,two.id)
  f.valid(true);const repaired=await f.run({targetKey:'one'});assert.equal(repaired.id,one.id)
  const improved=await f.run({retryArtifactId:one.id,focus:'改善标题与排版'});assert.equal(improved.id,one.id);assert.equal(improved.version,3)
  const final=await f.run({targetKey:'one',focus:'最后校对'});assert.equal(final.id,one.id);assert.equal(final.version,4)
  const third=await f.run({focus:'separate'});assert.notEqual(third.id,one.id)
  await f.end();assert.equal((await f.engine.list('workspace')).length,3)
  const g=await fixture(t),legacy=await g.run()
  g.valid(true);const automatic=await g.run()
  assert.equal(automatic.id,legacy.id,'one unambiguous legacy failure is retried in place')
  await g.end()
})

test('three successful same-turn revisions produce one final result despite title and focus changes',async t=>{
  const f=await fixture(t);f.valid(true)
  const one=await f.run({focus:'初版'}),two=await f.run({focus:'修改风格'}),three=await f.run({focus:'调整旁白和字幕'})
  assert.equal(two.id,one.id);assert.equal(three.id,one.id);assert.equal(three.version,3)
  assert.deepEqual(three.attempts.map(a=>[a.version,a.status]),[[1,'completed'],[2,'completed']])
  const running=await f.engine.list('workspace')
  assert.equal(running.length,1);assert.equal(running[0].status,'running')
  assert.deepEqual(running[0].attempts.map(a=>a.version),[1,2])
  await f.end()
  const final=await f.engine.list('workspace');assert.equal(final.length,1);assert.equal(final[0].status,'completed');assert.equal(final[0].version,3)
  const saved=JSON.parse(await readFile(f.path,'utf8')).artifacts
  assert.equal(saved.length,1);assert.equal(saved[0].parameters.focus,'调整旁白和字幕')
  assert.equal(saved[0].attempts[0].parameters.focus,'初版');assert.ok(saved[0].attempts[1].content.nodes.length)
})

test('the production tool guides successful-file revisions back to the same deliverable',async t=>{
  const f=await fixture(t);f.valid(true)
  const tools=[];installKnowledgeStudioTools({...f.ctx,tools:{register:tool=>tools.push(tool)}},f.manager,f.engine)
  const tool=tools.find(tool=>tool.name==='knowledge_studio_create_artifact')
  const execution={agent:{session:f.session},signal:new AbortController().signal,callId:'first'}
  const first=await tool.execute({kind:'mindmap',targetKey:'one'},execution)
  assert.equal(first.status,'completed');assert.ok(first.message.includes(`retryArtifactId="${first.artifactId}"`))
  assert.match(first.message,/包括已生成的文件/)
  const revised=await tool.execute({kind:'mindmap',retryArtifactId:first.artifactId,focus:'修改版式'}, {...execution,callId:'revision'})
  assert.equal(revised.status,'completed');assert.equal(revised.artifactId,first.artifactId)
  await f.end();const final=await f.engine.list('workspace')
  assert.equal(final.length,1);assert.equal(final[0].version,2)
})

test('failed final revision retains the latest usable result with an explicit warning and complete attempt history',async t=>{
  const f=await fixture(t);f.valid(true)
  const one=await f.run({targetKey:'one'}),two=await f.run({targetKey:'one',focus:'改善'})
  f.valid(false);const failed=await f.run({retryArtifactId:one.id,focus:'最后一次修改'})
  assert.equal(failed.status,'failed');assert.equal(failed.version,3)
  await f.end()
  const final=await f.engine.read(one.id)
  assert.equal(final.status,'completed');assert.equal(final.version,2);assert.deepEqual(final.content,two.content)
  assert.match(final.revisionWarning,/最后一次修改未完成.*第 2 版/)
  assert.equal(final.draft,undefined,'failed revision draft must not replace the selected successful content')
  assert.deepEqual(final.attempts.map(a=>[a.version,a.status]),[[1,'completed'],[3,'failed']])
  assert.ok(final.attempts[1].draft.text);assert.equal((await f.engine.list('workspace')).length,1)
  const reopened=await new ArtifactStore(f.path).read(one.id)
  assert.equal(reopened.version,2);assert.match(reopened.revisionWarning,/第 2 版/)
})

test('video revision records retain all file bytes while the result list exposes only the final version',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-video-revisions-')),path=join(root,'artifacts.json'),store=new ArtifactStore(path)
  const w={id:'w',title:'合成工作区'},files=[];let first
  for(let version=1;version<=3;version++) {
    const artifact=await store.create(w,'video',{focus:`修改说明${version}`},'s',{turn:1,targetKey:'one-video',callId:`call-${version}`})
    first??=artifact.id;assert.equal(artifact.id,first)
    // Bytes stand in for renderer output; this test verifies preservation, not video rendering.
    const file=join(root,`render-output-${version}.bin`);await writeFile(file,`synthetic rendered version ${version}`);files.push(file)
    await store.update(artifact.id,{status:'completed',title:`不同标题${version}`,content:{title:`不同标题${version}`,scenes:[]},exports:[{format:'mp4',path:file}],message:''})
  }
  await store.settleTurn('s',1,{kind:'completed'})
  const list=await store.list('w');assert.equal(list.length,1);assert.equal(list[0].version,3);assert.equal(list[0].title,'不同标题3')
  const saved=await store.read(first)
  assert.deepEqual([...saved.attempts.map(a=>a.exports[0].path),saved.exports[0].path],files)
  for(let i=0;i<files.length;i++)assert.equal(await readFile(files[i],'utf8'),`synthetic rendered version ${i+1}`)
})

test('on-demand MD, JSON and SVG exports never overwrite an earlier revision',async t=>{
  const f=await fixture(t);f.valid(true)
  const first=await f.run({targetKey:'one'}),originals=[]
  for(const format of ['md','json','svg']) {
    const file=await f.engine.export(first.id,format)
    originals.push({format,path:file.path,bytes:await readFile(file.path)})
  }
  f.ctx.llm.stream=async function*(){
    yield {type:'text-delta',index:0,text:JSON.stringify({title:'修改后的新标题',nodes:[{id:'root',label:'修改后的主题',body:'第二版正文',evidenceIds:['S1']}]})}
    yield {type:'finish',reason:{kind:'stop'}}
  }
  const revised=await f.run({retryArtifactId:first.id,focus:'调整标题与内容'})
  assert.equal(revised.version,2)
  for(const old of originals) {
    const file=await f.engine.export(first.id,old.format)
    assert.notEqual(file.path,old.path);assert.match(file.path,/attempt-2/)
    assert.deepEqual(await readFile(old.path),old.bytes)
    assert.match(Buffer.from(file.data,'base64').toString(),/修改后的/)
  }
  await f.end()
})

test('falling back after a failed quiz revision retains the successful version learning progress',async()=>{
  const store=new ArtifactStore(join(await mkdtemp(join(tmpdir(),'studio-quiz-revision-')),'artifacts.json')),w={id:'w',title:'w'}
  const first=await store.create(w,'quiz',{},'s',{turn:1,targetKey:'quiz'})
  await store.update(first.id,{status:'completed',content:{questions:[{id:'q1',question:'合成题目'}]},interaction:{current:0,answers:{},revealed:{}}})
  await store.interaction(first.id,'answer','q1',1)
  const before=await store.read(first.id)
  await store.create(w,'quiz',{},'s',{turn:1,targetKey:'quiz'})
  await store.update(first.id,{status:'failed',message:'合成修改失败'})
  await store.settleTurn('s',1,{kind:'completed'})
  const after=await store.read(first.id)
  assert.equal(after.version,1);assert.deepEqual(after.interaction,before.interaction)
  assert.equal(after.interaction.answers.q1,1)
})

test('running, cross-turn and independent outputs are not silently replaced',async()=>{
  const store=new ArtifactStore(join(await mkdtemp(join(tmpdir(),'studio-targets-')),'artifacts.json')),w={id:'w',title:'w'}
  const a=await store.create(w,'video',{},'s',{turn:1,targetKey:'a'})
  await assert.rejects(store.create(w,'video',{},'s',{turn:1,targetKey:'a'}),/still running/)
  const b=await store.create(w,'video',{},'s',{turn:1,targetKey:'b'});assert.notEqual(a.id,b.id)
  await store.update(a.id,{status:'completed'})
  await assert.rejects(store.create(w,'audio',{},'s',{turn:1},a.id),/same kind/)
  await store.settleTurn('s',1,{kind:'completed'})
  await assert.rejects(store.create(w,'video',{},'s',{turn:2},a.id),/this turn/)
  const next=await store.create(w,'video',{},'s',{turn:2,targetKey:'a'});assert.notEqual(next.id,a.id)
  const otherSession=await store.create(w,'video',{},'other',{turn:1,targetKey:'a'});assert.notEqual(otherSession.id,a.id)
  const parallelOne=await store.create(w,'video',{pathPrefix:'other-scope'},'s',{turn:2})
  const parallelTwo=await store.create(w,'video',{pathPrefix:'other-scope'},'s',{turn:2})
  assert.notEqual(parallelOne.id,parallelTwo.id)
  await store.update(parallelOne.id,{status:'completed'});await store.update(parallelTwo.id,{status:'completed'})
  const ambiguous=await store.create(w,'video',{pathPrefix:'other-scope'},'s',{turn:2})
  assert.notEqual(ambiguous.id,parallelOne.id);assert.notEqual(ambiguous.id,parallelTwo.id)
})

test('restart during a revision selects the earlier usable result and deleted results remain deleted',async()=>{
  for(const deleted of [false,true]) {
    const path=join(await mkdtemp(join(tmpdir(),'studio-revision-restart-')),'artifacts.json'),store=new ArtifactStore(path),w={id:'w',title:'w'}
    const first=await store.create(w,'video',{},'s',{turn:1,targetKey:'a'})
    await store.update(first.id,{status:'completed',content:{title:'saved'},exports:[{format:'mp4',path:'synthetic-file'}]})
    await store.create(w,'video',{},'s',{turn:1,targetKey:'a'})
    if(deleted)await store.update(first.id,{deletedAt:new Date().toISOString()})
    const reopened=new ArtifactStore(path),saved=await reopened.read(first.id)
    assert.equal(saved.status,'completed');assert.equal(saved.version,1);assert.equal(saved.attempts[0].status,'interrupted')
    assert.equal(saved.exports[0].path,'synthetic-file');assert.match(saved.revisionWarning,/最后一次修改未完成/)
    assert.equal((await reopened.list('w')).length,deleted?0:1)
  }
})
test('no retry, cancellation, and standalone execution settle at their own lifecycle boundaries',async t=>{
  const f=await fixture(t),failed=await f.run();await f.end('aborted')
  assert.equal((await f.engine.read(failed.id)).status,'failed')
  const g=await fixture(t),controller=new AbortController();controller.abort(new Error('cancelled'))
  const cancelled=await g.run({},controller.signal);assert.equal(cancelled.status,'cancelled')
  assert.equal((await g.engine.read(cancelled.id)).status,'running');await g.end('aborted');assert.equal((await g.engine.read(cancelled.id)).status,'cancelled')
  g.valid(true);const independent=await g.engine.wait((await g.engine.start(g.workspace,'mindmap',{},'session')).id)
  assert.equal(independent.status,'completed');assert.equal(independent.lifecycle,undefined)
})
test('reopening an unfinished store recovers running state and preserves successful files/content',async t=>{
  const path=join(await mkdtemp(join(tmpdir(),'studio-restart-')),'artifacts.json'),store=new ArtifactStore(path),w={id:'w',title:'w'}
  const a=await store.create(w,'mindmap',{},'s',{turn:1}),b=await store.create(w,'mindmap',{},'s',{turn:1,targetKey:'b'})
  await store.update(b.id,{status:'completed',content:{nodes:[{id:'root',label:'saved'}]}})
  const reopened=new ArtifactStore(path)
  assert.equal((await reopened.read(a.id)).status,'interrupted');assert.equal((await reopened.read(b.id)).status,'completed')
  assert.equal((await reopened.read(b.id)).lifecycle.state,'settled')
})
test('explicit Studio preferences survive new stores and serialize rapid open/close writes',async()=>{
  const path=join(await mkdtemp(join(tmpdir(),'studio-preferences-')),'prefs.json'),p=new StudioUIPreferences(path)
  assert.deepEqual(await p.read(),{open:false})
  await Promise.all([p.set(true),p.set(false),p.set(true)])
  assert.deepEqual(await new StudioUIPreferences(path).read(),{open:true})
  await p.set(false);assert.deepEqual(await new StudioUIPreferences(path).read(),{open:false})
})
