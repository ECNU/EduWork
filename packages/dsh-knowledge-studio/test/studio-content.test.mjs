import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import test from 'node:test'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {validateContent} from '../lib/studio-content.js'
import {exportDocument} from '../lib/studio-export.js'
import {ArtifactEngine} from '../lib/artifacts.js'
import {generateText} from '../lib/generation.js'

const e={evidenceId:'e1',path:'notes.md',content:'数据质量应检查完整性。',lineStart:1,lineEnd:1,revisionHash:'r1',excerptHash:'h1'}
test('artifact schemas omit fabricated evidence and reject cycles and surplus cells',()=>{
  assert.deepEqual(validateContent('report',JSON.stringify({sections:[{heading:'a',body:'b',evidenceIds:['fake']}]}),[e]).sections[0].evidenceIds,[])
  assert.throws(()=>validateContent('mindmap',JSON.stringify({nodes:[{id:'a',parentId:'b',label:'A',evidenceIds:['e1']},{id:'b',parentId:'a',label:'B',evidenceIds:['e1']}]}),[e]),/循环/)
  assert.throws(()=>validateContent('table',JSON.stringify({columns:['A'],rows:[{cells:['one','two'],evidenceIds:['e1']}]}),[e]),/不一致/)
  for(const [kind,key,item] of [
    ['report','sections',{heading:'检查',body:'检查完整性'}],['mindmap','nodes',{id:'root',label:'完整性'}],['table','rows',{cells:['完整性']}],['slides','slides',{heading:'完整性',bullets:['缺失']}],['audio','segments',{speaker:'A',text:'完整性检查。'}],['video','scenes',{heading:'完整性',narration:'发现缺失字段。',bullets:['缺失字段']}]
  ])assert.equal(validateContent(kind,JSON.stringify({title:'测试',columns:['检查'],[key]:[{...item,evidenceIds:['e1']}]}),[e])[key].length,1)
})

test('table exports preserve literal cells and neutralize CSV formulas',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-export-'))
  const artifact={id:'table',kind:'table',title:'表格',citations:[e],content:{columns:['value'],rows:[{cells:['=1+1'],evidenceIds:['e1']}]}}
  const csv=await exportDocument(artifact,dir,'csv');assert.match(await readFile(csv.path,'utf8'),/'=1\+1/)
  const xlsx=await exportDocument(artifact,dir,'xlsx')
  const cells=JSON.parse(execFileSync(process.env.DSH_OFFICE_PYTHON,['-I','-c',"import json,sys,openpyxl; w=openpyxl.load_workbook(sys.argv[1]); print(json.dumps([w.worksheets[0]['A2'].value,w.worksheets[1]['A2'].value]))",xlsx.path],{encoding:'utf8',windowsHide:true}))
  assert.deepEqual(cells,['=1+1','e1'])
})

test('report lifecycle persists citations, exports, renames and removes without losing stored content',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'studio-report-')),ws={id:'ws',title:'工作区'}
  const ctx={workspaceRegistry:{get:()=>ws},agentDefaultModel:{currentSelection:()=>({provider:'test',model:'test'})},agents:{get:()=>null},llm:{stream:async function*(){yield {type:'text-delta',index:0,text:JSON.stringify({title:'质量报告',sections:[{heading:'完整性',body:'检查缺失字段。',evidenceIds:['S1']}]})};yield {type:'finish',reason:{kind:'stop'}}}}}
  const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[e]}),sample:async()=>[e],readEvidence:async()=>e}
  const engine=new ArtifactEngine(ctx,manager,{artifactPath:join(dir,'artifacts.json')})
  const started=await engine.start(ws,'report',{template:'briefing'},'session')
  const done=await engine.wait(started.id);assert.equal(done.status,'completed');assert.equal(done.citations[0].evidenceId,'e1')
  const file=await engine.export(done.id,'md');assert.match(Buffer.from(file.data,'base64').toString(),/检查缺失字段/)
  assert.equal((await engine.manage(done.id,'rename','新名称')).title,'新名称')
  await engine.manage(done.id,'delete','');assert.equal((await engine.list(ws.id)).length,0);assert.ok((await engine.read(done.id)).content)
  await engine.close()
})

test('model stream terminal errors and truncation never become successful text',async()=>{
  for(const reason of [{kind:'error',failure:{message:'quota unavailable'}},{kind:'max-tokens'}]) {
    const ctx={agentDefaultModel:{currentSelection:()=>({provider:'test',model:'test'})},llm:{stream:async function*(){yield {type:'text-delta',index:0,text:'partial'};yield {type:'finish',reason}}}}
    await assert.rejects(generateText(ctx,{prompt:'test'}),/quota unavailable|长度上限/)
  }
})

