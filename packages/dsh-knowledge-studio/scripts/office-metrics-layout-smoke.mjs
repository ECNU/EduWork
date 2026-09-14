// Long comparison values must survive actual PPTX and shared HTML rendering.
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {chromium} from '@playwright/test'
import {runOffice,normalizeOfficeRequest} from '../packages/artifact-services/lib/office.js'
import {renderOfficePreview} from '../packages/artifact-services/lib/office-preview.js'

const execute=promisify(execFile)
const directory=resolve(process.env.STUDIO_METRICS_OUTPUT||'dist/office-metrics-layout')
await mkdir(directory,{recursive:true})
const metrics=['75%→85%','100%→99%','3.6→4.1','12345678'].map(value=>({value,label:'目录条目带来源与版本说明的比例',detail:'这是合成测试的完整说明，用于核验最长中文内容在四项指标卡片中仍然可读，并且不会触碰边界。'}))
const spaced=['75% → 85%','100% → 99%','3.6 → 4.1','3.6% → 4.1%'].map((value,index)=>({...metrics[index],value}))
const browser=await chromium.launch({headless:true,...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:process.platform==='win32'?{channel:'msedge'}:{})})
const rows=[]
const stamp=Date.now()
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}})
  for(const theme of ['academic-editorial','modern-clean','digital-tech','warm-education']) {
    const filename=`${theme}-${stamp}.pptx`,path=join(directory,filename)
    await runOffice({projectPath:directory,request:normalizeOfficeRequest('presentation',{action:'create',output_path:filename,spec_json:JSON.stringify({theme,slides:[{layout:'metrics',title:'比较值及完整中文说明',metrics},{layout:'metrics',title:'保留空格与小数的比较值',metrics:spaced}]})})})
    const native=JSON.parse((await execute(process.env.DSH_OFFICE_PYTHON,['-I','-X','utf8','-c',`
import json,sys
from pptx import Presentation
p=Presentation(sys.argv[1]); values=[s for page in p.slides for s in page.shapes if 'Metric Value' in s.name]
assert len(values)==8
assert all(s.text_frame.word_wrap is False for s in values)
assert [s.text for s in values]==['75%→85%','100%→99%','3.6→4.1','12345678','75% → 85%','100% → 99%','3.6 → 4.1','3.6% → 4.1%']
assert all(s.text_frame.paragraphs[0].runs[0].font.size.pt >= 12 for s in values)
print(json.dumps({'values':[s.text for s in values],'sizes':[s.text_frame.paragraphs[0].runs[0].font.size.pt for s in values]}))
`,path],{windowsHide:true})).stdout)
    const {html}=await renderOfficePreview(path);await writeFile(join(directory,`${theme}.html`),html)
    await page.setContent(html);await page.evaluate(()=>document.fonts.ready)
    const checked=await page.evaluate(()=>[...document.querySelectorAll('[data-shape-name]')].filter(n=>/Metric (Value|Label|Detail)/.test(n.dataset.shapeName)).map(n=>{
      const box=n.getBoundingClientRect(),rects=[],walker=document.createTreeWalker(n,NodeFilter.SHOW_TEXT)
      let node,maxLineHeight=0
      while(node=walker.nextNode()) {
        const style=getComputedStyle(node.parentElement);maxLineHeight=Math.max(maxLineHeight,parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.2)
        for(let i=0;i<node.textContent.length;i++){
          if(!node.textContent[i].trim())continue
          const range=document.createRange();range.setStart(node,i);range.setEnd(node,i+1);rects.push(range.getBoundingClientRect())
        }
      }
      const ys=new Set(rects.map(r=>Math.round(r.top)))
      const text={left:Math.min(...rects.map(r=>r.left)),right:Math.max(...rects.map(r=>r.right))}
      return {name:n.dataset.shapeName,text:n.textContent,lines:ys.size,lineHeight:maxLineHeight,boxHeight:box.height,fits:text.left>=box.left-1&&text.right<=box.right+1&&ys.size*maxLineHeight<=box.height+1}
    }))
    await writeFile(join(directory,`${theme}-checks.json`),JSON.stringify(checked,null,2))
    await page.screenshot({path:join(directory,`${theme}.png`),fullPage:true})
    assert.equal(checked.length,24)
    for(const item of checked){assert.equal(item.fits,true,`${theme}: ${item.name} overflow`);if(item.name.includes('Value'))assert.equal(item.lines,1,`${theme}: numeric comparison split across lines`)}
    rows.push({theme,path,native,checked})
  }
  await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,actualPPTX:true,sharedHTML:true,rows},null,2))
  console.log('Metrics comparison values and long Chinese labels/details fit in all four themes.')
}finally{await browser.close()}
