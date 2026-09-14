import {build} from 'esbuild'
import {chromium} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
const directory=resolve('dist/ui');await mkdir(directory,{recursive:true})
const result=await build({entryPoints:['test/fixtures/studio-flow.tsx'],bundle:true,write:false,format:'esm',platform:'browser'})
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/app.js'?result.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>')})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{}),headless:true})
const page=await browser.newPage({locale:'zh-CN',viewport:{width:1280,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
try {
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 const entry=page.getByRole('button',{name:'Studio 工作区',exact:true})
 await entry.waitFor();const box=await entry.boundingBox();assert.ok(box.y<32&&box.height>=32&&box.width>=32)
 assert.equal(await page.locator('[data-knowledge-studio-capability]').count(),0)
 assert.equal(await page.locator('[data-knowledge-studio-welcome],[data-knowledge-studio-status]').count(),0)
 await page.screenshot({path:resolve(directory,'flow-home.png')})
 await entry.click();await page.locator('[data-knowledge-studio-capability="report"]').waitFor()
 assert.equal(await page.locator('[data-knowledge-studio-capability]').count(),8)
 assert.equal(await page.getByRole('button',{name:'搜索资料',exact:true}).count(),0)
 assert.equal(await entry.count(),1)
 assert.equal(await entry.getAttribute('aria-pressed'),'true')
 assert.equal(await page.getByRole('button',{name:/工作区 Wiki|建立 Wiki|搜索资料/}).count(),0)
 assert.equal(await page.locator('[data-knowledge-studio-consent],[data-wiki-progress]').count(),0)
 await page.getByRole('button',{name:'关闭面板'}).click();await entry.waitFor()
 assert.equal(await page.evaluate(()=>window.studioTest.preference()),false)
 await page.evaluate(()=>window.studioTest.showAutomatically())
 await page.locator('[data-knowledge-studio-capability="report"]').waitFor()
 assert.equal(await page.evaluate(()=>window.studioTest.preference()),false,'automatic artifact display must not overwrite explicit closed preference')
 await page.evaluate(()=>window.studioTest.closeAutomatically())
 assert.equal(await page.evaluate(()=>window.studioTest.preference()),false)
 assert.equal(await page.getByRole('textbox',{name:'对话草稿'}).inputValue(),'未发送草稿')
 assert.deepEqual(errors,[])
 await writeFile(resolve(directory,'studio-flow.json'),JSON.stringify({passed:true,checks:['empty composer','top-right Studio toggle','no global knowledge warnings','no Wiki/search/consent UI','draft preservation'],errors},null,2));console.log('Studio production component flow passed')
}finally{await browser.close();server.close()}
