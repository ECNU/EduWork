// Real PPTX bytes -> shared preview -> wide/narrow browser + PDF inspection.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from '@playwright/test'
import {build} from 'esbuild'
import { renderOfficePreview } from '../packages/artifact-services/lib/office-preview.js'

const execute = promisify(execFile)
const directory = resolve(process.env.STUDIO_OFFICE_PREVIEW_OUTPUT || 'dist/office-preview-scaling')
await mkdir(directory, { recursive: true })
const python = process.env.DSH_OFFICE_PYTHON
assert.ok(python, 'use the configured managed Office Python')
const pptx = join(directory, 'synthetic.pptx')
await execute(python, ['-I', '-X', 'utf8', '-c', `
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.dml.color import RGBColor
p=Presentation(); p.slide_width=Inches(13.333333); p.slide_height=Inches(7.5)
for i in range(2):
 s=p.slides.add_slide(p.slide_layouts[6]); s.background.fill.solid(); s.background.fill.fore_color.rgb=RGBColor(246,242,235)
 box=s.shapes.add_textbox(Inches(1),Inches(1),Inches(10.5),Inches(1.2)); box.name='Scaling title'
 f=box.text_frame; f.margin_left=Pt(12); f.margin_top=Pt(6); f.word_wrap=True
 q=f.paragraphs[0]; q.line_spacing=1.12; q.space_after=Pt(0)
 r=q.add_run(); r.text='合成验收：图形与中文字号同步缩放 '+str(i+1); r.font.name='Microsoft YaHei'; r.font.size=Pt(32); r.font.bold=True
 box=s.shapes.add_textbox(Inches(3),Inches(3),Inches(6),Inches(1.4)); box.name='Centered body'
 f=box.text_frame; f.vertical_anchor=MSO_ANCHOR.MIDDLE
 q=f.paragraphs[0]; q.alignment=PP_ALIGN.CENTER
 r=q.add_run(); r.text='保留居中与文字间距'; r.font.name='Microsoft YaHei'; r.font.size=Pt(24)
p.save(sys.argv[1])
`, pptx], { windowsHide: true })
const preview=await renderOfficePreview(pptx),{html}=preview
await writeFile(join(directory, 'preview.html'), html)
assert.ok(Math.abs(Number(html.match(/data-slide-width="([\d.]+)"/)[1]) - 1280) < .01)
assert.match(html, /data-slide-count="2"/)
assert.equal(preview.description.pageCount,2)
assert.doesNotMatch(html, /<script[\s>]/)
const browser = await chromium.launch({ ...(process.env.STUDIO_TEST_BROWSER ? { executablePath: process.env.STUDIO_TEST_BROWSER } : process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true })
const errors = [], requests = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => requests.push(r.url()))
  const client=await build({entryPoints:['packages/artifact-services/lib/office-preview-client.js'],bundle:true,write:false,format:'iife',globalName:'SharedOfficePreview',platform:'browser'})
  await page.setContent('<!doctype html><style>body{margin:0}#viewer{width:100vw;height:90vh}</style><div id="viewer"></div>')
  await page.addScriptTag({content:client.outputFiles[0].text})
  await page.evaluate(preview=>{window.viewer=SharedOfficePreview.mountOfficePreview(document.querySelector('#viewer'),{preview})},preview)
  const frame=page.frameLocator('[data-office-file-preview]')
  async function measure() {
    return frame.locator('.slide').first().evaluate(slide => {
      const title = slide.querySelector('[data-shape-name="Scaling title"]')
      const run = title.querySelector('span'), p = title.querySelector('p')
      const centered = slide.querySelector('[data-shape-name="Centered body"]')
      const box = title.getBoundingClientRect(), bounds = slide.getBoundingClientRect()
      return { slideWidth: bounds.width, slideHeight: bounds.height, font: parseFloat(getComputedStyle(run).fontSize), padding: parseFloat(getComputedStyle(title).paddingLeft), width: box.width, left: box.left - bounds.left, textWidth: p.scrollWidth, clientWidth: p.clientWidth, textHeight: title.scrollHeight, clientHeight: title.clientHeight, centered: getComputedStyle(centered.querySelector('p')).textAlign, anchor: getComputedStyle(centered).justifyContent }
    })
  }
  const wide = await measure()
  const wideScale=await page.evaluate(()=>window.viewer.getState().scale)
  await page.screenshot({ path: join(directory, 'wide.png'), fullPage: true })
  await page.setViewportSize({ width: 440, height: 900 })
  const narrow = await measure()
  await page.screenshot({ path: join(directory, 'narrow.png'), fullPage: true })
  const narrowScale=await page.evaluate(()=>window.viewer.getState().scale),ratio=narrowScale/wideScale
  assert.ok(ratio<.5,'narrow viewport scales the whole page')
  assert.deepEqual(narrow,wide,'internal geometry and wrapping stay fixed while iframe is scaled')
  for (const measured of [wide, narrow]) {
    assert.ok(measured.textWidth <= measured.clientWidth + 1)
    assert.ok(measured.textHeight <= measured.clientHeight + 1)
    assert.equal(measured.centered, 'center')
    assert.equal(measured.anchor, 'center')
  }
  const pdf = join(directory, 'preview.pdf')
  await page.setContent(html)
  await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true })
  const { stdout } = await execute(python, ['-I', '-X', 'utf8', '-c', `
import json,sys
from pypdf import PdfReader
p=PdfReader(sys.argv[1]); texts=[page.extract_text() for page in p.pages]
assert len(p.pages)==2, len(p.pages)
assert all('合成验收' in text for text in texts)
assert all('隔离预览' not in text and '第 1 页' not in text for text in texts)
for page in p.pages:
 assert abs(float(page.mediabox.width)/float(page.mediabox.height)-16/9)<.01
print(json.dumps({'pages':len(p.pages),'dimensions':[[float(page.mediabox.width),float(page.mediabox.height)] for page in p.pages],'textVerified':True}))
`, pdf], { windowsHide: true })
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  await writeFile(join(directory, 'result.json'), JSON.stringify({ passed: true, wide, narrow, wideScale,narrowScale,ratio,description:preview.description,pdf: JSON.parse(stdout), browserErrors: errors, networkRequests: requests, actualPPTX: true }, null, 2))
  console.log('Shared viewer scales actual fixed PPTX pages without changing inner geometry or wrapping; PDF remains one slide per page.')
} finally { await browser.close() }
