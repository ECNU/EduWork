import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {startIsolatedHost} from './host-process.mjs'

const hostVersion=JSON.parse(await readFile(resolve(process.env.STUDIO_TEST_DSH_RUNTIME||'.','node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version
if(['0.1.5-alpha.1','0.1.5-rc.1'].includes(hostVersion)) {await import('./host-sidebar-ui-smoke.mjs');process.exit(0)}

const host=await startIsolatedHost({syntheticSession:true}),directory=resolve(process.env.STUDIO_HOST_UI_OUTPUT||'dist/host-ui')
await mkdir(directory,{recursive:true})
let browser,page
try {
 browser=await chromium.launch({...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{}),headless:true})
 page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:900}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(host.launch)
 const base=new URL(host.launch).origin
 const rpc=async(method,args)=>{
  const response=await page.request.post(base+'/api/'+method,{headers:{origin:base},data:{type:'client-request',rpcId:'host-ui-smoke',method,payload:{args}}})
  const envelope=await response.json();assert.equal(envelope.result.ok,true,JSON.stringify(envelope));return envelope.result.value
 }
 const path=host.fixture.workspace
 const {workspace}=await rpc('workspace/create',{request:{path}})
 // Alpha cold-list rows use cached projections only. A native rename hydrates
 // this persisted fixture and makes its title discoverable without a model turn.
 const {title:fixtureTitle}=await rpc('session/rename',{request:{sessionId:host.fixture.sessionId,title:host.fixture.title}})
 await rpc('session/create',{request:{workspaceId:workspace.workspaceId}})
 await page.reload()
 await page.getByRole('button',{name:'继续',exact:true}).click()
 await page.getByRole('button',{name:'稍后配置',exact:true}).click()
 await page.getByText('新会话',{exact:true}).last().click()
 const entry=page.getByRole('button',{name:'Studio 工作区',exact:true})
 const reading=page.locator('[data-studio-reading-layer]')
 const draft=page.locator('[data-composer-input="true"]')
 const screenshot=name=>page.screenshot({path:join(directory,name+'.png')})
 const uniqueEntry=async(placement,active)=>{
  await expect(entry).toHaveCount(1)
  await expect(entry).toBeVisible()
  await expect(entry).toHaveAttribute('data-studio-entry-placement',placement)
  await expect(entry).toHaveAttribute('aria-pressed',String(active))
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  // Geometry assertions must wait for the host's animated grid tracks.
  await expect.poll(()=>page.locator('[data-shell-overlay]').locator('..').evaluate(frame=>Math.abs(parseFloat(getComputedStyle(frame).gridTemplateColumns.split(' ').at(-1))-parseFloat(frame.style.gridTemplateColumns.split(' ').at(-1))))).toBeLessThan(1)
  await expect(entry).toHaveAttribute('data-studio-entry-placement',placement)
  const box=await entry.boundingBox();assert.ok(box.y<60&&box.height>=32&&box.width>=32,JSON.stringify(box))
 }
 const inReading=async value=>expect(reading).toHaveAttribute('data-reading-active',String(value))
 const studio=page.locator('[data-knowledge-studio-capability]')
 await uniqueEntry('blank',false)
 await draft.fill('保留空白会话的未发送草稿')
 assert.equal(await page.locator('[data-knowledge-studio-welcome],[data-knowledge-studio-status]').count(),0)
 await screenshot('blank-session')
 await entry.click()
 await expect(studio).toHaveCount(8)
 await uniqueEntry('reading',true);await inReading(true)
 await screenshot('blank-studio')
 assert.equal(await page.getByRole('button',{name:/工作区 Wiki|建立 Wiki|搜索资料/}).count(),0)
 assert.equal(await page.locator('[data-knowledge-studio-consent],[data-wiki-progress]').count(),0)
 const snapshot=await rpc('knowledgeStudio/workspaceForPath',{path})
 assert.equal(snapshot.capabilities.length,8);assert.ok(Array.isArray(snapshot.artifacts))
 await entry.click();await uniqueEntry('blank',false);await inReading(false)
 assert.equal(await draft.textContent(),'保留空白会话的未发送草稿')

 // A real nonblank host session, written with public Jsonl persistence before boot.
 console.log('Blank Studio, creation-only UI and draft checks passed')
 await page.getByText(fixtureTitle,{exact:true}).first().click()
 await uniqueEntry('utilities',false)
 await entry.click()
 await uniqueEntry('utilities',true);await inReading(false)
 await expect(page.getByRole('button',{name:'展开阅读',exact:true})).toBeVisible()
 await expect(studio).toHaveCount(8)
 const log=page.getByRole('button',{name:/Session.*(日志|log)/i}).first()
 await expect(log).toBeVisible()
 const e=await entry.boundingBox(),l=await log.boundingBox()
 assert.ok(Math.abs(e.y-l.y)<16&&Math.min(e.x+e.width,l.x+l.width)<=Math.max(e.x,l.x),'Studio and Session log must be side by side without overlap')
 assert.ok(e.x+e.width<1440-250,'Filled entry follows the conversation column, not the entire window edge')
 await draft.fill('保留已有对话的未发送草稿')
 await screenshot('filled-sidebar')
 // Closing also collapses the host column. Reopen must not interpret that old
 // layout as a narrow viewport. Wait for the closing frame to settle.
 await entry.click();await uniqueEntry('utilities',false)
 const frame=page.locator('[data-shell-overlay]').locator('..')
 await expect(frame).toHaveAttribute('data-details-collapsed','true')
 await entry.click();await uniqueEntry('utilities',true);await inReading(false)
 await expect(page.getByRole('button',{name:'展开阅读',exact:true})).toBeVisible()
 await screenshot('filled-reopened-sidebar')
 console.log('Filled 1440px initial/reopen sidebar and Session log alignment passed')
 await page.getByRole('button',{name:'展开阅读',exact:true}).click()
 await uniqueEntry('reading',true);await inReading(true)
 const back=page.getByRole('button',{name:'返回对话',exact:true})
 const r=await entry.boundingBox(),b=await back.boundingBox()
 assert.ok(r.x+r.width<=b.x&&Math.abs(r.y-b.y)<4)
 await screenshot('filled-reading')
 await entry.click();await uniqueEntry('utilities',false)
 await entry.click();await uniqueEntry('utilities',true);await inReading(false)
 await page.getByRole('button',{name:'展开阅读',exact:true}).click()
 await uniqueEntry('reading',true);await inReading(true)
 await back.click();await uniqueEntry('utilities',true);await inReading(false)
 assert.equal(await draft.textContent(),'保留已有对话的未发送草稿')

 await page.setViewportSize({width:780,height:900})
 await uniqueEntry('reading',true);await inReading(true)
 assert.equal(await entry.locator('.ks-studio-entry-label').isVisible(),false)
 await screenshot('narrow-reading')
 await back.click();await uniqueEntry('utilities',false);await inReading(false)
 await entry.click();await uniqueEntry('reading',true);await inReading(true)
 await page.setViewportSize({width:1440,height:900})
 await uniqueEntry('reading',true);await inReading(true)
 await expect(frame).not.toHaveAttribute('data-details-collapsed','true')
 await back.click();await uniqueEntry('utilities',true);await inReading(false)
 await entry.click();await uniqueEntry('utilities',false)
 await entry.click();await uniqueEntry('utilities',true);await inReading(false)
 assert.equal(await draft.textContent(),'保留已有对话的未发送草稿')
 await screenshot('wide-restored')
 console.log('Reading toggle, 780px fallback, widen/return/reopen passed')

 await entry.click();await uniqueEntry('utilities',false)
 await page.getByText('新会话',{exact:true}).last().click()
 await page.getByRole('button',{name:'稍后配置',exact:true}).click()
 await uniqueEntry('blank',false)
 // The host's New session flow owns reuse/creation and its draft lifecycle.
 // Verify Studio against the current blank draft, then switch to the filled row.
 await draft.fill('切换后的空白会话草稿')
 await entry.click();await uniqueEntry('reading',true)
 await entry.click();await uniqueEntry('blank',false)
 await expect(draft).toHaveText('切换后的空白会话草稿')
 await entry.click();await uniqueEntry('reading',true)
 await page.getByText(fixtureTitle,{exact:true}).first().click()
 await uniqueEntry('utilities',true);await inReading(false)
 assert.equal(await draft.textContent(),'保留已有对话的未发送草稿')
 await screenshot('session-switch-restored')
 await expect.poll(async()=>await rpc('knowledgeStudio/readUIPreferences',{})).toEqual({open:true})
 await page.reload();await uniqueEntry('utilities',true)
 await entry.click();await uniqueEntry('utilities',false)
 await expect.poll(async()=>await rpc('knowledgeStudio/readUIPreferences',{})).toEqual({open:false})
 await page.reload();await uniqueEntry('utilities',false)
 const skipModelSetup=async()=>{
  const later=page.getByRole('button',{name:'稍后配置',exact:true})
  if(await later.waitFor({timeout:1200}).then(()=>true).catch(()=>false))await later.click()
 }
 const reloadWithoutModelSetup=async()=>{await page.reload();await skipModelSetup()}
 // Simulate an existing profile's open preference without any model call.
 // A blank draft must remain the first visible surface after authentication
 // or reload, and only a usable real conversation may restore the sidebar.
 await page.getByText('新会话',{exact:true}).last().click()
 await skipModelSetup()
 await rpc('knowledgeStudio/setUIOpenPreference',{open:true})
 await reloadWithoutModelSetup();await uniqueEntry('blank',false);await inReading(false)
 await expect.poll(async()=>await rpc('knowledgeStudio/readUIPreferences',{})).toEqual({open:true})
 await screenshot('historical-open-blank-stays-chat')
 await entry.click();await uniqueEntry('reading',true);await inReading(true)
 await page.getByRole('button',{name:'返回对话',exact:true}).click()
 await uniqueEntry('blank',false);await inReading(false)
 await expect.poll(async()=>await rpc('knowledgeStudio/readUIPreferences',{})).toEqual({open:false})
 await reloadWithoutModelSetup();await uniqueEntry('blank',false);await inReading(false)
 await screenshot('blank-return-reload-stays-chat')
 await rpc('knowledgeStudio/setUIOpenPreference',{open:true})
 await reloadWithoutModelSetup();await uniqueEntry('blank',false)
 await page.getByText(fixtureTitle,{exact:true}).first().click()
 await uniqueEntry('utilities',true);await inReading(false)
 await page.getByRole('button',{name:'展开阅读',exact:true}).click();await inReading(true)
 await page.getByText('新会话',{exact:true}).last().click()
 await skipModelSetup()
 await uniqueEntry('blank',false);await inReading(false)
 await expect.poll(async()=>await rpc('knowledgeStudio/readUIPreferences',{})).toEqual({open:true})
 await page.getByText(fixtureTitle,{exact:true}).first().click()
 await uniqueEntry('utilities',true);await inReading(false)
 await screenshot('conversation-restores-sidebar-only')
 await page.setViewportSize({width:780,height:900})
 await uniqueEntry('utilities',false);await inReading(false)
 await reloadWithoutModelSetup();await uniqueEntry('utilities',false);await inReading(false)
 await expect.poll(async()=>await rpc('knowledgeStudio/readUIPreferences',{})).toEqual({open:true})
 await screenshot('narrow-automatic-restore-stays-chat')
 await page.setViewportSize({width:1440,height:900})
 await uniqueEntry('utilities',true);await inReading(false)
 await page.setViewportSize({width:780,height:900})
 await uniqueEntry('utilities',false);await inReading(false)
 await entry.click();await uniqueEntry('reading',true);await inReading(true)
 await page.getByRole('button',{name:'返回对话',exact:true}).click()
 await uniqueEntry('utilities',false);await inReading(false)
 await expect.poll(async()=>await rpc('knowledgeStudio/readUIPreferences',{})).toEqual({open:false})
 await reloadWithoutModelSetup();await uniqueEntry('utilities',false);await inReading(false)
 await screenshot('narrow-explicit-return-persists-close')
 assert.deepEqual(errors,[])
 const dsh=JSON.parse(await readFile(resolve(process.env.STUDIO_TEST_DSH_RUNTIME||'.','node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version
 const report={passed:true,dsh,externalModelCalls:false,isolatedHome:true,checks:['native workspace/session RPC and persisted filled fixture','blank top-right entry','eight studio capabilities without index','no Wiki/search/consent surfaces','one pressed toggle across blank/utilities/reading','filled 1440px first open and reopen stay in sidebar','Session log shares toolbar without overlap','filled entry follows conversation right edge','reading requires explicit expansion after reopening','780px reading fallback and return','widen/return/reopen restores sidebar','session switch cleans header ownership','both native unsent drafts preserved','historical open preference does not auto-open a blank session','blank reader return persists closed across reload','switching sessions never restores reading mode','automatic narrow restore preserves chat and open preference','widening restores sidebar without a reader','explicit narrow opening remains usable and return saves closed'],errors}
 await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}catch(error){if(page){await writeFile(join(directory,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(directory,'failure.png')})}throw error}
finally{await browser?.close();await host.stop()}
