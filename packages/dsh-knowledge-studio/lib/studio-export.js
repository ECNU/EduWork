import {runOffice,normalizeOfficeRequest} from '@eduwork/dsh-artifact-services/office'
import {createMediaRuntime} from '@eduwork/dsh-artifact-services/runtime'
import {renderOfficePreview,assertOfficeSourceSize} from '@eduwork/dsh-artifact-services/office-preview'
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { contentMarkdown } from './studio-content.js'
import { officeSpec } from './office-spec.js'
import {officeFormatFor} from './export-recovery.js'
import {layoutMindmap,mindmapSVG,mindmapPNGSize} from './mindmap.js'

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
// Use the same structured report as DOCX, keeping headings, emphasis and tables
// consistent without interpreting raw HTML or loading remote document resources.
function reportHTML(artifact) {
  const inline=run=>{
    let value=escapeHTML(run.text).replaceAll('\n','<br>')
    if(run.font==='Consolas')value=`<code>${value}</code>`
    if(run.italic)value=`<em>${value}</em>`
    if(run.bold)value=`<strong>${value}</strong>`
    return value
  }
  return '<article class="report">'+officeSpec(artifact).blocks.map(block=>{
    if(block.type==='title')return `<h1>${escapeHTML(block.text)}</h1>`
    if(block.type==='heading'){const level=Math.min(6,block.level+1);return `<h${level}>${escapeHTML(block.text)}</h${level}>`}
    if(block.type==='paragraph')return `<p>${(block.runs||[{text:block.text}]).map(inline).join('')}</p>`
    if(block.type==='table')return '<table>'+block.rows.map((row,index)=>{const tag=block.header&&index===0?'th':'td';return '<tr>'+row.map(cell=>`<${tag}>${escapeHTML(cell)}</${tag}>`).join('')+'</tr>'}).join('')+'</table>'
    return ''
  }).join('')+'</article>'
}
export async function exportDocument(artifact, directory, format, {signal}={}) {
  signal?.throwIfAborted()
  await mkdir(directory, { recursive:true })
  const path = join(directory, `${artifact.id}.${format}`)
  const content = artifact.content
  if (format === 'json') await writeFile(path, JSON.stringify({ ...artifact, exports:undefined },null,2))
  else if (format === 'md') await writeFile(path, contentMarkdown(artifact))
  else if (format === 'svg' && artifact.kind === 'mindmap') await writeFile(path,mindmapSVG(content,artifact.title))
  else if (format === 'png' && artifact.kind === 'mindmap') {
    const {chromium}=await import('playwright-core')
    let browserExecutable
    try {({browserExecutable}=await createMediaRuntime())}
    catch {throw new Error('服务端 PNG 导出需要宿主配置图形运行时；也可以在 Studio 界面下载 PNG，或通过此接口导出 SVG。')}
    const layout=layoutMindmap(content),size=mindmapPNGSize(layout.width,layout.height)
    const browser=await chromium.launch({executablePath:browserExecutable,headless:true})
    try {
      const page=await browser.newPage({viewport:{width:size.width,height:size.height},deviceScaleFactor:1})
      await page.route('**/*',route=>route.abort())
      const svg=Buffer.from(mindmapSVG(content,artifact.title)).toString('base64')
      await page.setContent(`<body style="margin:0;background:white"><img alt="思维导图" style="display:block;width:100vw;height:100vh" src="data:image/svg+xml;base64,${svg}"></body>`)
      await page.locator('img').evaluate(image=>image.decode())
      await page.screenshot({path,type:'png'})
    } finally {await browser.close()}
  }
  else if (format === 'html') {
    if(artifact.kind==='slides'||artifact.exports?.some(file=>file.format===officeFormatFor(artifact.kind))) {
      // Reuse the actual Office artifact, including legacy files or a file edited
      // outside Studio. Preview, HTML and PDF never recompose stored slide text.
      const original=artifact.exports?.find(file=>file.format===officeFormatFor(artifact.kind))
      const file=original??await exportDocument(artifact,directory,'pptx')
      assertOfficeSourceSize((await stat(file.path)).size)
      const preview=await renderOfficePreview(file.path)
      await writeFile(path,preview.html)
      return {format,path,fileName:`${artifact.id}.${format}`}
    }
    const body = artifact.kind === 'report' ? reportHTML(artifact) : `<pre>${escapeHTML(contentMarkdown(artifact))}</pre>`
    await writeFile(path, `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHTML(artifact.title)}</title><style>body{margin:0;background:#f6f4ef;color:#202e3b;font:20px/1.7 system-ui}section{box-sizing:border-box;min-height:100vh;padding:7vw;page-break-after:always;border-bottom:1px solid #ddd}h1{font-size:48px;max-width:1000px}li{margin:18px 0}small,p{color:#64717a}pre{white-space:pre-wrap;padding:5vw;font:inherit}.report{box-sizing:border-box;max-width:860px;margin:auto;padding:40px;background:white;font-size:16px;overflow-wrap:anywhere}.report h1{font-size:32px;line-height:1.3}.report h2{font-size:23px;margin-top:1.6em}.report h3{font-size:19px}.report h1,.report h2,.report h3,.report h4,.report h5,.report h6{break-after:avoid}.report p{color:inherit;orphans:3;widows:3}.report code{white-space:pre-wrap;font:0.9em/1.6 monospace}.report table{border-collapse:collapse;width:100%;font-size:0.9em;table-layout:fixed}.report th,.report td{border:1px solid #cdd3d8;padding:8px;text-align:left}.report th{background:#eef1f3}.report tr{break-inside:avoid}@media print{body:has(.report){background:white}.report{max-width:none;padding:0;font-size:11pt}.report h1{font-size:24pt}.report h2{font-size:17pt}.report h3{font-size:14pt}section{min-height:0;height:95vh}}</style>${body}</html>`)
  } else if (format === 'pdf') {
    const html=await exportDocument(artifact,directory,'html')
    const {chromium}=await import('playwright-core')
    const {browserExecutable}=await createMediaRuntime()
    const browser=await chromium.launch({executablePath:browserExecutable,headless:true})
    try {
      const page=await browser.newPage();await page.route('**/*',route=>route.abort())
      await page.setContent(await readFile(html.path,'utf8'))
      await page.evaluate(()=>document.fonts.ready)
      await page.pdf(artifact.kind==='slides'?{path,preferCSSPageSize:true,printBackground:true,margin:{top:0,bottom:0,left:0,right:0}}:{path,format:'A4',printBackground:true,margin:{top:'12mm',bottom:'12mm',left:'10mm',right:'10mm'}})
    } finally {await browser.close()}
  } else if (['docx','pptx','xlsx'].includes(format)) {
    const kind={docx:'document',pptx:'presentation',xlsx:'spreadsheet'}[format]
    const exists=await stat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error})
    if(exists){const validation=await runOffice({projectPath:directory,signal,request:normalizeOfficeRequest(kind,{action:'validate',input_path:artifact.id+'.'+format})});if(validation.report.valid!==true)throw new Error('Office 文件结构验证未通过');return {format,path,fileName:artifact.id+'.'+format,...(format==='pptx'?{pageCount:validation.report.summary?.slide_count}:{})}}
    const result=await runOffice({projectPath:directory,signal,request:normalizeOfficeRequest(kind,{action:'create',output_path:artifact.id+'.'+format,spec_json:JSON.stringify(officeSpec(artifact))})})
    if(result.report.ok!==true)throw new Error('Office creation failed')
    const validation=await runOffice({projectPath:directory,signal,request:normalizeOfficeRequest(kind,{action:'validate',input_path:artifact.id+'.'+format})})
    if(validation.report.valid!==true)throw new Error('Office 文件结构验证未通过')
    return {format,path,fileName:`${artifact.id}.${format}`,...(format==='pptx'?{pageCount:result.report.slide_count,sourcePages:result.report.source_pages,adaptations:result.report.adaptations}:{})}
  } else if (format === 'csv' && artifact.kind === 'table') {
    const cell = value => { let v=String(value); if (/^[=+@\-\t\r]/.test(v)) v="'"+v; return '"'+v.replaceAll('"','""')+'"' }
    const rows = [content.columns, ...content.rows.map(row => row.cells)]
    await writeFile(path, '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n'))
  } else throw new Error(`此成果不支持 ${format} 导出`)
  return { format, path, fileName:`${artifact.id}.${format}` }
}

export async function readExportFile(exported) {
  if((await stat(exported.path)).size>128*1024*1024)throw new Error(`文件超过内联下载上限，请从本机打开：${exported.path}`)
  return { ...exported, data:(await readFile(exported.path)).toString('base64') }
}
