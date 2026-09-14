import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {chromium,expect} from '@playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {createServer} from 'node:http'
const directory=resolve(process.env.STUDIO_EVIDENCE_UI_OUTPUT||'dist/artifact-evidence-ui');await mkdir(directory,{recursive:true})
const result=await build({entryPoints:['test/fixtures/artifact-evidence.tsx'],metafile:true,bundle:true,write:false,format:'esm',platform:'browser'})
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/app.js'?result.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><style>body{margin:0}</style><div id="root"></div><script type="module" src="/app.js"></script>')})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{}),headless:true})
const page=await browser.newPage({locale:'zh-CN',viewport:{width:1360,height:920}}),errors=[],externalRequests=[],checks=[]
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(origin))externalRequests.push(request.url())})
try{
 await page.goto(origin)
 await page.getByRole('button',{name:'Studio 工作区',exact:true}).click()
 await expect(page.locator('[data-knowledge-studio-capability]')).toHaveCount(8)
 for(const view of ['wiki','search','wikievidence']){await page.evaluate(view=>window.sourceTest.legacy(view),view);await expect(page.locator('[data-knowledge-studio-capability]')).toHaveCount(8);assert.equal((await page.evaluate(()=>window.sourceTest.state())).reading,false);assert.equal((await page.evaluate(()=>window.sourceTest.state())).memory.view,'home')}
 assert.equal(await page.getByRole('button',{name:/工作区 Wiki|建立 Wiki|搜索资料/}).count(),0)
 await page.locator('[data-studio-artifact-id="source-report"]').click()
 await page.getByRole('heading',{name:'可阅读报告',exact:true}).waitFor()
 await page.getByRole('button',{name:'展开阅读',exact:true}).click()
 await page.locator('[data-studio-sources] summary').click()
 await page.getByRole('button',{name:/source|资料\/规则.md/}).click()
 const evidence=page.locator('[data-studio-evidence-content]')
 await expect(evidence.getByRole('heading',{name:'引用资料标题',exact:true})).toBeVisible();await expect(evidence.getByRole('listitem')).toHaveCount(2)
 await expect(evidence.getByRole('cell',{name:'已核对',exact:true})).toBeVisible();await expect(evidence.locator('pre code')).toContainText('const answer = 42')
 await expect(evidence.getByRole('link',{name:'外部说明',exact:true})).toHaveAttribute('href','https://example.org/guide')
 await expect(evidence.getByRole('link',{name:'危险链接',exact:true})).toHaveCount(0);await expect(evidence.locator('img,script')).toHaveCount(0)
 await expect(page.getByRole('alert')).toContainText('生成时的资料快照');await expect(page.getByText('资料/规则.md · L3–9',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'打开原文',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.sourceTest.state().opened)).toEqual(['/synthetic-artifacts/资料/规则.md'])
 await page.screenshot({path:join(directory,'artifact-evidence-markdown.png')})
 await page.getByRole('button',{name:'← 返回',exact:true}).click();await expect(page.getByRole('heading',{name:'可阅读报告',exact:true})).toBeVisible()
 const state=await page.evaluate(()=>window.sourceTest.state());assert.equal(state.draft,'保留我的未发送草稿');assert.equal(state.preferredOpen,true);assert.equal(state.submissions,0);assert.deepEqual(state.retiredCalls,[])
 assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);assert.equal(await page.evaluate(()=>window.__bad),undefined)
 checks.push('retired remembered views restore Studio home without reading mode or retired RPC calls','artifact reading and citation Markdown headings/lists/tables/code/links remain usable','source location, changed-file snapshot warning, original-file opening and artifact return','raw HTML/unsafe URLs blocked; zero external image requests; draft and preference preserved')
 assert.ok(!Object.keys(result.metafile.inputs).some(path=>/WikiReader|WikiProgress/.test(path)))
 await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,productionComponents:true,mockedService:true,checks,errors,externalRequests,modelCalls:0},null,2));console.log('Artifact evidence and retired-view migration production UI checks passed')
}catch(error){await page.screenshot({path:join(directory,'failure.png')});await writeFile(join(directory,'failure.txt'),String(error.stack)+'\n'+await page.locator('body').innerText());throw error}finally{await browser.close();server.close()}
