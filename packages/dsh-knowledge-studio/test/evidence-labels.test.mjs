import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createEvidenceBundle} from '../lib/evidence-labels.js'
import {validateContent,contentMarkdown} from '../lib/studio-content.js'
import {ArtifactEngine,validateQuiz,validateFlashcards} from '../lib/artifacts.js'
import JSZip from 'jszip'
import {slidesFixture} from './fixtures/slides-data.mjs'

const canonical='chunk_'+('a'.repeat(32))+'88'+('b'.repeat(30))
const source=(id=canonical)=>({evidenceId:id,path:'synthetic.md',locator:'line',lineStart:2,lineEnd:3,content:'合成资料中的完整说明。',revisionHash:'synthetic-revision',excerptHash:'synthetic-excerpt'})

test('one request labels only complete source blocks actually supplied, retaining exact canonical IDs',()=>{
  const evidence=[source(),source('another-canonical')],before=structuredClone(evidence)
  const bundle=createEvidenceBundle(evidence)
  assert.match(bundle.text,/Evidence ID: S1\n/);assert.match(bundle.text,/Evidence ID: S2\n/)
  assert.ok(!bundle.text.includes(canonical));assert.deepEqual(evidence,before)
  assert.equal(createEvidenceBundle([...evidence,evidence[0]]).evidence.length,2)
  const first=createEvidenceBundle([evidence[0]]),limited=createEvidenceBundle(evidence,{maxCharacters:first.text.length})
  assert.equal(limited.text,first.text);assert.equal(limited.evidence.length,1)
  assert.deepEqual(JSON.parse(limited.restore('slides',JSON.stringify({slides:[{evidenceIds:['S2']}]}))).slides[0].evidenceIds,[])
  assert.throws(()=>createEvidenceBundle(evidence,{maxCharacters:1}),/没有可容纳/)
})

test('all eight Studio schemas map only item evidenceIds before canonical validation',()=>{
  const evidence=[source()],bundle=createEvidenceBundle(evidence)
  const cases=[
    ['report','sections',{heading:'标题 S1',body:'正文 S1'}],
    ['mindmap','nodes',{id:'S1',label:'节点 S1',body:'说明'}],
    ['table','rows',{cells:['S1']}],
    ['slides','slides',{layout:'cover',title:'标题 S1',notes:'讲稿 S1'}],
    ['audio','segments',{speaker:'A',text:'讲述 S1'}],
    ['video','scenes',{heading:'场景 S1',bullets:['要点'],narration:'旁白 S1'}],
    ['quiz','questions',{question:'问题 S1',options:['S1','S2'],correctIndex:0,explanation:'解释 S1'}],
    ['flashcards','cards',{front:'正面 S1',back:'背面 S1'}],
  ]
  for(const [kind,key,item] of cases) {
    const raw=JSON.stringify({title:'合成测试',columns:['字段 S1'],[key]:[{...item,evidenceIds:['S1']}]})
    const restored=bundle.restore(kind,'```json\n'+raw+'\n```'),parsed=JSON.parse(restored)
    assert.deepEqual(parsed[key][0],{...item,evidenceIds:[canonical]},kind)
    const content=kind==='quiz'?validateQuiz(restored,evidence,1):kind==='flashcards'?validateFlashcards(restored,evidence,1):validateContent(kind,restored,evidence)
    assert.deepEqual(content[key][0].evidenceIds,[canonical],kind)
  }
  const legacy=validateContent('report',JSON.stringify({sections:[{heading:'旧报告',body:'旧正文',evidenceIds:[canonical]}]}),evidence)
  assert.equal(legacy.sections[0].evidenceIds[0],canonical)
})

test('typos, absent labels and mixed canonical IDs are omitted without guessing or changing input',()=>{
  const bundle=createEvidenceBundle([source()])
  for(const invalid of ['s1',' S1','S1 ','S01','S0','S2','S999',canonical,canonical.replace('88','8'),null,1,{}]) {
    const raw=JSON.stringify({slides:[{layout:'cover',title:'原稿',evidenceIds:['S1',invalid]}]})
    assert.deepEqual(JSON.parse(bundle.restore('slides',raw)).slides[0].evidenceIds,[canonical])
    assert.deepEqual(JSON.parse(raw).slides[0].evidenceIds,['S1',invalid])
  }
  assert.throws(()=>bundle.restore('report','{"sections":['),SyntaxError)
  assert.deepEqual(JSON.parse(bundle.restore('report','{"sections":[{"evidenceIds":[]}]}')).sections[0].evidenceIds,[])
  assert.deepEqual(JSON.parse(bundle.restore('report','{"sections":[{"evidenceIds":"S1"}]}')).sections[0].evidenceIds,[])
})

