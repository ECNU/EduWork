import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises'
import {join,dirname,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import JSZip from 'jszip'
import {ArtifactEngine,ArtifactStore} from '../lib/artifacts.js'
import {validateContent} from '../lib/studio-content.js'
import {canRetryOfficeExport} from '../lib/export-recovery.js'
import {validateMetricValue,PRESENTATION_METRICS} from '../packages/artifact-services/lib/presentation-contract.js'

const evidence={evidenceId:'e1',path:'synthetic.md',heading:'合成指标',locator:'line',lineStart:1,lineEnd:2,excerpt:'合成样例',content:'合成样例',revisionHash:'revision',excerptHash:'excerpt'}
const generation={provider:'synthetic',model:'fixture',finishKind:'stop',maxTokens:393216,reasoningEffort:'high',budgetSource:'model-default'}
const failure='office operation failed: '+JSON.stringify({ok:false,operation:'create',error:{code:'text_too_long',message:'metrics.metrics[1].value is too long for the fixed layout.',details:{length:9,maximum:8}}})
const slideContent=()=>({title:'合成比较值',slides:[{layout:'metrics',title:'两阶段合成比较',metrics:[{value:'75% → 85%',label:'完成率',detail:'同一口径'},{value:'3.6 → 4.1',label:'平均值',detail:'合成数据'}],notes:'完整讲稿保留',evidenceIds:['e1']}]})
async function setup(t,kind='slides',raw=slideContent()) {
  const directory=await mkdtemp(join(tmpdir(),'studio-export-recovery-'))
  t.after(async()=>{assert.equal(dirname(directory),resolve(tmpdir()));await rm(directory,{recursive:true,force:true})})
  const workspace={id:'synthetic-workspace',title:'合成工作区'},path=join(directory,'artifacts.json'),store=new ArtifactStore(path)
  const created=await store.create(workspace,kind,{theme:'academic-editorial'},'synthetic-session')
  const content=validateContent(kind,JSON.stringify(raw),[evidence])
  await store.update(created.id,{status:'failed',phase:'done',content,citations:[evidence],generation,title:raw.title,parameters:{theme:'academic-editorial'},message:failure,draft:{text:JSON.stringify(raw),reason:'validation'}})
  let calls=0
  const ctx={workspaceRegistry:{get:()=>workspace},llm:{stream:async function*(){calls++;throw new Error('recovery must never call a model')}}}
  const engine=new ArtifactEngine(ctx,{readEvidence:async()=>evidence},{artifactPath:path})
  t.after(()=>engine.close())
  return {directory,path,id:created.id,engine,calls:()=>calls}
}
const payload=artifact=>({content:artifact.content,citations:artifact.citations,generation:artifact.generation})

test('shared metric value contract preserves spaces and rejects overlong or multiline values',()=>{
  for(const value of ['75% → 85%','3.6 → 4.1','3.6% → 4.1%',' 75% → 85% '])assert.equal(validateMetricValue(value),value)
  assert.equal(PRESENTATION_METRICS.maximumValueCharacters,24);assert.equal(PRESENTATION_METRICS.minimumValueFontPoints,12)
  assert.throws(()=>validateMetricValue('x'.repeat(25)),/24/)
  assert.throws(()=>validateMetricValue('75%\n85%'),/单行/)
  assert.throws(()=>validateContent('slides',JSON.stringify({...slideContent(),slides:[{...slideContent().slides[0],metrics:[{value:'x'.repeat(25)},{value:'1'}]}]}),[evidence]),/24/)
})

test('legacy validated export failure recovers the same artifact into actual PPTX without changing model payload or overwriting remnants',async t=>{
  const f=await setup(t),before=await f.engine.read(f.id)
  const remnant=join(f.directory,'exports',f.id,f.id+'.pptx');await mkdir(dirname(remnant),{recursive:true});await writeFile(remnant,'previous failed attempt')
  await assert.rejects(f.engine.export(f.id,'pptx'),/重试导出/)
  const pending=f.engine.manage(f.id,'retry-export','')
  await assert.rejects(f.engine.manage(f.id,'retry-export',''),/正在处理/)
  const started=await pending;assert.equal(started.id,f.id);assert.equal(started.status,'running');assert.equal(started.phase,'export')
  const after=await f.engine.wait(f.id);assert.equal(after.status,'completed',after.message)
  assert.deepEqual(payload(after),payload(before));assert.equal(f.calls(),0);assert.equal(after.exportState.recoveredFromLegacy,true)
  assert.equal(after.exportState.phase,'complete');assert.equal(after.exportState.attempts,2)
  const download=await f.engine.export(f.id,'pptx'),zip=await JSZip.loadAsync(Buffer.from(download.data,'base64'))
  const xml=await zip.file('ppt/slides/slide1.xml').async('string')
  assert.ok(xml.includes('75% → 85%'));assert.ok(xml.includes('3.6 → 4.1'));assert.match(xml,/wrap="none"/)
  assert.ok((await zip.file('ppt/notesSlides/notesSlide1.xml').async('string')).includes('完整讲稿保留'))
  assert.equal(await readFile(remnant,'utf8'),'previous failed attempt');assert.notEqual(after.exports[0].path,remnant)
  assert.equal((await f.engine.export(f.id,'preview')).description.pageCount,1)
  await assert.rejects(f.engine.manage(f.id,'retry-export',''),/没有可恢复/)
})

test('recovery rejects invalid sources, incomplete generations, absent content and changed validated checkpoints',async t=>{
  for(const change of [
    a=>{a.content=null},a=>{a.content.slides[0].evidenceIds=['missing']},a=>{a.generation.finishKind='max-tokens'},
    a=>{a.message='第 1 项包含无效来源'},a=>{a.exportState={version:1,phase:'failed',validatedContentHash:'wrong',provider:'shared-office'}},
    a=>{a.exportState={version:1,phase:'failed',validatedContentHash:'wrong',provider:'office-tools',blocked:true};a.message='permission denied'},
  ]) {
    const f=await setup(t);await f.engine.close()
    const state=JSON.parse(await readFile(f.path,'utf8'));change(state.artifacts[0]);await writeFile(f.path,JSON.stringify(state))
    const engine=new ArtifactEngine({workspaceRegistry:{get:()=>({id:'synthetic-workspace'})}},{readEvidence:async()=>evidence},{artifactPath:f.path})
    await assert.rejects(engine.manage(f.id,'retry-export',''),/不能|没有可恢复|变化|无效来源/)
    assert.equal((await engine.wait(f.id)).status,'failed');await engine.close();assert.equal(f.calls(),0)
  }
})

test('cancelled file recovery preserves payload and can resume without model generation',async t=>{
  const f=await setup(t),before=await f.engine.read(f.id)
  await f.engine.manage(f.id,'retry-export','');const stopped=await f.engine.manage(f.id,'cancel','')
  assert.equal(stopped.status,'cancelled');assert.deepEqual(payload(stopped),payload(before));assert.equal(canRetryOfficeExport(stopped),true)
  await f.engine.manage(f.id,'retry-export','');const finished=await f.engine.wait(f.id)
  assert.equal(finished.status,'completed',finished.message);assert.deepEqual(payload(finished),payload(before));assert.equal(f.calls(),0)
})

test('wide metrics recover with readable automatic layout while preserving validated content',async t=>{
  const raw=slideContent();raw.slides[0].metrics[0].value='W'.repeat(24)
  const f=await setup(t,'slides',raw),before=await f.engine.read(f.id)
  await f.engine.manage(f.id,'retry-export','');const done=await f.engine.wait(f.id)
  assert.equal(done.status,'completed',done.message)
  assert.deepEqual(payload(done),payload(before));assert.equal(f.calls(),0)
  const zip=await JSZip.loadAsync(Buffer.from((await f.engine.export(f.id,'pptx')).data,'base64'))
  assert.ok((await zip.file('ppt/slides/slide1.xml').async('string')).includes('W'.repeat(24)))
})

test('report and table file recovery reuse saved literal content through the same Office service',async t=>{
  for(const [kind,raw,format] of [
    ['report',{title:'合成报告',sections:[{heading:'结论',body:'保留已保存正文',evidenceIds:['e1']}]},'docx'],
    ['table',{title:'合成数据表',columns:['指标'],rows:[{cells:['=literal'],evidenceIds:['e1']}]},'xlsx'],
  ]) {
    const f=await setup(t,kind,raw),before=await f.engine.read(f.id)
    await f.engine.manage(f.id,'retry-export','');const after=await f.engine.wait(f.id)
    assert.equal(after.status,'completed',after.message);assert.deepEqual(payload(after),payload(before));assert.equal(f.calls(),0)
    const zip=await JSZip.loadAsync(Buffer.from((await f.engine.export(f.id,format)).data,'base64'))
    assert.ok(zip.file(kind==='report'?'word/document.xml':'xl/worksheets/sheet1.xml'))
  }
})
