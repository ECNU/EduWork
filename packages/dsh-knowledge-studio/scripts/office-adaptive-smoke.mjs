import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {runOffice,normalizeOfficeRequest} from '@eduwork/dsh-artifact-services/office'
import {renderOfficePreview} from '@eduwork/dsh-artifact-services/office-preview'
import {chromium} from '@playwright/test'

const directory=resolve(process.env.STUDIO_ADAPTIVE_OUTPUT||'dist/office-adaptive');await mkdir(directory,{recursive:true})
const points=Array.from({length:5},(_,i)=>`第${i+1}项：`+'完整保留中文论述和比较依据，不以字符数限制截断原文。'.repeat(2))
const specs=[{layout:'two-column',title:'两方面资料完整比较',left:{heading:'第一方面',bullets:points},right:{heading:'第二方面',bullets:points.map(s=>'对照'+s)},speaker_notes:'完整备注：这是合成回归内容，不含真实会话材料。'},
  {layout:'metrics',title:'较宽比较值',metrics:[{value:'W'.repeat(24),label:'完整比较值',detail:'保持一行，不缩为不可读字号'},{value:'75% → 85%',label:'比例',detail:'完整保留空格'}],speaker_notes:'指标口径完整保留。'}]
const results=[]
const browser=await chromium.launch({headless:true,...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{})})
try {
 for(const theme of ['modern-clean','academic-editorial']) {
  const name=theme+'.pptx',path=join(directory,name)
  const request=normalizeOfficeRequest('presentation',{action:'create',output_path:name,spec_json:JSON.stringify({theme,slides:specs})})
  // A fresh output directory is required: never overwrite a prior inspection.
  const created=await runOffice({projectPath:directory,request})
  const validation=await runOffice({projectPath:directory,request:normalizeOfficeRequest('presentation',{action:'validate',input_path:name})})
  assert.equal(validation.report.valid,true,JSON.stringify(validation.report))
  assert.ok(created.report.slide_count>2);assert.equal(created.report.source_pages.length,2)
  await writeFile(join(directory,theme+'.spec.json'),JSON.stringify(specs))
  const inspected=JSON.parse(execFileSync(process.env.DSH_OFFICE_PYTHON,['-I','-X','utf8','-c',
   'import json,sys; from pptx import Presentation; p=Presentation(sys.argv[1]); specs=json.load(open(sys.argv[2],encoding="utf8")); ranges=json.loads(sys.argv[3]); rows=[]\nfor spec,m in zip(specs,ranges):\n slides=list(p.slides)[m["first_page"]-1:m["last_page"]]; text="|".join("".join(s.text for slide in slides for s in slide.shapes if s.has_text_frame and ("adaptive "+str(c)+"-") in s.name).replace("\\n","") for c in range(2)); required=([spec[side]["heading"] for side in ["left","right"]]+[v for side in ["left","right"] for v in spec[side]["bullets"]]) if spec["layout"]=="two-column" else [v for metric in spec["metrics"] for v in metric.values()]; assert all(v in text for v in required),(required,text); assert all(spec["speaker_notes"] in slide.notes_slide.notes_text_frame.text for slide in slides); fonts=[r.font.size.pt for slide in slides for s in slide.shapes if s.has_text_frame and "adaptive" in s.name for p in s.text_frame.paragraphs for r in p.runs]; assert fonts and min(fonts)>=18; rows.append({"completeFields":len(required),"pages":len(slides),"minimumBodyFont":min(fonts),"notes":True})\nprint(json.dumps(rows))',path,join(directory,theme+'.spec.json'),JSON.stringify(created.report.source_pages)],{encoding:'utf8',windowsHide:true}))
  const preview=await renderOfficePreview(path);assert.equal(preview.description.pageCount,created.report.slide_count)
  const page=await browser.newPage({viewport:{width:1440,height:950}})
  await page.setContent(preview.html);await page.evaluate(()=>document.fonts.ready)
  // Fixed-page previews need no element scrolling or stability polling to capture.
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'})
  const geometry=await page.locator('.slide').evaluateAll(slides=>slides.map(slide=>{const rect=slide.getBoundingClientRect();return {width:rect.width,height:rect.height}}))
  assert.equal(geometry.length,created.report.slide_count)
  assert.ok(geometry.every(rect=>rect.width>0&&rect.height>0))
  assert.ok(geometry.every(rect=>rect.width===geometry[0].width&&rect.height===geometry[0].height))
  await page.screenshot({path:join(directory,theme+'-all-pages.png'),fullPage:true,animations:'disabled'})
  await page.close()
  results.push({theme,path,...created.report,inspection:inspected,valid:true})
 }
 await assert.rejects(runOffice({projectPath:directory,request:normalizeOfficeRequest('presentation',{action:'create',output_path:'invalid.pptx',spec_json:JSON.stringify({slides:[{...specs[0],left:{heading:'错误字段',bullets:points,unknown:'不得丢弃'}}]})})}),/unknown|unsupported|未知|unexpected/i)
 await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,results},null,2));console.log('Adaptive actual PPTX and browser export passed')
}finally{await browser.close()}
