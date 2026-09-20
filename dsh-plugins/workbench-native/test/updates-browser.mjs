// Exercise the actual shared update UI without touching a user installation.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../../..',import.meta.url)),runtime=process.env.EDUWORK_TEST_RUNTIME
assert.ok(runtime,'Set EDUWORK_TEST_RUNTIME')
const req=createRequire(join(runtime,'package.json')),ts=createRequire(join(process.env.EDUWORK_BUILD_TOOLS||join(root,'.cache/client-build-tools'),'package.json'))('typescript')
const {chromium}=req('playwright-core')
const component=ts.transpileModule(await readFile(new URL('../src/updates.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
 .replace(/import React, \{ useEffect, useSyncExternalStore \} from ['"]react['"];?/,'const {useEffect,useSyncExternalStore}=React;')
 .replace(/import \{ createPortal \} from ['"]react-dom['"];?/,'const {createPortal}=ReactDOM;')
assert.doesNotMatch(component,/from ['"]react/)
let policy='stable',state='up_to_date',downloaded=0,scheduled=false
let content=null,softwareEnabled=true,nativeUI=false
const actions=[]
const server=createServer(async(request,response)=>{
 if(request.url==='/react.js'||request.url==='/react-dom.js') {
  response.setHeader('content-type','text/javascript');response.end(await readFile(join(runtime,'node_modules',request.url==='/react.js'?'react/umd/react.development.js':'react-dom/umd/react-dom.development.js')));return
 }
 if(request.url==='/component.js'){response.setHeader('content-type','text/javascript');response.end(component);return}
 if(request.url.startsWith('/api/')) {
  const action=request.url.slice(5);actions.push(action)
  if(action.startsWith('use-')){policy=action==='use-development-updates'?'development':'stable';state='idle'}
  if(action==='check-updates'&&softwareEnabled)state='available'
  if(action==='download-content-update')content={...content,state:'downloading',downloadedBytes:512}
  if(action==='restart-content-update')content={...content,state:'current',configurationRevision:2,skillsRevision:3}
  if(action==='download-update'){state='downloading';downloaded=524288}
  if(action==='test-complete')state='ready'
  if(action==='schedule-update')scheduled=true
  if(action==='install-update')state='applying'
  response.setHeader('content-type','application/json');response.end(JSON.stringify({version:'0.3.5-dev.20260912.1',shell:'wails',phase:state,update:{nativeUI,policies:['stable','development'],state,policy,enabled:softwareEnabled,latestVersion:'0.3.5',downloadedBytes:downloaded,totalBytes:1048576,installOnNextStart:scheduled},contentUpdate:content}));return
 }
 response.setHeader('content-type','text/html');response.end(`<html><meta charset="utf-8"><body style="font:14px system-ui;margin:40px;max-width:600px"><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">import {createUpdateController,UpdatePanel,UpdateFooter} from '/component.js';const controller=createUpdateController(async action=>(await fetch('/api/'+action)).json());ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(React.Fragment,null,React.createElement(UpdatePanel,{controller}),React.createElement(UpdateFooter,{controller})));</script></body></html>`)
})
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));let browser
try {
 browser=await chromium.launch({channel:'msedge',headless:true})
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
 const url=`http://127.0.0.1:${server.address().port}`
 const evidence=join(root,'dist/update-layout-20260912');await mkdir(evidence,{recursive:true})
 await page.goto(url);await page.getByText('当前已是最新版本',{exact:true}).waitFor()
 assert.equal(await page.locator('select').count(),0)
 assert.equal(await page.getByText(/下载期间可以继续对话/).count(),0)
 const title=await page.getByText('自动更新',{exact:true}).boundingBox(),check=await page.getByRole('button',{name:'检查更新',exact:true}).boundingBox()
 assert.ok(check.x>title.x&&Math.abs(check.y-title.y)<2,'Check action belongs on the title row')
 await page.screenshot({path:join(evidence,'up-to-date.png')})
 await page.getByRole('radio',{name:'开发版',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('[role="radio"]')?.getAttribute('aria-disabled')==='false')
 assert.equal(policy,'development');assert.ok(actions.includes('use-development-updates'))
 await page.reload();await page.getByRole('radiogroup',{name:'更新渠道'}).waitFor();assert.equal(await page.getByRole('radio',{name:'开发版',exact:true}).getAttribute('aria-checked'),'true')
 // The 0.2 button switch remains keyboard accessible and follows the global theme.
 await page.getByRole('radio',{name:'开发版',exact:true}).focus();await page.keyboard.press('ArrowLeft')
 await page.waitForFunction(()=>document.querySelector('[role="radio"][aria-checked="true"]')?.textContent==='仅公测版'&&document.querySelector('[role="radio"]').getAttribute('aria-disabled')==='false')
 await page.keyboard.press('ArrowRight')
 await page.waitForFunction(()=>document.querySelector('[role="radio"][aria-checked="true"]')?.textContent==='开发版'&&document.querySelector('[role="radio"]').getAttribute('aria-disabled')==='false')
 await page.evaluate(()=>document.documentElement.style.setProperty('--dsw-alias-state-business-primary','#3575ef'))
 assert.equal(await page.getByRole('radio',{name:'开发版',exact:true}).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(53, 117, 239)')
 const pill=page.locator('[data-eduwork-update-entry]');assert.equal(await pill.innerText(),'更新')
 await pill.click();await page.getByRole('dialog',{name:'更新',exact:true}).getByRole('button',{name:'下载更新',exact:true}).click();await page.keyboard.press('Escape');await page.getByLabel('更新下载进度').waitFor()
 assert.equal(await page.getByLabel('更新下载进度').getAttribute('aria-valuenow'),'50')
 assert.equal(await page.getByRole('radio',{name:'开发版',exact:true}).isDisabled(),true)
 await page.screenshot({path:join(evidence,'download-blue.png')})
 await page.evaluate(()=>document.documentElement.style.setProperty('--dsw-alias-state-business-primary','#9f2636'))
 assert.equal(await page.getByRole('radio',{name:'开发版',exact:true}).evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(159, 38, 54)')
 await page.screenshot({path:join(evidence,'download-red.png')})
 await page.reload();await page.getByLabel('更新下载进度').waitFor()
 assert.equal(await page.getByLabel('更新下载进度').getAttribute('aria-valuenow'),'50')
 await page.evaluate(()=>window.dispatchEvent(new Event('eduwork:open-updates')))
 const dialog=page.getByRole('dialog',{name:'更新',exact:true});await dialog.waitFor()
 assert.equal(await dialog.getByLabel('更新下载进度').getAttribute('aria-valuenow'),'50')
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
 assert.equal(await page.getByLabel('更新下载进度').getAttribute('aria-valuenow'),'50')
 await fetch(url+'/api/test-complete');await page.waitForFunction(()=>document.querySelector('[data-eduwork-update-entry]')?.textContent==='重启更新')
 assert.equal(await page.getByRole('radio',{name:'开发版',exact:true}).isDisabled(),true)
 await page.screenshot({path:join(evidence,'ready.png')})
 await page.getByRole('button',{name:'下次启动时安装',exact:true}).click()
 await page.getByText(/已校验，将在下次启动时安装/).waitFor();assert.equal(scheduled,true)
 assert.equal(await page.getByRole('button',{name:'下次启动时安装',exact:true}).count(),0)
 // Content-only updates use the same entry even when software updating is disabled.
 softwareEnabled=false;state='up_to_date';content={enabled:true,configuration:true,skills:true,policy:'development',state:'available',configurationRevision:1,skillsRevision:0,latestRevision:2,totalBytes:1024,downloadedBytes:0}
 await page.reload();await page.getByText('发现内容更新 r2 · 1 KB',{exact:true}).waitFor()
 await pill.click();await dialog.waitFor()
 await dialog.getByRole('button',{name:'下载内容更新',exact:true}).click()
 await dialog.getByLabel('内容下载进度').waitFor()
 assert.equal(await dialog.getByLabel('内容下载进度').getAttribute('aria-valuenow'),'50')
 await page.keyboard.press('Escape');await page.reload()
 await page.getByLabel('内容下载进度').waitFor()
 assert.equal(await page.getByLabel('内容下载进度').getAttribute('aria-valuenow'),'50')
 content={...content,state:'ready',downloadedBytes:1024}
 await page.getByText('已下载并校验，下次启动生效。',{exact:true}).waitFor()
 assert.equal(await pill.innerText(),'内容待生效')
 await pill.click();await dialog.waitFor();await page.screenshot({path:join(evidence,'content-ready.png')})
 await dialog.getByRole('button',{name:'重启使内容生效',exact:true}).click()
 await dialog.getByText('配置 r2 · Skills r3',{exact:true}).waitFor()
 assert.ok(actions.includes('restart-content-update'))
 await page.keyboard.press('Escape')
 nativeUI=true;softwareEnabled=true;state='up_to_date';content={...content,state:'available',latestRevision:4}
 await page.reload();await page.getByText('macOS 应用更新',{exact:true}).waitFor()
 await page.getByText('配置与 Skills 更新',{exact:true}).waitFor()
 await page.getByRole('button',{name:'下载内容更新',exact:true}).click()
 await page.getByLabel('内容下载进度').waitFor()
 content={...content,state:'current'};await page.reload()
 await page.getByRole('radio',{name:'仅公测版',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('[role=radio][aria-checked=true]')?.textContent==='仅公测版')
 await page.screenshot({path:join(evidence,'mac-software-and-content.png')})
 assert.deepEqual(errors,[])
 await writeFile(join(evidence,'update-browser.json'),JSON.stringify({passed:true,sourceLayout:'0.2.0 / d8691cb UpdateSettings',channelSwitch:true,keyboardSwitch:true,themes:['blue','red'],persisted:true,bluePill:true,downloadProgress:50,progressAfterReloadAndModalClose:true,scheduleNextStart:true,channelLockedDuringDownload:true,actions:actions.filter(a=>a!=='status'),errors},null,2))
 console.log('Shared update UI acceptance passed')
} finally {await browser?.close();await new Promise(ok=>server.close(ok))}
