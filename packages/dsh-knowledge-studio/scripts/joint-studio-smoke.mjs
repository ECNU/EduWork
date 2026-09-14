import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {basename,join,resolve} from 'node:path'
import {chromium,expect} from '@playwright/test'

// Generation requires an explicitly provisioned and authorized test model.
const generate=process.env.STUDIO_JOINT_GENERATE==='1'
assert.ok(process.env.STUDIO_JOINT_ROOT,'Set STUDIO_JOINT_ROOT to the local frozen assembly directory')
const assemblyRoot=resolve(process.env.STUDIO_JOINT_ROOT)
const privateConfig=JSON.parse(await readFile(join(assemblyRoot,'frozen.private.json'),'utf8'))
const launch=(await readFile(join(assemblyRoot,'frozen-logs/url.txt'),'utf8')).trim()
const base=new URL(launch).origin
assert.equal(new URL(launch).hostname,'127.0.0.1')
const outputBase=join(assemblyRoot,'studio-joint');await mkdir(outputBase,{recursive:true})
const output=await mkdtemp(join(outputBase,'entry-')),workspace=join(output,'studio-joint-'+basename(output))
await mkdir(workspace)
await writeFile(join(workspace,'sources.md'),'# 联合验收合成资料\n\n项目甲由张同学负责，计划9月10日完成资料核验。项目乙由李同学负责，计划9月12日完成结果复核。\n\n完整性检查缺失字段，唯一性检查重复记录。一致性比较相同指标定义。处理记录包含负责人、原因和结果。\n')
await writeFile(join(output,'process.json'),JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),mode:'forms-only'}))
const browser=await chromium.launch({headless:true,executablePath:privateConfig.environment.DSH_MEDIA_BROWSER})
const page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:1000}})
const errors=[],requests=[]
page.on('pageerror',error=>errors.push(error.message.replace(/token=[^\s&]+/g,'token=[redacted]')))
page.on('request',request=>{
  const url=new URL(request.url())
  if(url.pathname.startsWith('/api/'))requests.push(url.pathname)
})
try {
  await page.goto(launch)
  const rpc=async(method,args)=>{
    const response=await page.request.post(base+'/api/'+method,{headers:{origin:base},data:{type:'client-request',rpcId:'studio-joint-entries',method,payload:{args}}})
    const result=(await response.json()).result
    assert.equal(result?.ok,true,'RPC failed: '+method)
    return result.value
  }
  const createdWorkspace=(await rpc('workspace/create',{request:{path:workspace}})).workspace
  const createdSession=await rpc('session/create',{request:{workspaceId:createdWorkspace.workspaceId}})
  await writeFile(join(output,'session-shape.json'),JSON.stringify({keys:Object.keys(createdSession)},null,2))
  const sessionId=createdSession.sessionId??createdSession.session?.sessionId??createdSession.session?.id
  assert.ok(sessionId,'Session creation must return an identity')
  const renamed=await rpc('session/rename',{request:{sessionId,title:'Studio 联合入口验收'}})
  await page.reload()
  for(const name of ['继续','稍后配置']) {
    const button=page.getByRole('button',{name,exact:true})
    if(await button.waitFor({timeout:5000}).then(()=>true).catch(()=>false))await button.click()
  }
  const title=page.getByText(renamed.title,{exact:true}).first()
  if(await title.count())await title.click()
  else await page.getByText(basename(workspace),{exact:true}).first().click()
  const entry=page.getByRole('button',{name:'Studio 工作区',exact:true})
  await expect(entry).toBeVisible();await entry.click()
  await expect(page.locator('[data-knowledge-studio-capability]')).toHaveCount(8)
  const sidebarEvidence=await page.locator('[data-knowledge-studio-capability]').first().evaluate(el=>({insideOfficialPanel:Boolean(el.closest('[data-sidebar-right-panel]')),panels:[...document.querySelectorAll('[data-sidebar-right-panel]')].map(x=>x.getAttribute('data-sidebar-right-panel')),readingActive:document.querySelector('[data-studio-reading-layer]')?.getAttribute('data-reading-active'),tabs:[...document.querySelectorAll('[data-dockkit-tab-title]')].map(x=>x.textContent)}))
  await writeFile(join(output,'sidebar-dom.json'),JSON.stringify(sidebarEvidence,null,2))
  const snapshot=await rpc('knowledgeStudio/workspaceForPath',{path:workspace})
  const results=[]
  for(const capability of snapshot.capabilities) {
    const button=page.locator(`[data-knowledge-studio-capability="${capability.id}"]`)
    if(!capability.available) {
      await expect(button).toBeDisabled()
      results.push({id:capability.id,available:false,reason:capability.unavailableReason,formTested:false})
      continue
    }
    await button.click()
    const dialog=page.getByRole('dialog',{name:capability.title,exact:true})
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button',{name:'开始生成',exact:true})).toBeVisible()
    const labels=await dialog.locator('label').allTextContents()
    results.push({id:capability.id,available:true,formTested:true,labels})
    if(!generate) {
      await dialog.getByRole('button',{name:'取消任务',exact:true}).click()
      await expect(dialog).toHaveCount(0)
      continue
    }
    for(const parameter of capability.parameters??[]) {
      const control=dialog.getByLabel(parameter.label,{exact:true})
      if(!await control.isVisible().catch(()=>false))continue
      if(parameter.id==='focus')await control.fill('仅基于 sources.md 合成材料完成小型验收成果。文字简短，不联网，不添加材料外事实。音视频总讲述控制在100字以内。')
      if(parameter.id==='count')await control.selectOption(String(parameter.options[0].value))
    }
    await dialog.getByRole('button',{name:'开始生成',exact:true}).click()
    const deadline=Date.now()+10*60*1000
    let artifact
    while(Date.now()<deadline) {
      const current=await rpc('knowledgeStudio/workspaceForPath',{path:workspace})
      const found=current.artifacts?.find(item=>item.kind===capability.id)
      if(found)artifact=(await rpc('knowledgeStudio/readArtifact',{artifactId:found.id})).artifact
      await writeFile(join(output,'progress.json'),JSON.stringify({kind:capability.id,status:artifact?.status??'awaiting-agent',artifactId:artifact?.id,updatedAt:new Date().toISOString()}))
      if(artifact&&['completed','failed','cancelled'].includes(artifact.status))break
      await new Promise(resolve=>setTimeout(resolve,3000))
    }
    assert.equal(artifact?.status,'completed',`${capability.id}: ${artifact?.error??artifact?.status??'no artifact produced within test budget'}`)
    await writeFile(join(output,capability.id+'.json'),JSON.stringify(artifact,null,2))
    const view=page.locator(`[data-studio-artifact="${capability.id}"]`)
    if(!await view.isVisible()) {
      const entry=page.getByRole('button',{name:'Studio 工作区',exact:true})
      if(await entry.getAttribute('aria-pressed')==='false')await entry.click()
      const card=page.locator(`[data-studio-artifact-id="${artifact.id}"]`)
      if(await card.isVisible())await card.click()
    }
    await expect(view).toBeVisible({timeout:15000})
    await page.screenshot({path:join(output,capability.id+'.png')})
    const options=view.locator('[data-studio-downloads] option')
    const formats=await options.evaluateAll(items=>items.map(item=>item.value).filter(Boolean))
    assert.ok(formats.length,capability.id+' must offer downloads')
    for(const format of formats) {
      const pending=page.waitForEvent('download',{timeout:120000})
      await view.locator('[data-studio-downloads]').selectOption(format)
      const download=await pending
      await download.saveAs(join(output,capability.id+'.'+format))
      assert.equal(await download.failure(),null)
    }
    results.at(-1).generation={artifactId:artifact.id,status:artifact.status,downloadFormats:formats}
    await writeFile(join(output,'completed.json'),JSON.stringify(results,null,2))
    await view.getByRole('button',{name:'返回 Studio',exact:true}).click()
  }
  await page.screenshot({path:join(output,'entries.png')})
  assert.deepEqual(errors,[])
  if(!generate)assert.equal(requests.some(path=>/\/invokeStudio$|\/manageArtifact$/.test(path)),false)
  const result={passed:true,scope:generate?'browser-generation-and-downloads':'entry-forms-only',results,fixtureSessionId:sessionId,workspace,externalModelCalls:generate?'authorized personal model':0,generationSubmitted:generate,errors}
  await writeFile(join(output,'result.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({passed:true,output,formsTested:results.filter(item=>item.formTested).length,unavailable:results.filter(item=>!item.available)}))
} catch(error) {
  await writeFile(join(output,'failure.txt'),(await page.locator('body').innerText()).replace(/token=[^\s&]+/g,'token=[redacted]'))
  await page.screenshot({path:join(output,'failure.png')})
  console.error(String(error?.stack||error).replace(/token=[^\s&]+/g,'token=[redacted]'))
  process.exitCode=1
} finally {await browser.close()}
