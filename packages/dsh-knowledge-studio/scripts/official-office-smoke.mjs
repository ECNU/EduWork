// Explicit local acceptance, not a default CI conversion workload.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {copyFile,mkdir,readFile,readdir,writeFile} from 'node:fs/promises'
import {registerHooks} from 'node:module'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'

const {values}=parseArgs({options:Object.fromEntries(['runtime','python','output','legacy-doc','legacy-xls','legacy-ppt'].map(name=>[name,{type:'string'}]))})
for(const name of ['runtime','python','output','legacy-doc'])assert.ok(values[name],`Supply --${name}`)
const runtime=resolve(values.runtime),output=resolve(values.output),root=join(output,'workspace')
await mkdir(output,{recursive:false});await mkdir(root)
process.env.DSH_MEDIA_NODE_ENV=runtime
process.env.DSH_OFFICE_PYTHON=resolve(values.python)
const runtimeParent=pathToFileURL(join(runtime,'package.json')).href
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@deepseek-ai/'))return next(specifier,{...context,parentURL:runtimeParent})
  if(specifier.startsWith('@eduwork/dsh-artifact-services/'))return next(new URL('../packages/artifact-services/lib/'+specifier.slice('@eduwork/dsh-artifact-services/'.length)+'.js',import.meta.url).href,context)
  return next(specifier,context)
}})
const [{Context},{default:prompt},{default:tools},{default:fs},sessions,office,{exportWithOfficeTools},{exportDocument},{withOfficialOfficeSkill,convertOfficeFile,officialOfficeRuntime}]=await Promise.all([
  import('@deepseek-ai/cordis'),import('@deepseek-ai/dsh-system-prompt'),import('@deepseek-ai/dsh-tools'),import('@deepseek-ai/dsh-fs-local'),import('@deepseek-ai/dsh-session'),
  import('../packages/artifact-services/lib/office-tools.js'),import('../lib/office-tools.js'),import('../lib/studio-export.js'),import('../packages/artifact-services/lib/official-office.js'),
])
// Python -I ignores PYTHONDONTWRITEBYTECODE: the installed scripts must stay
// unchanged even during validation and conversion of user-owned documents.
const bytecodeRoots=[resolve(import.meta.dirname,'../packages/artifact-services/python'),join(officialOfficeRuntime().office,'assets')]
async function bytecodeSnapshot() {
  const files=[]
  async function visit(directory) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=join(directory,entry.name)
      if(entry.isDirectory())await visit(path)
      else if(entry.isFile()&&entry.name.endsWith('.pyc'))files.push({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})
    }
  }
  for(const directory of bytecodeRoots)await visit(directory)
  return files.sort((a,b)=>a.path.localeCompare(b.path))
}
const bytecodeBefore=await bytecodeSnapshot()
const ctx=new Context(),events=[]
try {
  await ctx.plugin(prompt);await ctx.plugin(tools);await ctx.plugin(fs,{cwd:output})
  let mode='workspace-write',approvals=0
  ctx.provide('permissionPresets',{current:()=>mode})
  ctx.provide('approval',{request:async()=>{approvals++;return 'rejected'}})
  office.apply(ctx)
  const id=sessions.SessionId('synthetic-office-migration')
  const session=sessions.Session.create(id,[],{version:sessions.SESSION_FORMAT_VERSION,id,createdAt:Date.now(),cwd:root,isSeeded:false})
  const agent={session}
  let seq=0
  const execute=(name,args,signal=new AbortController().signal)=>ctx.tools.execute({agent,signal,callId:'office-'+(++seq),name,arguments:args})
  const call=async(name,args)=>{
    const value=await execute(name,args)
    assert.equal(value.isError,false,JSON.stringify(value))
    events.push({name,action:args.action,status:'passed'})
    return {value:value.value,report:JSON.parse(value.value.reportJSON)}
  }
  await copyFile(resolve(values['legacy-doc']),join(root,'legacy.doc'))
  const digest=async file=>createHash('sha256').update(await readFile(file)).digest('hex')
  const originalHash=await digest(join(root,'legacy.doc'))
  const legacy=await call('office_document',{action:'inspect',input_path:'legacy.doc'})
  assert.ok(legacy.report.paragraphs.length&&legacy.report.tables.length,'Use a synthetic DOC with text and a table')
  assert.equal(legacy.report.conversion.provider,'dsh-libreoffice-kit')
  assert.equal(legacy.report.project_relative_path,'legacy.doc')
  assert.deepEqual(await readdir(root),['legacy.doc'],'read-only inspection leaves no workspace files')
  mode='read-only'
  await call('office_document',{action:'inspect',input_path:'legacy.doc'})
  assert.equal(approvals,0)
  assert.equal((await execute('office_document',{action:'convert',input_path:'legacy.doc',output_path:'denied.docx'})).isError,true)
  assert.equal(approvals,1);assert.deepEqual(await readdir(root),['legacy.doc'])
  mode='workspace-write'
  await call('office_document',{action:'convert',input_path:'legacy.doc',output_path:'converted.docx'})
  await call('office_document',{action:'edit',input_path:'converted.docx',output_path:'edited.docx',spec:{operations:[{op:'append_blocks',blocks:[{type:'paragraph',text:'Official conversion edited successfully'}]}]}})
  assert.equal((await call('office_document',{action:'validate',input_path:'edited.docx'})).report.valid,true)
  await call('office_document',{action:'convert',input_path:'edited.docx',output_path:'edited.pdf'})
  assert.equal((await readFile(join(root,'edited.pdf'))).subarray(0,5).toString(),'%PDF-')
  assert.equal((await execute('office_document',{action:'convert',input_path:'legacy.doc',output_path:'converted.docx'})).isError,true)
  assert.equal(await digest(join(root,'legacy.doc')),originalHash)
  for(const [extension,tool,modern] of [['xls','office_spreadsheet','xlsx'],['ppt','office_presentation','pptx']]) {
    if(!values['legacy-'+extension])continue
    await copyFile(resolve(values['legacy-'+extension]),join(root,'legacy.'+extension))
    const before=await digest(join(root,'legacy.'+extension))
    const inspection=await call(tool,{action:'inspect',input_path:'legacy.'+extension})
    assert.ok((inspection.report.sheets??inspection.report.slides).length)
    await call(tool,{action:'convert',input_path:'legacy.'+extension,output_path:'converted.'+modern})
    assert.equal((await call(tool,{action:'validate',input_path:'converted.'+modern})).report.valid,true)
    assert.equal(await digest(join(root,'legacy.'+extension)),before)
  }
  const cancelled=new AbortController();cancelled.abort()
  assert.equal((await execute('office_document',{action:'convert',input_path:'legacy.doc',output_path:'cancelled.docx'},cancelled.signal)).isError,true)
  const activeCancellation=new AbortController()
  const timer=setTimeout(()=>activeCancellation.abort(),100)
  try {
    await assert.rejects(convertOfficeFile({inputPath:join(root,'legacy.doc'),outputPath:join(root,'interrupted.pdf'),signal:activeCancellation.signal}))
    assert.ok(!(await readdir(root)).includes('interrupted.pdf'),'cancelled native conversion cleans its output')
    events.push({operation:'cancel-running-conversion',status:'passed'})
  } finally {clearTimeout(timer)}
  await writeFile(join(root,'fake.doc'),'<html>This is not an OLE DOC</html>')
  assert.equal((await execute('office_document',{action:'inspect',input_path:'fake.doc'})).isError,true)
  await call('office_spreadsheet',{action:'create',output_path:'formula.xlsx',spec:{sheets:[{name:'Data',rows:[[2,3,{type:'formula',value:'=SUM(A1:B1)'}]]}]}})
  await call('office_spreadsheet',{action:'recalculate',input_path:'formula.xlsx',output_path:'recalculated.xlsx'})
  execFileSync(values.python,['-I','-B','-c',"import sys,openpyxl; p=sys.argv[1]; assert openpyxl.load_workbook(p,data_only=True).active['C1'].value==5; assert openpyxl.load_workbook(p,data_only=False).active['C1'].value.startswith('=')",join(root,'recalculated.xlsx')],{windowsHide:true})
  const fixtures=[
    {id:'report',kind:'report',title:'Office integration',citations:[],content:{sections:[{heading:'Report',body:'Chinese 中文 and body',evidenceIds:[]}]}},
    {id:'table',kind:'table',title:'Office table',citations:[],content:{columns:['Name'],rows:[{cells:['Value'],evidenceIds:[]}]}},
    {id:'slides',kind:'slides',title:'Office deck',citations:[],content:{slides:[{title:'Slide',bullets:['Test'],speakerNotes:'Full notes',evidenceIds:[]}]}}
  ]
  for(const artifact of fixtures) {
    const format={report:'docx',table:'xlsx',slides:'pptx'}[artifact.kind]
    const file=await exportWithOfficeTools(ctx,artifact,join(output,'exports',artifact.id),format,{execution:{agent},signal:new AbortController().signal})
    assert.equal(file.provider,'office-tools')
    const pdf=await exportDocument({...artifact,exports:[file]},dirname(file.path),'pdf')
    assert.equal(pdf.provider,'dsh-libreoffice-kit');assert.equal(pdf.sourcePath,file.path)
    assert.equal((await readFile(pdf.path)).subarray(0,5).toString(),'%PDF-')
    const again=await exportDocument({...artifact,exports:[file]},dirname(file.path),'pdf')
    assert.notEqual(again.path,pdf.path,'repeat downloads do not overwrite files or reuse a stale conversion')
    if(artifact.kind==='report') {
      execFileSync(values.python,['-I','-B','-c',"import sys; from docx import Document; d=Document(sys.argv[1]); d.add_paragraph('External modification marker'); d.save(sys.argv[1])",file.path],{windowsHide:true})
      const changed=await exportDocument({...artifact,exports:[file]},dirname(file.path),'pdf')
      const {extractPdfText}=await import('../lib/pdf-runtime.js')
      const text=await extractPdfText(new Uint8Array(await readFile(changed.path)))
      assert.match(JSON.stringify(text.text),/External modification marker/)
      events.push({operation:'studio-pdf-preserves-edited-source',status:'passed'})
    }
    events.push({studio:artifact.kind,format,pdf:true,status:'passed'})
  }
  for(const [kind,upstream] of [['documents','office-docx'],['spreadsheets','office-xlsx'],['presentations','office-pptx']]) {
    const directory=resolve(import.meta.dirname,'../packages/artifact-services/skills',kind)
    const raw=await readFile(join(directory,'SKILL.md'),'utf8')
    const skill=await withOfficialOfficeSkill({name:'artifact-'+kind,content:raw.replace(/^---[\s\S]*?---\s*/,''),resourceBase:{kind:'directory',path:directory}})
    assert.ok(skill.resourceBase.path.endsWith(upstream))
    const original=await readFile(join(skill.resourceBase.path,'SKILL.md'),'utf8')
    assert.ok(skill.content.includes(original.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,'').trim()))
    assert.ok(skill.content.includes('office-render'));assert.ok(skill.content.includes('Full Access'))
    events.push({skill:skill.name,originalWorkflowIncluded:true,status:'passed'})
  }
  assert.equal(approvals,1,'standing workspace access is reused')
  assert.deepEqual(await bytecodeSnapshot(),bytecodeBefore,'Office processing must not write Python bytecode into installed scripts')
  events.push({operation:'installed-python-bytecode-unchanged',status:'passed'})
  await writeFile(join(output,'result.json'),JSON.stringify({status:'passed',events,originalHash,originalUnchanged:true,scope:'Real DSH tool registry and Studio export with synthetic files; no model call or native shell UI'},null,2))
  console.log('Official Office acceptance passed')
} catch(error) {
  await writeFile(join(output,'failure.json'),JSON.stringify({error:error.stack,events},null,2));throw error
} finally {await ctx.fiber.dispose();hooks.deregister()}
