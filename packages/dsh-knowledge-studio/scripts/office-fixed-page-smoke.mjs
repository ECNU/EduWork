// Actual file geometry must be invariant to container width; unsupported objects are explicit.
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {chromium} from '@playwright/test'
import {renderOfficePreview} from '../packages/artifact-services/lib/office-preview.js'

const execute=promisify(execFile)
const output=resolve(process.env.STUDIO_FIXED_OUTPUT||`dist/office-fixed-${Date.now()}`)
await mkdir(output,{recursive:true})
const file=join(output,'actual-input-4x3.pptx')
await execute(process.env.DSH_OFFICE_PYTHON,['-I','-X','utf8','test/fixtures/office-preview-deck.py',file],{windowsHide:true})
const preview=await renderOfficePreview(file)
await writeFile(join(output,'actual-input-4x3.html'),preview.html)
assert.match(preview.html,/data-office-warning-code="unsupported-object"/)
const browser=await chromium.launch({headless:true,...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{channel:'msedge'})})
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}})
 await page.setContent(preview.html);await page.evaluate(()=>document.fonts.ready)
 const geometry=()=>page.evaluate(()=>({
   page:[...document.querySelectorAll('.slide')].map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})),
   text:[...document.querySelectorAll('.shape-text')].map(n=>{const b=n.getBoundingClientRect(),style=getComputedStyle(n);return {text:n.textContent,width:b.width,height:b.height,font:style.fontSize,lines:n.innerHTML}})
 }))
 const wide=await geometry()
 assert.deepEqual(wide.page,[{width:960,height:720},{width:960,height:720}])
 const font=await page.locator('[data-shape-name="No wrap value"] span').evaluate(n=>getComputedStyle(n).fontFamily)
 assert.match(font,/Georgia/)
 assert.equal(await page.locator('[data-shape-name="Explicit font and breaks"] br').count(),1)
 assert.equal(await page.locator('[data-shape-name="Rounded file card"]').evaluate(n=>parseFloat(getComputedStyle(n).borderRadius)>0),true)
 assert.equal(await page.locator('[data-shape-name="Rounded file card"]').evaluate(n=>getComputedStyle(n).outlineStyle),'solid')
 assert.equal(await page.locator('[data-shape-name="No wrap value"] p').evaluate(n=>getComputedStyle(n).whiteSpace),'pre')
 await page.locator('.slide').first().screenshot({path:join(output,'actual-input-4x3.png')})
 await page.setViewportSize({width:450,height:800})
 assert.deepEqual(await geometry(),wide,'container width must not reflow fixed pages')
 await writeFile(join(output,'result.json'),JSON.stringify({passed:true,fixedGeometry:wide,actualPPTX:file,visualReview:'pending'},null,2))
 console.log('Actual PPTX: fixed geometry, explicit fonts, soft breaks, no-wrap, shape styles and unsupported-object notice passed.')
}finally{await browser.close()}
