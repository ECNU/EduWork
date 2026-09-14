import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import JSZip from 'jszip'
import {ArtifactEngine,ArtifactStore,validateQuiz,validateFlashcards} from '../lib/artifacts.js'
import {validateContent,contentMarkdown} from '../lib/studio-content.js'
import {exportDocument} from '../lib/studio-export.js'
import {runOffice,normalizeOfficeRequest} from '@eduwork/dsh-artifact-services/office'
import {canRetryOfficeExport} from '../lib/export-recovery.js'

const evidence={evidenceId:'e1',path:'synthetic.md',lineStart:1,lineEnd:1,content:'既有资料',revisionHash:'r',excerptHash:'h'}
const workspace={id:'synthetic-workspace',title:'合成工作区'}

test('optional citations, headings, notes and missing trailing cells never require invented content',()=>{
  const report=validateContent('report',JSON.stringify({sections:[{body:'完整正文'}]}),[evidence])
  assert.equal(report.sections[0].heading,'');assert.deepEqual(report.sections[0].evidenceIds,[])
  const table=validateContent('table',JSON.stringify({columns:['一','二'],rows:[{cells:['真实值']}]}),[])
  assert.deepEqual(table.rows[0].cells,['真实值',''])
  assert.ok(!contentMarkdown({kind:'table',title:'合成数据表',content:table,citations:[]}).includes('来源'))
  const slide=validateContent('slides',JSON.stringify({slides:[{layout:'metrics',metrics:[{value:'75%',label:null,detail:null}],notes:null}]}),[]).slides[0]
  assert.deepEqual(slide.metrics,[{value:'75%'}]);assert.equal(slide.title,undefined)
  assert.throws(()=>validateContent('report','{"sections":[{}]}',[]),/空白/)
  assert.throws(()=>validateContent('table','{"rows":[{"cells":["值"]}]}',[]),/缺少字段/)
  assert.throws(()=>validateContent('slides','{"slides":[{"layout":"unknown","title":"正文"}]}',[]),/版式/)
})

test('learning items retain actual count without citations and never guess or shift a correct answer',()=>{
  const question={question:'可执行题目？',options:['第一','第二'],correctIndex:1}
  assert.equal(validateQuiz(JSON.stringify({questions:[question]}),[],8).questions.length,1)
  assert.equal(validateFlashcards(JSON.stringify({cards:[{front:'问题',back:'回答'}]}),[],15).cards.length,1)
  for(const invalid of [{...question,correctIndex:null},{...question,correctIndex:undefined},{...question,options:['','第一','第二']}])assert.throws(()=>validateQuiz(JSON.stringify({questions:[invalid]}),[],8),/有效题目/)
  assert.throws(()=>validateFlashcards('{"cards":[{"front":"问题"}]}',[],15),/正反面/)
})

test('sparse semantic slides export through the shared Office service without adding optional labels',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-optional-slides-'))
  const slides=[
    {layout:'summary',bullets:['只有正文，没有标题']},
    {layout:'two-column',left:{bullets:['左侧原文']},right:{bullets:['右侧原文']}},
    {layout:'metrics',metrics:[{value:'75%'}]},
    {layout:'timeline',events:[{detail:'仅有事件描述'}]},
    {layout:'feature-grid',items:[{detail:'仅有概念说明'}]},
    {layout:'roadmap',stages:[{detail:'仅有步骤说明'}]},
    {layout:'cover',subtitle:'只有副标题'},
  ]
  const result=await runOffice({projectPath:directory,request:normalizeOfficeRequest('presentation',{action:'create',output_path:'sparse.pptx',spec_json:JSON.stringify({theme:'modern-clean',slides})})})
  assert.equal(result.report.ok,true)
  const zip=await JSZip.loadAsync(await readFile(join(directory,'sparse.pptx')))
  for(let i=0;i<slides.length;i++){
    const xml=await zip.file(`ppt/slides/slide${i+1}.xml`).async('string')
    const value=[slides[i].bullets?.[0],slides[i].left?.bullets?.[0],slides[i].metrics?.[0].value,slides[i].events?.[0].detail,slides[i].items?.[0].detail,slides[i].stages?.[0].detail,slides[i].subtitle].find(Boolean)
    assert.ok(xml.includes(value),value);assert.ok(!xml.includes('Presentation Title ['))
  }
  const validated=await runOffice({projectPath:directory,request:normalizeOfficeRequest('presentation',{action:'validate',input_path:'sparse.pptx'})})
  assert.equal(validated.report.valid,true)
  for(const slides of [[{layout:'summary'}],[{layout:'metrics',metrics:[{label:'缺数值'}]}]])await assert.rejects(runOffice({projectPath:directory,request:normalizeOfficeRequest('presentation',{action:'create',output_path:'invalid.pptx',spec_json:JSON.stringify({slides})})}),/empty_slide|invalid_text|invalid_metric/)
})

