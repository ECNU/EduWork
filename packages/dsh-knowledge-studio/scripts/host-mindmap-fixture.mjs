import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {mindmapFixture} from '../test/fixtures/mindmap-data.mjs'
import {slidesFixture,draftFixture} from '../test/fixtures/slides-data.mjs'
import {exportDocument} from '../lib/studio-export.js'

/** Before Host boot only: public registry + synthetic persisted legacy artifacts. */
export async function seedHostMindmap(runtime,home,session,{office=false}={}) {
  const require=createRequire(join(runtime,'package.json')),load=name=>import(pathToFileURL(require.resolve(name)))
  const {Context}=await load('@deepseek-ai/cordis'),{default:Jsonl}=await load('@deepseek-ai/dsh-session-persistence-jsonl')
  const context=new Context()
  let workspaceId
  try {
    if(Jsonl.inject?.includes('sessions'))await context.plugin((await load('@deepseek-ai/dsh-session')).default)
    await context.plugin(Jsonl,{root:join(home,'sessions')})
    await context.plugin((await load('@deepseek-ai/dsh-storage')).default)
    await context.plugin(await load('@deepseek-ai/dsh-storage-json'),{root:join(home,'storages')})
    await context.plugin(await load('@deepseek-ai/dsh-storage-domain'),{backend:'json'})
    await context.plugin((await load('@deepseek-ai/dsh-workspace')).default)
    workspaceId=String((await context.workspaceRegistry.create(session.workspace,'合成工作区')).id)
  } finally {await context.fiber.dispose()}
  const artifacts=[mindmapFixture({workspaceId,sessionId:session.sessionId}),mindmapFixture({id:'legacy-mindmap',workspaceId,sessionId:session.sessionId,legacy:true})]
  if(office) {
    const slides=slidesFixture({workspaceId,sessionId:session.sessionId})
    slides.exports=[await exportDocument(slides,join(session.workspace,'synthetic-exports'),'pptx')]
    artifacts.push(slides,draftFixture({workspaceId,sessionId:session.sessionId}))
    for(const [kind,format,content] of [
      ['report','docx',{sections:[{id:'section1',heading:'真实文件',body:'DOCX 文件中的正文。',evidenceIds:[]}]}],
      ['table','xlsx',{columns:['文件值','备注'],rows:[{id:'row1',cells:['XLSX 文件中的单元格',''],evidenceIds:[]}]}],
    ]) {
      const artifact={id:'synthetic-'+format,workspaceId,sessionId:session.sessionId,kind,title:'合成 '+format.toUpperCase()+' 文件预览',status:'completed',phase:'done',parameters:{},content,citations:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
      artifact.exports=[await exportDocument(artifact,join(session.workspace,'synthetic-exports'),format)]
      // Catch a preview that recomposes memory instead of reading saved bytes.
      if(kind==='report')artifact.content.sections[0].body='此内存正文不能冒充实际文件'
      else artifact.content.rows[0].cells[0]='此内存单元格不能冒充实际文件'
      artifacts.push(artifact)
    }
    const recovery=slidesFixture({workspaceId,sessionId:session.sessionId})
    recovery.id='synthetic-export-recovery';recovery.title='合成导出失败恢复';recovery.status='failed'
    recovery.parameters.theme='academic-editorial'
    recovery.content.slides[3].metrics=[{value:'75% → 85%',label:'完成率',detail:'同口径合成数据'},{value:'3.6 → 4.1',label:'平均值',detail:'小数完整保留'}]
    recovery.generation={provider:'synthetic',model:'fixture',finishKind:'stop',maxTokens:393216,reasoningEffort:'high',budgetSource:'model-default'}
    recovery.message='office operation failed: '+JSON.stringify({ok:false,operation:'create',error:{code:'text_too_long',details:{length:9,maximum:8}}})
    artifacts.push(recovery)
  }
  await writeFile(join(session.workspace,'synthetic-notes.md'),artifacts[0].citations[0].excerpt+'\n')
  const directory=join(home,'plugins','dsh-knowledge-studio');await mkdir(directory,{recursive:true})
  await writeFile(join(directory,'artifacts.json'),JSON.stringify({version:1,artifacts},null,2),{flag:'wx'})
  return {workspaceId,artifacts}
}
