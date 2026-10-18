import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,readdir,symlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {normalizeOfficeRequest,actionNeedsApproval} from '../packages/artifact-services/lib/office.js'
import {officeInputPath,officeOutputPath,convertOfficeFile,withOfficialOfficeSkill,withOfficialOfficeProvider} from '../packages/artifact-services/lib/official-office.js'
import {Context} from '@deepseek-ai/cordis'
import {SkillRegistry} from '@deepseek-ai/dsh-skill'
import {installArtifactSkills} from '../packages/artifact-services/lib/skills.js'

test('legacy reading and conversions have distinct input/output and permission contracts',()=>{
  for(const [format,legacy,modern] of [['document','doc','docx'],['spreadsheet','xls','xlsx'],['presentation','ppt','pptx']]) {
    assert.equal(normalizeOfficeRequest(format,{action:'inspect',input_path:'original.'+legacy}).write,false)
    for(const extension of [modern,'pdf']) {
      const args={action:'convert',input_path:'original.'+legacy,output_path:'converted.'+extension}
      assert.equal(actionNeedsApproval(format,args),true)
      assert.equal(normalizeOfficeRequest(format,args).outputPath,args.output_path)
    }
    assert.throws(()=>normalizeOfficeRequest(format,{action:'convert',input_path:'original.'+legacy,output_path:'output.'+legacy}),/must end/)
    assert.throws(()=>normalizeOfficeRequest(format,{action:'convert',input_path:'original.'+modern,output_path:'original.'+modern}),/never overwritten/)
  }
  assert.throws(()=>normalizeOfficeRequest('document',{action:'edit',input_path:'original.doc',output_path:'edited.docx',spec:{operations:[]}}),/docx/)
  assert.equal(normalizeOfficeRequest('spreadsheet',{action:'recalculate',input_path:'a.xlsx',output_path:'b.xlsx'}).write,true)
})

test('real official provider keeps aliases, progressive tools, switches and project overrides', {skip:!process.env.EDUWORK_TEST_RUNTIME},async()=>{
  const environment={DSH_MEDIA_NODE_ENV:process.env.EDUWORK_TEST_RUNTIME,DSH_OFFICE_PYTHON:process.execPath}
  const definitions=['artifact-documents','artifact-spreadsheets','artifact-presentations'].map(name=>({name,description:name,content:'Product integration',
    provider:'filesystem',rank:600,source:'bundled',resourceBase:{kind:'directory',path:process.cwd()},invocation:{modelInvocable:true,userInvocable:true}}))
  let disabled=new Set()
  const delegate={name:'filesystem',list:async()=>definitions,get:async candidate=>candidate}
  const provider=withOfficialOfficeProvider(delegate,{environment,enabled:name=>!disabled.has(name)})
  const candidates=await provider.list({})
  assert.equal(candidates.length,7)
  assert.deepEqual(candidates.filter(c=>c.invocation.userInvocable).map(c=>c.name),definitions.map(c=>c.name))
  for(const candidate of candidates) {
    const skill=await provider.get(candidate,{})
    assert.equal(skill.provider,provider.name)
    assert.ok(skill.content.length>100)
    if(candidate.name==='office')assert.match(skill.content,/`artifact-documents`/)
    if(['office-render','office-export-pdf','office-recalculate'].includes(candidate.name)) {
      assert.match(skill.content,/Installed LibreOffice Kit/)
      assert.ok(skill.content.includes(process.execPath.replaceAll('\\','\\\\')))
    }
  }
  const custom={...definitions[0],source:'project',content:'User custom workflow'}
  assert.equal(await provider.get(custom,{}),custom)
  disabled=new Set(['artifact-spreadsheets'])
  assert.equal((await provider.list({})).some(c=>c.name==='office-recalculate'),false)
  assert.equal(await provider.get(candidates.find(c=>c.name==='office-recalculate'),{}),undefined)
  disabled=new Set(definitions.map(c=>c.name))
  assert.equal((await provider.list({})).some(c=>c.name.startsWith('office')),false)
  const ctx=new Context()
  try {
    await ctx.plugin(SkillRegistry)
    const unregister=ctx.skills.registerProvider(()=>provider)
    assert.equal(await ctx.skills.get('artifact-documents'),undefined)
    disabled.clear();unregister()
    ctx.skills.registerProvider(()=>provider)
    assert.match((await ctx.skills.get('office-render')).content,/Installed LibreOffice Kit/)
  } finally {await ctx.fiber.dispose()}
})

test('standalone Office skills use registry-owned lazy reads and dispose cleanly', {skip:!process.env.EDUWORK_TEST_RUNTIME},async()=>{
  const previous=process.env.DSH_MEDIA_NODE_ENV,ctx=new Context()
  process.env.DSH_MEDIA_NODE_ENV=process.env.EDUWORK_TEST_RUNTIME
  try {
    await ctx.plugin(SkillRegistry)
    const dispose=installArtifactSkills(ctx)
    assert.equal((await ctx.skills.list()).length,10)
    assert.match((await ctx.skills.get('artifact-spreadsheets')).content,/office-recalculate/)
    assert.match((await ctx.skills.get('office-render')).content,/Installed LibreOffice Kit/)
    dispose();assert.deepEqual(await ctx.skills.list(),[])
  } finally {
    if(previous===undefined)delete process.env.DSH_MEDIA_NODE_ENV;else process.env.DSH_MEDIA_NODE_ENV=previous
    await ctx.fiber.dispose()
  }
})

test('conversion paths reject escape/junctions before creating output children',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'office-boundary-')),root=join(directory,'workspace'),outside=join(directory,'outside')
  await mkdir(root);await mkdir(outside);await writeFile(join(outside,'source.doc'),'sentinel')
  await symlink(outside,join(root,'link'),process.platform==='win32'?'junction':'dir')
  await assert.rejects(officeInputPath(root,'link/source.doc'),/outside/)
  await assert.rejects(officeOutputPath(root,'link/nested/new.docx'),/outside/)
  assert.deepEqual(await readdir(outside),['source.doc'])
  assert.equal(await readFile(join(outside,'source.doc'),'utf8'),'sentinel')
  for(const output_path of ['../escape.docx','C:\\escape.docx','file:stream.docx'])
    assert.throws(()=>normalizeOfficeRequest('document',{action:'convert',input_path:'a.doc',output_path}),/relative|inside|invalid/)
})

test('cancelled conversion never loads runtime or touches output; unrelated skills remain intact',async()=>{
  const signal=AbortSignal.abort()
  await assert.rejects(convertOfficeFile({inputPath:'unread',outputPath:'unwritten',signal,environment:{}}),{name:'AbortError'})
  const skill={name:'artifact-images',content:'custom content'}
  assert.equal(await withOfficialOfficeSkill(skill,{}),skill)
  assert.equal(await withOfficialOfficeSkill(undefined,{}),undefined)
})
