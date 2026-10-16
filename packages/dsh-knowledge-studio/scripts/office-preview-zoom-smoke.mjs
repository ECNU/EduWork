import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium} from '@playwright/test'
import {verifyOfficePreviewZoom} from './office-preview-zoom-checks.mjs'

const directory=resolve(process.env.STUDIO_OFFICE_ZOOM_OUTPUT||'dist/office-preview-zoom')
await mkdir(directory,{recursive:true})
const source=await readFile('packages/artifact-services/lib/office-preview-client.js','utf8')
const preview={html:'<!doctype html><html><body><article>'+Array.from({length:80},(_,i)=>`<p>合成连续文档段落 ${i+1}：验证自动适应与手动缩放。</p>`).join('')+'</article></body></html>',description:{schemaVersion:1,kind:'document',sourceHash:'synthetic-zoom-document',cacheKey:'synthetic-zoom-document',warnings:[]}}
const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0}#one{width:574.5px;height:800px}</style><div id="one"></div><script type="module">import {mountOfficePreview} from '/viewer.js';window.one=mountOfficePreview(document.querySelector('#one'),{preview:${JSON.stringify(preview).replaceAll('<',String.fromCharCode(92)+'u003c')},title:'自动适应回归'});window.ready=true;</script>`
const server=createServer((request,response)=>{
  const script=request.url==='/viewer.js'
  response.setHeader('Content-Type',script?'application/javascript':'text/html; charset=utf-8')
  response.end(script?source:html)
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let browser
try {
  // Preserve real scrollbar layout; headless defaults can hide the feedback loop.
  browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars'],...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{})})
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.waitForFunction(()=>window.ready)
  const checks=await verifyOfficePreviewZoom(page)
  if(errors.length)throw new Error(errors.join('\n'))
  const result={passed:true,checks,errors,browserVersion:browser.version()}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve))}