test('persisted DOCX and XLSX without sidecars use actual changed bytes for preview, HTML and download',async()=>{
  for(const [kind,format,content,part] of [
    ['report','docx',{sections:[{body:'原始文件正文'}]},'word/document.xml'],
    ['table','xlsx',{columns:['字段'],rows:[{cells:['原始文件正文']} ]},'xl/worksheets/sheet1.xml'],
  ]){
    const directory=await mkdtemp(join(tmpdir(),'studio-real-preview-')),path=join(directory,'artifacts.json')
    let calls=0
    const ctx={workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(){calls++;yield {type:'text-delta',index:0,text:JSON.stringify(content)};yield {type:'finish',reason:{kind:'stop'}}}}}
    const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[evidence]}),sample:async()=>[evidence]}
    let engine=new ArtifactEngine(ctx,manager,{artifactPath:path})
    const done=await engine.wait((await engine.start(workspace,kind,{},'session')).id)
    assert.equal(done.status,'completed',done.message);assert.deepEqual(done.citations,[])
    await engine.close();engine=new ArtifactEngine(ctx,manager,{artifactPath:path})
    try{
      const original=await engine.export(done.id,'preview'),file=done.exports[0]
      assert.match(original.html,/原始文件正文/)
      const zip=await JSZip.loadAsync(await readFile(file.path))
      if(kind==='table')assert.ok(!(await zip.file('xl/workbook.xml').async('string')).includes('name="来源"'))
      zip.file(part,(await zip.file(part).async('string')).replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code))).replace('原始文件正文','外部修改正文'))
      await writeFile(file.path,await zip.generateAsync({type:'nodebuffer'}))
      const changed=await engine.export(done.id,'preview')
      assert.notEqual(changed.description.sourceHash,original.description.sourceHash);assert.match(changed.html,/外部修改正文/)
      assert.equal(contentMarkdown(await engine.read(done.id)).includes('原始文件正文'),true,'stored content is not silently rewritten')
      assert.deepEqual(Buffer.from((await engine.export(done.id,format)).data,'base64'),await readFile(file.path))
      assert.equal(Buffer.from((await engine.export(done.id,'html')).data,'base64').toString(),changed.html)
      assert.equal(calls,1,'reopening, previewing and downloading never invoke the model')
    }finally{await engine.close()}
  }
})

test('a validated Office export without citations remains recoverable without another generation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-source-free-recovery-')),path=join(directory,'artifacts.json'),store=new ArtifactStore(path)
  const created=await store.create(workspace,'report',{},'session'),content=validateContent('report',JSON.stringify({sections:[{body:'恢复正文'}]}),[])
  await store.update(created.id,{content,title:content.title,citations:[],status:'failed',generation:{finishKind:'stop'},message:'office operation failed: '+JSON.stringify({ok:false,operation:'create',error:{code:'text_too_long'}})})
  const engine=new ArtifactEngine({workspaceRegistry:{get:()=>workspace}}, {},{artifactPath:path})
  try{
    assert.equal(canRetryOfficeExport(await engine.read(created.id)),true)
    await engine.manage(created.id,'retry-export','')
    const done=await engine.wait(created.id);assert.equal(done.status,'completed',done.message);assert.deepEqual(done.content,content);assert.deepEqual(done.citations,[])
    assert.match((await engine.export(done.id,'preview')).html,/恢复正文/)
  }finally{await engine.close()}
})

test('a source removed before citation snapshot does not discard otherwise usable generated content',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-optional-source-'))
  const ctx={workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'fixture'})},llm:{stream:async function*(){yield {type:'text-delta',index:0,text:JSON.stringify({sections:[{body:'已有正文',evidenceIds:['S1']}]})};yield {type:'finish',reason:{kind:'stop'}}}}}
  const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[evidence]}),sample:async()=>[evidence],readEvidence:async()=>null}
  const engine=new ArtifactEngine(ctx,manager,{artifactPath:join(directory,'artifacts.json')})
  try{const done=await engine.wait((await engine.start(workspace,'report',{},'session')).id);assert.equal(done.status,'completed',done.message);assert.deepEqual(done.citations,[]);assert.deepEqual(done.content.sections[0].evidenceIds,[]);assert.match((await engine.export(done.id,'preview')).html,/已有正文/)}finally{await engine.close()}
})