test('legacy bounded reasoning flag no longer overrides the exact-route model policy',async()=>{
  for(const efforts of [['high','low'],['off','high'],['high']]) {
    const requests=[]
    const ctx={agentDefaultModel:{currentSelection:()=>({provider:'test',model:'test'})},llm:{
      resolveModelInfo:async(provider,model)=>{assert.equal(provider,'test');assert.equal(model,'test');return {reasoning:{efforts:efforts.map(id=>({id}))}}},
      stream:async function*(request){requests.push(request);yield {type:'text-delta',index:0,text:'完整内容'};yield {type:'finish',reason:{kind:'stop'}}},
    }}
    await generateText(ctx,{prompt:'test',boundedReasoning:true})
    await generateText(ctx,{prompt:'test'})
    assert.equal(requests[0].reasoningEffort,undefined)
    assert.equal(requests[1].reasoningEffort,undefined)
  }
})

test('long reports and cells preserve full content or explicitly fail without slicing',()=>{
  const body='完整报告正文。'.repeat(10000),raw=JSON.stringify({title:'较长报告',sections:[{heading:'一',body,evidenceIds:['e1']},{heading:'二',body,evidenceIds:['e1']},{heading:'三',body,evidenceIds:['e1']}]})
  assert.ok(raw.length>150000)
  const content=validateContent('report',raw,[e]);assert.equal(content.sections[2].body,body)
  assert.throws(()=>validateContent('report',JSON.stringify({sections:[{heading:'超长',body:'文'.repeat(100001),evidenceIds:['e1']}]}),[e]),/草稿已保留/)
  assert.throws(()=>validateContent('table',JSON.stringify({columns:['值'],rows:[{cells:['x'.repeat(32001)],evidenceIds:['e1']}]}),[e]),/超过/)
  assert.deepEqual(validateContent('report',JSON.stringify({sections:[{heading:'a',body:'b',evidenceIds:['e1','invented']}]}),[e]).sections[0].evidenceIds,['e1'])
})

test('failed generation persists a complete visible draft and diagnostics, supports download and retry',async()=>{
  for(const reason of ['limit','invalid','disconnected']) {
    const directory=await mkdtemp(join(tmpdir(),'studio-draft-')),workspace={id:'ws',title:'合成工作区'}
    const draft='{"title":"未完成","sections":['+'可见草稿'.repeat(12000),requests=[]
    const ctx={workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'model'})},llm:{resolveModelInfo:async()=>({defaultMaxTokens:65536}),stream:async function*(request){requests.push(request);yield {type:'reasoning-delta',index:0,text:'NEVER SAVE REASONING'};yield {type:'text-delta',index:1,text:draft};if(reason==='disconnected')throw new Error('connection interrupted');yield {type:'finish',reason:{kind:reason==='limit'?'max-tokens':'stop'}}}}}
    const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[e]}),sample:async()=>[e],readEvidence:async()=>e}
    const engine=new ArtifactEngine(ctx,manager,{artifactPath:join(directory,'artifacts.json')})
    try {
      const done=await engine.wait((await engine.start(workspace,'report',{},'session')).id)
      assert.equal(done.status,'failed');assert.equal(done.content,null);assert.equal(done.draft.text,draft)
      assert.equal(done.generation.maxTokens,65536);assert.equal(Object.hasOwn(requests[0],'maxTokens'),false)
      assert.ok(!JSON.stringify(done).includes('NEVER SAVE REASONING'))
      const download=await engine.export(done.id,'draft');assert.equal(Buffer.from(download.data,'base64').toString(),draft)
      await assert.rejects(engine.export(done.id,'docx'),/未生成|内容|content/)
      const retried=await engine.manage(done.id,'retry','');assert.notEqual(retried.id,done.id)
      await engine.wait(retried.id);assert.equal((await engine.read(done.id)).draft.text,draft)
    } finally {await engine.close()}
  }
})

test('Office execution failure also retains the original generated text without marking completion',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'studio-office-draft-')),workspace={id:'ws',title:'合成工作区'}
  const raw=JSON.stringify({title:'完整正文',sections:[{heading:'一',body:'已生成的正文。',evidenceIds:['S1']}]})
  const ctx={workspaceRegistry:{get:()=>workspace},agents:{get:()=>null},agentDefaultModel:{currentSelection:()=>({provider:'fixture',model:'model'})},llm:{stream:async function*(){yield {type:'text-delta',index:0,text:raw};yield {type:'finish',reason:{kind:'stop'}}}},tools:{get:()=>true,execute:async()=>({isError:true,error:{message:'Office validation unavailable'}})}}
  const manager={status:async()=>({indexed:true}),searchDetailed:async()=>({results:[e]}),sample:async()=>[e],readEvidence:async()=>e}
  const engine=new ArtifactEngine(ctx,manager,{artifactPath:join(directory,'artifacts.json')})
  try {const done=await engine.wait((await engine.start(workspace,'report',{},'session',undefined,{agent:{}})).id);assert.equal(done.status,'failed');assert.equal(done.draft.text,raw);assert.equal((done.exports||[]).length,0);assert.equal(done.content.sections[0].body,'已生成的正文。')}
  finally {await engine.close()}
})
