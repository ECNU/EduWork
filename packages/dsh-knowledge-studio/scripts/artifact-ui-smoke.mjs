import {build} from 'esbuild'
import {chromium,expect} from '@playwright/test'
import {resolve} from 'node:path'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
const directory=resolve(process.env.STUDIO_ARTIFACT_UI_OUTPUT||'dist/artifact-ui');await mkdir(directory,{recursive:true})
const result=await build({entryPoints:['test/fixtures/artifact-ui.tsx'],bundle:true,write:false,format:'iife',platform:'browser'})
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'application/javascript':'text/html; charset=utf-8');res.end(req.url==='/app.js'?result.outputFiles[0].text:'<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>')})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const browser=await chromium.launch({...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{}),headless:true})
const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
try{
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await expect(page.locator('[data-studio-media-preview]').getByRole('status')).toContainText('正在载入')
 await page.getByRole('button',{name:'audio',exact:true}).click();await expect(page.locator('audio')).toBeVisible()
 const downloads=page.getByRole('combobox',{name:'下载成果',exact:true})
 await expect(page.locator('[data-studio-primary-actions]').getByRole('combobox',{name:'下载成果',exact:true})).toBeVisible()
 await expect(page.getByRole('button',{name:'更多操作',exact:true})).toHaveAttribute('aria-expanded','false')
 await expect(downloads.locator('option')).toHaveText(['下载…','音频 WAV','音频逐字稿 MD'])
 const url=await page.locator('audio').getAttribute('src');await page.getByRole('button',{name:'完成旧请求'}).click()
 await expect(page.locator('audio')).toHaveAttribute('src',url)
 await page.getByRole('button',{name:'刷新状态'}).click();await expect(page.locator('[data-calls]')).toHaveText('2')
 await expect(page.locator('[data-studio-script]')).not.toHaveAttribute('open','');await expect(page.getByText('隐藏的逐字稿')).not.toBeVisible()
 await page.locator('[data-studio-script] summary').click();await expect(page.getByText('隐藏的逐字稿')).toBeVisible()
 await page.getByRole('button',{name:'failure',exact:true}).click();await expect(page.getByRole('alert')).toContainText('测试加载失败')
 await page.getByRole('button',{name:'重试预览'}).click();await expect(page.locator('audio')).toBeVisible()
 for(const [kind,format] of [['report','DOCX'],['slides','PPTX'],['table','XLSX']]){
  await page.getByRole('button',{name:kind,exact:true}).click();await expect(page.getByRole('button',{name:'下载 '+format})).toBeVisible();await expect(page.frameLocator('[data-office-file-preview]').locator('main')).toBeVisible()
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载 '+format}).click();assert.equal((await download).suggestedFilename(),kind+'.'+format.toLowerCase())
  await expect(page.getByRole('link',{name:'保存 '+format})).toBeVisible()
  await expect(page.locator('[data-studio-sources]')).not.toHaveAttribute('open','');assert.equal(await page.locator(`header [data-studio-icon="${kind}"]`).count(),1)
 }
 assert.equal(await page.frameLocator('[data-office-file-preview]').getByRole('columnheader').count(),1)
 const choices=[
  ['report',['docx','pdf','md'],['报告 DOCX','报告 PDF','报告正文 MD']],
  ['slides',['pptx','pdf','md','html'],['演示文稿 PPTX','幻灯片 PDF','幻灯片文字与讲稿 MD','网页预览 HTML']],
  ['table',['xlsx','csv'],['数据表 XLSX','表格数据 CSV']],
  ['mindmap',['png','svg','md'],['导图图片 PNG','导图矢量图 SVG','思维导图文字大纲 MD']],
  ['quiz',['md','pdf'],['测验题目与答案 MD','测验题目与答案 PDF']],
  ['flashcards',['md','pdf'],['抽认卡正反面 MD','抽认卡正反面 PDF']],
  ['audio-captioned',['wav','md','srt','vtt'],['音频 WAV','音频逐字稿 MD','字幕 SRT','网页字幕 VTT']],
  ['video',['mp4','md','srt','vtt'],['视频 MP4','视频分镜与旁白 MD','字幕 SRT','网页字幕 VTT']],
  ['audio-text',['md'],['音频逐字稿 MD']],
 ]
 for(const [kind,formats,labels] of choices){
  await page.getByRole('button',{name:kind,exact:true}).click();await expect(downloads).toBeVisible()
  assert.deepEqual(await downloads.locator('option').evaluateAll(options=>options.map(option=>option.value)),['',...formats])
  await expect(downloads.locator('option')).toHaveText(['下载…',...labels])
 }
 assert.equal(await page.locator('[data-export-format="wav"]').count(),0)
 await page.getByRole('button',{name:'video',exact:true}).click()
 const subtitleDownload=page.waitForEvent('download');await downloads.selectOption('srt');assert.equal((await subtitleDownload).suggestedFilename(),'video.srt')
 await expect(page.getByRole('link',{name:'保存 SRT',exact:true})).toBeVisible()
 await page.screenshot({path:resolve(directory,'download-menu.png')})
 await page.getByRole('button',{name:'history',exact:true}).click();await expect(page.locator('audio')).toBeVisible()
 const history=page.locator('[data-studio-attempt-history]');await history.locator('summary').click()
 await expect(history.getByText('第 1 版 · 已生成（中间版本）',{exact:true})).toBeVisible();await expect(history).not.toContainText('未完成')
 const previousDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载 音频 WAV',exact:true}).click();assert.equal((await previousDownload).suggestedFilename(),'history-v2.wav')
 const oldDownloadURL=await page.getByRole('link',{name:'保存 WAV',exact:true}).getAttribute('href')
 assert.equal(await page.evaluate(url=>fetch(url).then(response=>response.ok),oldDownloadURL),true)
 await page.getByRole('button',{name:'延迟下次下载',exact:true}).click();await page.getByRole('button',{name:'下载 音频 WAV',exact:true}).click()
 const secondVersion=await page.locator('audio').getAttribute('src')
 await page.getByRole('button',{name:'revised',exact:true}).click();await expect(page.locator('audio')).toBeVisible();await expect(page.locator('audio')).not.toHaveAttribute('src',secondVersion)
 await expect(page.getByRole('link',{name:'保存 WAV',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'下载 音频 WAV',exact:true})).toBeEnabled()
 assert.equal(await page.evaluate(url=>fetch(url).then(()=>false,()=>true),oldDownloadURL),true)
 const staleDownloads=[];const recordStale=download=>staleDownloads.push(download.suggestedFilename());page.on('download',recordStale)
 await page.getByRole('button',{name:'完成旧版下载',exact:true}).click();await page.waitForTimeout(100)
 await expect(page.getByRole('link',{name:'保存 WAV',exact:true})).toHaveCount(0);assert.deepEqual(staleDownloads,[]);page.off('download',recordStale)
 await expect(history.getByText('第 2 版 · 已生成（中间版本）',{exact:true})).toBeVisible()
 const finalVersion=await page.locator('audio').getAttribute('src');assert.equal(await page.locator('[data-studio-revision-warning]').count(),0)
 await page.getByRole('button',{name:'fallback',exact:true}).click()
 await expect(page.locator('[data-studio-revision-warning]')).toHaveText('最后一次修改未完成，显示第 3 版；修改记录已保留')
 await expect(page.locator('audio')).toHaveAttribute('src',finalVersion)
 await expect(history.locator('[data-studio-attempt-version="4"]')).toHaveText('第 4 版 · 生成失败：导出失败')
 await expect(history.locator('[data-studio-attempt-version="6"]')).toHaveText('第 6 版 · 已取消：用户取消')
 await expect(history.locator('[data-studio-attempt-version="7"]')).toHaveText('第 7 版 · 已中断：进程中断')
 await expect(history.getByText('历史尝试 · 生成失败：旧记录未保存版本号',{exact:true})).toBeVisible()
 assert.equal(await history.locator('[data-studio-attempt-version="3"]').count(),0)
 const currentDownload=page.waitForEvent('download');await page.getByRole('button',{name:'下载 音频 WAV',exact:true}).click();assert.equal((await currentDownload).suggestedFilename(),'fallback-v3.wav')
 await page.screenshot({path:resolve(directory,'revision-history.png')})
 assert.deepEqual(errors,[])
 await writeFile(resolve(directory,'result.json'),JSON.stringify({passed:true,productionComponents:true,mockedService:true,checks:['automatic media, stale responses, polling stability, retry and collapse','Office actions and icons','download menu is visible in primary actions; all eight kinds use content-specific labels and explicit format choices','no media or subtitle choice without its actual export; internal poster and JSON never appear; subtitle selection produces a browser download','completed intermediate versions and accurate persisted version numbers','same-ID media revision refreshes preview; fallback warning retains current usable version and download','old prepared download links disappear and their blobs are revoked; late previous-version downloads neither expose a link nor trigger a download','failed, cancelled, interrupted and versionless legacy history remain truthful'],errors},null,2)+'\n')
 console.log('Artifact UI passed: media/Office, same-ID revisions, version history and fallback warning')
}finally{await browser.close();server.close()}
