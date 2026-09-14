// Headless local Web acceptance; no desktop window or debugging port is opened.
// Session tool records are explicitly synthetic, renderer/file bytes are real.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import {join,resolve,basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {parseArgs,promisify} from 'node:util'
const {values}=parseArgs({options:Object.fromEntries(['product','home','evidence','url-file'].map(k=>[k,{type:'string'}]))})
for(const k of ['product','home','evidence','url-file'])assert.ok(values[k],k)
const product=resolve(values.product),home=resolve(values.home),evidence=resolve(values.evidence)
assert.doesNotMatch(product,/[\\/]current(?:[\\/]|$)/i)
await mkdir(evidence,{recursive:true})
const workspace=join(evidence,'preview-workspace-web');await mkdir(workspace,{recursive:true})
const url=(await readFile(resolve(values['url-file']),'utf8')).trim();assert.equal(new URL(url).hostname,'127.0.0.1')
const resources=JSON.parse(await readFile(join(product,'desktop-resources.json'),'utf8'))
const {chromium}=createRequire(join(product,'d/package.json'))('playwright-core')
const browser=await chromium.launch({headless:true,executablePath:resolve(product,resources.environment.DSH_MEDIA_BROWSER)})
const page=await browser.newPage({viewport:{width:1440,height:960},locale:'zh-CN'})
page.setDefaultTimeout(20000)
const result={passed:false,syntheticSession:true,officialRenderer:true,checks:[]}
const rpc=(method,args={})=>page.evaluate(async({method,args})=>{
 const body=await(await fetch('/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'documents-test',method,payload:{args}})})).json()
 if(!body.result?.ok)throw Error(method+' failed');return body.result.value
},{method,args})
try{
 await page.goto(url,{waitUntil:'domcontentloaded'})
 await page.addLocatorHandler(page.getByRole('dialog',{name:'内测声明'}),async d=>d.getByRole('button',{name:'继续',exact:true}).click())
 await page.addLocatorHandler(page.getByRole('dialog',{name:'添加一个 API Key 开始使用'}),async d=>d.getByRole('button',{name:'稍后配置',exact:true}).click())
 await writeFile(join(workspace,'document.md'),'# 官方 Markdown 验证\n\n| 阶段 | 完成率 |\n|---|---|\n| A | 75% |\n| B | 90% |\n')
 await writeFile(join(workspace,'document.html'),'<!doctype html><meta charset="utf-8"><h1>隔离 HTML 验证</h1><p id="status">ready</p><script>try{parent.document.body;document.getElementById("status").textContent="unsafe"}catch{document.getElementById("status").textContent="parent-isolated"}</script>')
 await copyFile(fileURLToPath(new URL('../assets/eduwork/icon-128.png',import.meta.url)),join(workspace,'document.png'))
 const registered=await rpc('workspace/create',{request:{path:workspace}})
 const files=['document.md','document.html','document.png']
 await writeFile(join(evidence,'fixture.json'),JSON.stringify({workspace,workspaceId:registered.workspace.workspaceId,files,filesReady:true,title:'Official documents · web',uniqueTitle:'Official document renderer verification'}))
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./desktop-preview-fixture.mjs',import.meta.url)),product,home,evidence],{windowsHide:true})
 const fixture=JSON.parse(await readFile(join(evidence,'fixture.json'),'utf8'))
 await rpc('session/create',{request:{workspaceId:registered.workspace.workspaceId,sessionId:fixture.sessionId}})
 await rpc('session/rename',{request:{sessionId:fixture.sessionId,title:fixture.title}})
 await page.reload({waitUntil:'domcontentloaded'})
 const rows=page.getByRole('treeitem').filter({has:page.getByText(basename(workspace),{exact:true})})
 for(const row of await rows.all())if(await row.getAttribute('aria-expanded')==='false')await row.getByText(basename(workspace),{exact:true}).click()
 await page.getByRole('treeitem').getByText(fixture.title,{exact:true}).first().click()
 const open=async file=>{await page.getByRole('button',{name:'在侧边栏预览 '+file,exact:true}).click();await page.locator('[data-document-preview]:visible').waitFor()}
 await open('document.md')
 const doc=page.locator('[data-document-preview]:visible')
 await doc.getByRole('heading',{name:'官方 Markdown 验证',exact:true}).waitFor();await doc.locator('table').waitFor()
 assert.equal(await page.locator('[data-eduwork-artifact-tab]:visible').count(),0)
 await page.screenshot({path:join(evidence,'markdown.png')})
 await doc.locator('[data-document-viewer-menu]').click();await page.getByRole('menuitem',{name:'代码',exact:true}).click()
 assert.match(await doc.locator('[data-code-preview]').innerText(),/# 官方 Markdown 验证/)
 result.checks.push('official-markdown-render-and-code-source')
 await open('document.html')
 await doc.frameLocator('[data-html-preview]').getByRole('heading',{name:'隔离 HTML 验证'}).waitFor()
 await doc.frameLocator('[data-html-preview]').getByText('parent-isolated',{exact:true}).waitFor()
 result.checks.push('official-html-opaque-origin')
 await open('document.png')
 await page.waitForFunction(()=>document.querySelector('[data-image-preview] img')?.naturalWidth===128)
 await page.screenshot({path:join(evidence,'image.png')})
 result.checks.push('official-image-render')
 assert.equal(await page.locator('[data-presented-file]').count(),3)
 assert.equal(await page.locator('[data-chatecnu-artifact-row]').count(),0)
 result.passed=true
}catch(error){result.error=String(error.message);process.exitCode=1;await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{})}
finally{await writeFile(join(evidence,'result.json'),JSON.stringify(result,null,2)+'\n');await browser.close();console.log(JSON.stringify(result))}