test('concurrent requests keep S1 mappings isolated and persisted content/exports use canonical IDs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-evidence-labels-')),requests=[]
  const workspaces=[{id:'first',title:'第一工作区'},{id:'second',title:'第二工作区'}]
  const records=Object.fromEntries(workspaces.map(workspace=>[workspace.id,source(canonical+'-'+workspace.id)]))
  const manager={status:async()=>({indexed:true}),searchDetailed:async workspace=>({results:[records[workspace.id]]}),sample:async workspace=>[records[workspace.id]],readEvidence:async(workspace,id)=>id===records[workspace.id].evidenceId?records[workspace.id]:null}
  const ctx={workspaceRegistry:{get:id=>workspaces.find(workspace=>workspace.id===id)},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(request){requests.push(request);await new Promise(resolve=>setTimeout(resolve,request.sessionId==='first'?20:1));yield {type:'text-delta',index:0,text:JSON.stringify({title:'合成导图',nodes:[{id:'root',label:'主题',body:'正文 S1',evidenceIds:['S1']}]})};yield {type:'finish',reason:{kind:'stop'}}}}}
  const path=join(root,'artifacts.json'),engine=new ArtifactEngine(ctx,manager,{artifactPath:path})
  try {
    const artifacts=await Promise.all(workspaces.map(async workspace=>engine.wait((await engine.start(workspace,'mindmap',{},workspace.id)).id)))
    for(const [index,artifact] of artifacts.entries()) {
      assert.equal(artifact.status,'completed',artifact.message)
      assert.deepEqual(artifact.content.nodes[0].evidenceIds,[records[workspaces[index].id].evidenceId])
      assert.equal(artifact.citations[0].evidenceId,records[workspaces[index].id].evidenceId)
      const exported=JSON.parse(Buffer.from((await engine.export(artifact.id,'json')).data,'base64').toString())
      assert.equal(exported.content.nodes[0].evidenceIds[0],artifact.citations[0].evidenceId)
      assert.match(contentMarkdown(artifact),/synthetic.md/)
    }
    for(const request of requests){const prompt=request.messages[0].content[0].text;assert.match(prompt,/Evidence ID: S1/);assert.ok(!prompt.includes(canonical))}
    const persisted=JSON.parse(await readFile(path,'utf8'));assert.ok(persisted.artifacts.every(artifact=>artifact.content.nodes[0].evidenceIds[0].startsWith(canonical)))
  }finally{await engine.close()}
})

test('invalid optional short labels do not discard usable content or invent citations',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-label-draft-')),workspace={id:'draft',title:'合成工作区'}
  const raw=JSON.stringify({title:'原始稿',nodes:[{id:'root',label:'主题',evidenceIds:['S1','S01']}]})
  const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[source()]}),sample:async()=>[source()],readEvidence:async()=>source()}
  const ctx={workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(){yield {type:'text-delta',index:0,text:raw};yield {type:'finish',reason:{kind:'stop'}}}}}
  const engine=new ArtifactEngine(ctx,manager,{artifactPath:join(root,'artifacts.json')})
  try{const artifact=await engine.wait((await engine.start(workspace,'mindmap',{},'session')).id);assert.equal(artifact.status,'completed',artifact.message);assert.equal(artifact.content.nodes[0].label,'主题');assert.deepEqual(artifact.content.nodes[0].evidenceIds,[canonical]);assert.equal(artifact.citations.length,1)}finally{await engine.close()}
})

test('six semantic slides generated with short labels produce a real PPTX with canonical provenance',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studio-label-pptx-')),workspace={id:'slides',title:'合成工作区'}
  const fixture=slidesFixture(),slides=fixture.content.slides.slice(0,6).map(item=>({...item,evidenceIds:['S1']}))
  const raw=JSON.stringify({title:'短标签演示回归',slides}),evidence=source(),requests=[]
  const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[evidence]}),sample:async()=>[evidence],readEvidence:async(_workspace,id)=>id===canonical?evidence:null}
  const ctx={workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(request){requests.push(request);yield {type:'text-delta',index:0,text:raw};yield {type:'finish',reason:{kind:'stop'}}}}}
  const engine=new ArtifactEngine(ctx,manager,{artifactPath:join(root,'artifacts.json')})
  try {
    const artifact=await engine.wait((await engine.start(workspace,'slides',{count:6,theme:'academic-editorial'},'session')).id)
    assert.equal(artifact.status,'completed',artifact.message)
    assert.ok(artifact.content.slides.every(slide=>slide.evidenceIds.length===1&&slide.evidenceIds[0]===canonical))
    assert.equal(artifact.citations[0].evidenceId,canonical)
    const exported=await engine.export(artifact.id,'pptx'),zip=await JSZip.loadAsync(Buffer.from(exported.data,'base64'))
    assert.equal(Object.keys(zip.files).filter(path=>/^ppt\/slides\/slide\d+\.xml$/.test(path)).length,6)
    const notes=await zip.file('ppt/notesSlides/notesSlide4.xml').async('string')
    assert.ok(notes.includes(slides[3].notes));assert.ok(notes.includes('synthetic.md'))
    const preview=await engine.export(artifact.id,'preview')
    assert.equal(preview.description.pageCount,6);assert.equal(preview.description.kind,'slides')
    assert.match(preview.description.sourceHash,/^[a-f0-9]{64}$/)
    assert.deepEqual(await engine.export(artifact.id,'preview'),preview)
    assert.equal(requests.length,1,'opening the saved PPTX never calls the model again')
    const prompt=requests[0].messages[0].content[0].text
    assert.match(prompt,/Evidence ID: S1/);assert.ok(!prompt.includes(canonical));assert.match(prompt,/共享创作参考/)
  }finally{await engine.close()}
})
