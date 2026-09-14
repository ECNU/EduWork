import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {chromium,expect} from '@playwright/test'
import {startIsolatedHost} from './host-process.mjs'
import {studioNavigation} from './host-studio-navigation.mjs'
import {renderOfficePreview} from '@eduwork/dsh-artifact-services/office-preview'

const directory=resolve(process.env.STUDIO_OFFICE_UI_OUTPUT||'dist/office-host-ui');await mkdir(directory,{recursive:true})
const host=await startIsolatedHost({syntheticOffice:true})
let browser,page
try {
  browser=await chromium.launch({headless:true,...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{})})
  page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:960},acceptDownloads:true})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(host.launch)
  const base=new URL(host.launch).origin
  const response=await page.request.post(base+'/api/session/rename',{headers:{origin:base},data:{type:'client-request',rpcId:'office-ui',method:'session/rename',payload:{args:{request:{sessionId:host.fixture.sessionId,title:host.fixture.title}}}}})
  const renamed=(await response.json()).result;assert.equal(renamed.ok,true)
  await page.reload();await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'稍后配置',exact:true}).click()
  if(!await page.getByText(renamed.value.title,{exact:true}).count())await page.getByText('合成工作区',{exact:true}).first().click()
  await page.getByText(renamed.value.title,{exact:true}).first().click()
  const entry=studioNavigation(page);await entry.open()
  const slides=host.fixture.artifacts.find(artifact=>artifact.kind==='slides'),draft=host.fixture.artifacts.find(artifact=>artifact.draft)
  await page.locator(`[data-studio-artifact-id="${slides.id}"]`).click()
  const preview=page.frameLocator('[data-office-file-preview]')
  await expect(preview.locator('.slide')).toHaveCount(1)
  const original=await renderOfficePreview(slides.exports[0].path)
  await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-source-hash',original.description.sourceHash)
  const actualPages=await page.evaluate(html=>[...new DOMParser().parseFromString(html,'text/html').querySelectorAll('.slide')].map(slide=>slide.outerHTML),original.html)
  for(let index=0;index<actualPages.length;index++) {
    await page.getByRole('spinbutton',{name:'当前页码'}).fill(String(index+1));await page.getByRole('spinbutton',{name:'当前页码'}).press('Tab')
    await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-page',String(index+1))
    await expect.poll(()=>preview.locator('.slide').evaluate(slide=>slide.outerHTML)).toBe(actualPages[index])
  }
  await page.getByRole('spinbutton',{name:'当前页码'}).fill('3');await page.getByRole('spinbutton',{name:'当前页码'}).press('Tab')
  await page.getByRole('button',{name:'原始尺寸 100%',exact:true}).click()
  assert.equal(await page.locator('[data-office-file-preview]').getAttribute('sandbox'),'')
  await expect(page.locator('[data-studio-slide-notes]')).not.toHaveAttribute('open','')
  await page.screenshot({path:join(directory,'sidebar-pptx.png')})
  await entry.fullscreen()

  await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-page','3')
  await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-scale','1')
  await page.getByRole('combobox',{name:'页面缩放模式'}).selectOption('fit-page')
  await page.screenshot({path:join(directory,'reading-pptx.png')})
  await page.locator('[data-studio-slide-notes] summary').click();await expect(page.locator('[data-studio-slide-notes]')).toContainText(slides.content.slides[0].notes)
  await expect(page.getByRole('combobox',{name:'下载成果',exact:true})).toBeVisible()
  const downloads={}
  for(const format of ['pptx','html','pdf','md']) {
    const pending=page.waitForEvent('download')
    if(format==='pptx')await page.getByRole('button',{name:'下载 PPTX',exact:true}).click()
    else await page.getByRole('combobox',{name:'下载成果',exact:true}).selectOption(format)
    const download=await pending;assert.ok(download.suggestedFilename().endsWith('.'+format))
    downloads[format]=join(directory,'slides.'+format);await download.saveAs(downloads[format])
  }
  assert.deepEqual(await readFile(downloads.pptx),await readFile(slides.exports[0].path))
  assert.equal(await readFile(downloads.html,'utf8'),original.html)
  assert.ok((await readFile(downloads.md,'utf8')).includes(slides.content.slides[7].notes))
  const inspected=JSON.parse(execFileSync(process.env.DSH_OFFICE_PYTHON,['-I','-X','utf8','-c',
    'import json,sys; from pptx import Presentation; from pypdf import PdfReader; p=Presentation(sys.argv[1]); r=PdfReader(sys.argv[2]); assert len(p.slides)==8 and len(r.pages)==8; assert all(abs(float(page.mediabox.width)/float(page.mediabox.height)-16/9)<.01 for page in r.pages); text="\\n".join(page.extract_text() for page in r.pages); assert "三个渠道承接不同需求" in text and "把发现落实为持续改进" in text; assert "讲稿" not in text and "参考来源" not in text; print(json.dumps({"slides":len(p.slides),"pdfPages":len(r.pages),"chineseText":True}))',downloads.pptx,downloads.pdf],{encoding:'utf8',windowsHide:true}))
  await page.setViewportSize({width:780,height:960});await expect(preview.locator('.slide')).toHaveCount(1)
  await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-page','3')
  await page.screenshot({path:join(directory,'narrow-pptx.png')})
  const officeFiles=[]
  for(const format of ['docx','xlsx']) {
    await page.setViewportSize({width:1440,height:960})
    await page.getByRole('button',{name:'返回 Studio',exact:true}).click()
    const artifact=host.fixture.artifacts.find(artifact=>artifact.id==='synthetic-'+format)
    await page.locator(`[data-studio-artifact-id="${artifact.id}"]`).click()
    // Reading mode belongs to the conversation; explicitly return to its
    // sidebar before testing this artifact's expand action.
    await entry.exitFullscreen()
    const actual=await renderOfficePreview(artifact.exports[0].path)
    await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-source-hash',actual.description.sourceHash)
    await expect(preview.locator('body')).toContainText(format==='docx'?'DOCX 文件中的正文':'XLSX 文件中的单元格')
    await expect(preview.locator('body')).not.toContainText('此内存')
    await expect(page.locator('[data-studio-sources]')).toHaveCount(0)
    await page.getByRole('button',{name:'原始尺寸 100%',exact:true}).click()
    await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-scale','1')
    await page.screenshot({path:join(directory,'sidebar-'+format+'.png')})
    await entry.fullscreen()

    await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-scale','1')
    await page.getByRole('button',{name:'放大',exact:true}).click()
    await expect(page.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-scale','1.2')
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载 '+format.toUpperCase(),exact:true}).click()
    const destination=join(directory,'actual.'+format);await (await pending).saveAs(destination)
    assert.deepEqual(await readFile(destination),await readFile(artifact.exports[0].path))
    await page.screenshot({path:join(directory,'reading-'+format+'.png')})
    officeFiles.push({format,sourceHash:actual.description.sourceHash,actualBytes:true,sidecarRequired:false,expanded:true,zoom:1.2,noSources:true})
  }
  await page.getByRole('button',{name:'返回 Studio',exact:true}).click();await page.getByText(draft.title,{exact:true}).last().click()
  await expect(page.locator('[data-studio-artifact]')).toContainText('生成未完成')
  assert.equal(await page.getByRole('button',{name:'下载 DOCX',exact:true}).count(),0)
  await page.locator('[data-studio-draft] summary').click();await expect(page.locator('[data-studio-draft]')).toContainText('预览前 10000 字符')
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'下载完整草稿',exact:true}).click()
  const downloaded=await pending;await downloaded.saveAs(join(directory,'draft.txt'));assert.equal(await readFile(join(directory,'draft.txt'),'utf8'),draft.draft.text)
  await page.screenshot({path:join(directory,'failed-draft.png')});assert.deepEqual(errors,[])
  assert.equal(await page.getByRole('button',{name:'重试导出',exact:true}).count(),0,'unvalidated draft has no export recovery action')
  const recovery=host.fixture.artifacts.find(artifact=>artifact.id==='synthetic-export-recovery')
  await page.getByRole('button',{name:'返回 Studio',exact:true}).click()
  await page.locator(`[data-studio-artifact-id="${recovery.id}"]`).click()
  await expect(page.getByRole('button',{name:'重试导出',exact:true})).toBeVisible()
  assert.equal(await page.getByRole('button',{name:'下载 PPTX',exact:true}).count(),0)
  await page.locator('[data-studio-artifact]').getByRole('button',{name:'更多操作',exact:true}).click();await expect(page.getByRole('button',{name:'重新生成',exact:true})).toBeVisible()
  await page.screenshot({path:join(directory,'retry-export-before.png')})
  await page.getByRole('button',{name:'重试导出',exact:true}).click()
  await expect(page.getByRole('button',{name:'下载 PPTX',exact:true})).toBeVisible({timeout:30000})
  await expect(preview.locator('.slide')).toHaveCount(1)
  const recoveryDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载 PPTX',exact:true}).click()
  await (await recoveryDownload).saveAs(join(directory,'recovered.pptx'))
  const stored=JSON.parse(await readFile(join(host.home,'plugins','dsh-knowledge-studio','artifacts.json'),'utf8')).artifacts.find(artifact=>artifact.id===recovery.id)
  assert.equal(stored.status,'completed');assert.deepEqual(stored.content,recovery.content);assert.deepEqual(stored.citations,recovery.citations);assert.deepEqual(stored.generation,recovery.generation)
  assert.equal(stored.exportState.phase,'complete');assert.equal(stored.exportState.recoveredFromLegacy,true)
  await page.getByRole('spinbutton',{name:'当前页码'}).fill('4');await page.getByRole('spinbutton',{name:'当前页码'}).press('Tab')
  await expect(preview.locator('.slide')).toContainText('75% → 85%');await expect(preview.locator('.slide')).toContainText('3.6 → 4.1')
  await page.screenshot({path:join(directory,'retry-export-after.png')})
  await writeFile(join(directory,'recovery.json'),JSON.stringify({passed:true,id:stored.id,contentUnchanged:true,citationsUnchanged:true,generationUnchanged:true,externalModelCalls:false,exportState:stored.exportState},null,2))
  assert.deepEqual(errors,[])
  const dsh=JSON.parse(await readFile(resolve(process.env.STUDIO_TEST_DSH_RUNTIME||'.','node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version
  const result={passed:true,dsh,externalModelCalls:false,errors,downloads,inspected,officeFiles,description:original.description,checks:['real persisted PPTX drives shared Studio viewer, HTML and PDF','all eight pages preserve actual converted slide markup','page and manual zoom survive expanded reading','complete notes and collapsed references','reading and narrow views','actual UI downloads independently parsed','failed draft cannot download completed DOCX or retry export','full untruncated draft download','explicit retry-export UI recovers same artifact and real PPTX without changing content/citations/generation']}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
} catch(error) {if(page){await writeFile(join(directory,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(directory,'failure.png')})}throw error}
finally {await browser?.close();await host.stop()}
