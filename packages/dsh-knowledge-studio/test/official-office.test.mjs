import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,readdir,symlink,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {normalizeOfficeRequest,actionNeedsApproval} from '../packages/artifact-services/lib/office.js'
import {officeInputPath,officeOutputPath,convertOfficeFile,withOfficialOfficeSkill} from '../packages/artifact-services/lib/official-office.js'

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
  assert.equal(withOfficialOfficeSkill(skill,{}),skill)
  assert.equal(withOfficialOfficeSkill(undefined,{}),undefined)
})
