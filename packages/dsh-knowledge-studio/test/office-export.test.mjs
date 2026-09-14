import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
import JSZip from 'jszip'
import {exportDocument} from '../lib/studio-export.js'
import {exportWithOfficeTools} from '../lib/office-tools.js'
import {officeSpec} from '../lib/office-spec.js'

const report={id:'office-report',kind:'report',title:'质量报告',citations:[{evidenceId:'e1',path:'notes.md',lineStart:6,excerpt:'测试资料'}],content:{sections:[{id:'s1',heading:'质量要求',body:'**完整性**检查，保留 *责任人*。\n\n- 缺失字段\n- 补充记录\n\n| 检查 | 目的 |\n| --- | --- |\n| 唯一性 | 查重 |',evidenceIds:['e1']}]}}
test('report HTML/PDF source shares DOCX structure and omits empty references and unsafe HTML',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'studio-report-html-'))
 const file=await exportDocument(report,directory,'html'),html=await readFile(file.path,'utf8')
 for(const fragment of ['<h1>质量报告</h1>','<h2>质量要求</h2>','<strong>完整性</strong>','<em>责任人</em>','<table>','<th>检查</th>','<td>唯一性</td>','参考来源','notes.md'])assert.ok(html.includes(fragment),fragment)
 assert.ok(!html.includes('**完整性**'));assert.ok(!html.includes('<pre>#'))
 const untrusted={...report,title:'<script>title</script>',citations:[],content:{sections:[{heading:'A & B',body:'Body\n\n<script>danger()</script>\n\n![remote](https://example.invalid/tracker.png)',evidenceIds:[]}]}}
 const safe=await readFile((await exportDocument(untrusted,directory,'html')).path,'utf8')
 assert.ok(safe.includes('<h1>&lt;script&gt;title&lt;/script&gt;</h1>'));assert.ok(safe.includes('<h2>A &amp; B</h2>'))
 for(const absent of ['<script>','<img','danger()','tracker.png','参考来源','来源:'])assert.ok(!safe.includes(absent),absent)
})
test('DOCX preserves heading hierarchy, formatted content, tables and reference appendix',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'studio-docx-')),file=await exportDocument(report,directory,'docx')
 const zip=await JSZip.loadAsync(await readFile(file.path)),xml=await zip.file('word/document.xml').async('string')
 for(const text of ['质量报告','质量要求','完整性','责任人','唯一性','参考来源','notes.md'])assert.ok(xml.includes(text),text)
 assert.match(xml,/<w:pStyle w:val="Heading1"/);assert.match(xml,/<w:b\/>/);assert.match(xml,/<w:i\/>/);assert.match(xml,/<w:tbl>/);assert.ok(!xml.includes('**完整性**'))
 assert.ok(zip.file('word/footer1.xml'));assert.ok(zip.file('[Content_Types].xml'))
})
test('Office tools run create, validate and inspect under original execution context',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-office-')),calls=[],contexts=[]
 const execution={agent:{session:{header:{cwd:root}}},token:'parent',rootCallId:'root',deferContext:c=>contexts.push(c)}
 const ctx={fs:{resolve:async(p,{cwd})=>({path:resolve(cwd,p)}),processPath:p=>p.path},tools:{get:()=>true,execute:async request=>{
  calls.push(request);const a=request.arguments
  if(a.action==='create'){await mkdir(dirname(join(root,a.output_path)),{recursive:true});await writeFile(join(root,a.output_path),'office')}
  return {value:{reportJSON:JSON.stringify(a.action==='validate'?{valid:true}:{ok:true}),...(a.output_path?{relativePath:a.output_path}:{})},additionalContexts:[a.action]}
 }}}
 const file=await exportWithOfficeTools(ctx,report,join(root,'exports'),'docx',{execution})
 assert.equal(await readFile(file.path,'utf8'),'office');assert.equal(file.provider,'office-tools')
 assert.deepEqual(calls.map(c=>c.arguments.action),['create','validate','inspect']);assert.deepEqual(contexts,['create','validate','inspect'])
 for(const c of calls){assert.equal(c.parent,'parent');assert.equal(c.rootCallId,'root');assert.equal(c.agent,execution.agent)}
 assert.deepEqual(JSON.parse(calls[0].arguments.spec_json),officeSpec(report))
})
test('Office denial or failed validation does not silently fall back to another writer',async()=>{
 for(const invalid of ['deny','validation']) {
  let count=0
  const ctx={tools:{get:()=>true,execute:async({arguments:a})=>{count++;return invalid==='deny'?{isError:true,error:{message:'permission denied'}}:{value:{relativePath:a.output_path,reportJSON:JSON.stringify(a.action==='create'?{ok:true}:{valid:false})}}}}}
  await assert.rejects(exportWithOfficeTools(ctx,report,'unused','docx',{execution:{agent:{}}}),/permission denied|结构验证/)
  assert.equal(count,invalid==='deny'?1:2)
 }
})
test('formula-like source text remains literal through the shared XLSX engine',async()=>{
 const artifact={id:'literal-table',kind:'table',title:'literal',citations:[],content:{columns:['值'],rows:[{cells:['=1+1'],evidenceIds:[]}]}}
 const directory=await mkdtemp(join(tmpdir(),'studio-xlsx-')),file=await exportDocument(artifact,directory,'xlsx')
 const zip=await JSZip.loadAsync(await readFile(file.path)),xml=await zip.file('xl/worksheets/sheet1.xml').async('string')
 assert.ok(xml.includes('=1+1'));assert.ok(!xml.includes('<f>'));assert.match(xml,/t="inlineStr"/)
})
