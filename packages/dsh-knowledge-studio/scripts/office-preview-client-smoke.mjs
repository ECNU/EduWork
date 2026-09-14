import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium,expect} from '@playwright/test'
import {build} from 'esbuild'

const directory=resolve(process.env.STUDIO_OFFICE_CLIENT_OUTPUT||'dist/office-preview-client');await mkdir(directory,{recursive:true})
const source=await readFile('packages/artifact-services/lib/office-preview-client.js','utf8')
const bundle=await build({entryPoints:['packages/artifact-services/lib/office-preview-client.js'],bundle:true,write:false,format:'esm',platform:'browser',metafile:true})
assert.deepEqual(Object.keys(bundle.metafile.inputs),['packages/artifact-services/lib/office-preview-client.js'],'browser entry has no runtime/framework dependencies')
const slide=index=>`<section class="slide-wrap" data-slide-index="${index}"><p class="slide-label">第 ${index} 页</p><div class="slide"><div class="shape" style="left:60px;top:70px;width:300px;font:30px/1.2 serif;white-space:pre-wrap">中文换行保持不变，75%→85%。第 ${index} 页。\n第二行保持固定。</div><svg width="80" height="80" style="position:absolute;left:700px;top:400px"><circle cx="40" cy="40" r="35" fill="#895246"/></svg></div></section>`
const preview={html:`<!doctype html><html><head><style>body{padding:18px}.slide-wrap{width:min(100%,1040px)}.slide{width:960px;height:720px;position:relative;background:#fff9ed}.shape{position:absolute}</style></head><body><div data-office-warning data-office-warning-code="example">转换缺失在页面外</div><main class="slides" data-slide-width="960" data-slide-height="720" data-slide-count="3">${[1,2,3].map(slide).join('')}</main><script>parent.UNSAFE=true</script><img src="https://invalid.example/forbidden.png"></body></html>`,description:{schemaVersion:1,kind:'slides',sourceHash:'synthetic-shared-content',rendererVersion:'test-fixed-page-v1',fontFingerprint:'test-fonts',cacheKey:'synthetic-shared-content-v1',pageCount:3,pageWidth:960,pageHeight:720,warnings:[{code:'example',message:'转换缺失在页面外'}]}}
const pageHTML=`<!doctype html><meta charset="utf-8"><style>body{margin:12px;background:#e5e7eb}main{display:flex;gap:20px}#one{width:420px;height:650px}#two{width:840px;height:650px}</style><main><div id="one"></div><div id="two"></div></main><script type="module">import {mountOfficePreview as first} from '/viewer.js?one';import {mountOfficePreview as second} from '/viewer.js?two';window.preview=${JSON.stringify(preview).replaceAll('<',String.fromCharCode(92)+'u003c')};window.first=first;window.second=second;window.one=first(document.querySelector('#one'),{preview,title:'Studio 入口',onExpand:()=>window.expanded=true});window.two=second(document.querySelector('#two'),{preview,title:'对话入口'});window.ready=true;</script>`
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url.startsWith('/viewer.js')?'application/javascript':'text/html; charset=utf-8');res.end(req.url.startsWith('/viewer.js')?source:pageHTML)})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const browser=await chromium.launch({headless:true,...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{})})
const errors=[],externalRequests=[]
let page
try {
  page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:'))externalRequests.push(r.url())})
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.ready)
  const one=page.locator('#one'),two=page.locator('#two'),firstFrame=one.frameLocator('[data-office-file-preview]'),secondFrame=two.frameLocator('[data-office-file-preview]')
  await expect(firstFrame.locator('.slide')).toHaveCount(1);await expect(firstFrame.locator('.shape')).toContainText('第 1 页')
  const pageColor=await firstFrame.locator('.slide').evaluate(node=>getComputedStyle(node).backgroundColor)
  for(const accent of ['#3777ba','#b43d4d'])for(const dark of [false,true]){
    await page.evaluate(({accent,dark})=>{
      const style=document.documentElement.style
      for(const [key,value]of Object.entries({'--dsw-alias-state-business-primary':accent,'--dsw-alias-bg-base':dark?'#202124':'#ffffff','--dsw-alias-label-primary':dark?'#e8eaed':'#27303b'}))style.setProperty(key,value)
    },{accent,dark})
    assert.equal(await one.locator('.toolbar').evaluate(node=>getComputedStyle(node).backgroundColor),dark?'rgb(32, 33, 36)':'rgb(255, 255, 255)')
    assert.equal(await one.locator('.toolbar').evaluate(node=>getComputedStyle(node).color),dark?'rgb(232, 234, 237)':'rgb(39, 48, 59)')
    assert.equal(await firstFrame.locator('.slide').evaluate(node=>getComputedStyle(node).backgroundColor),pageColor,'Host theme must not recolor generated document bytes')
  }
  await page.evaluate(()=>document.documentElement.removeAttribute('style'))
  assert.equal(await one.locator('iframe').getAttribute('sandbox'),'')
  assert.equal(await page.evaluate(()=>window.UNSAFE),undefined)
  await expect(one.getByText('转换缺失在页面外',{exact:true})).toBeVisible();await expect(firstFrame.locator('[data-office-warning]')).toHaveCount(0)
  async function metrics(frame) {return frame.locator('.shape').evaluate(shape=>{const style=getComputedStyle(shape),rect=shape.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(shape);return {width:rect.width,height:rect.height,font:style.fontSize,lineHeight:style.lineHeight,text:shape.textContent,rects:[...range.getClientRects()].map(r=>[r.x,r.y,r.width,r.height]),viewport:innerWidth}})}
  const initial=await metrics(firstFrame)
  await one.getByRole('button',{name:'下一页',exact:true}).click();await expect(secondFrame.locator('.shape')).toContainText('第 2 页')
  await one.getByRole('button',{name:'原始尺寸 100%',exact:true}).click()
  await expect(two.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-mode','manual')
  assert.equal((await page.evaluate(()=>window.two.getState())).scale,1)
  const before=await metrics(firstFrame)
  await page.evaluate(()=>document.querySelector('#one').style.width='280px')
  await expect(one.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-scale','1')
  assert.deepEqual(await metrics(firstFrame),before,'manual scale never changes iframe coordinate system or text wrapping')
  await one.getByRole('combobox',{name:'页面缩放模式'}).selectOption('fit-width')
  await expect(two.locator('[data-office-preview-viewer]')).toHaveAttribute('data-office-mode','fit-width')
  await expect.poll(async()=>Number(await two.locator('[data-office-preview-viewer]').getAttribute('data-office-scale'))).toBeGreaterThan(Number(await one.locator('[data-office-preview-viewer]').getAttribute('data-office-scale')))
  assert.deepEqual(await metrics(firstFrame),await metrics(secondFrame),'different widths keep identical inner layout')
  await one.getByRole('button',{name:'放大',exact:true}).click()
  const shared=await page.evaluate(()=>({one:window.one.getState(),two:window.two.getState()}));assert.deepEqual(shared.one,shared.two)
  await one.getByRole('button',{name:'展开阅读',exact:true}).click();assert.equal(await page.evaluate(()=>window.expanded),true)
  await page.screenshot({path:join(directory,'two-entries.png')})
  await page.evaluate(()=>{window.one.destroy();window.one=window.first(document.querySelector('#one'),{preview:window.preview,title:'重新打开'})})
  assert.deepEqual(await page.evaluate(()=>window.one.getState()),shared.one)
  await page.reload();await page.waitForFunction(()=>window.ready);assert.deepEqual(await page.evaluate(()=>window.two.getState()),shared.two)
  await page.evaluate(()=>{window.one.update({preview:{...window.preview,description:{...window.preview.description,sourceHash:'changed-bytes',cacheKey:'new-file-version'}}})})
  await expect(firstFrame.locator('.shape')).toContainText('第 1 页');assert.equal((await page.evaluate(()=>window.one.getState())).mode,'fit-page')
  assert.equal((await page.evaluate(()=>window.two.getState())).page,2)
  await page.evaluate(()=>window.one.update({preview:{...window.preview,description:{...window.preview.description,pageCount:999}}}))
  await expect(one.getByRole('alert')).toContainText('预览描述与实际文件页面不一致')
  await page.evaluate(()=>window.one.update({preview:window.preview}));await expect(firstFrame.locator('.slide')).toHaveCount(1)
  await page.evaluate(()=>window.one.update({preview:{...window.preview,html:window.preview.html.replace('data-slide-count="3"','data-slide-count="120"'),description:{...window.preview.description,pageCount:120,cacheKey:'explicit-page-limit',warnings:[{code:'page-limit',message:'此文件 120 页，本次仅预览前 3 页'}]}}}))
  await expect(one.getByText('/ 3（文件共 120 页）',{exact:true})).toBeVisible()
  await expect(one.getByText('此文件 120 页，本次仅预览前 3 页',{exact:true})).toBeVisible()
  await one.getByRole('spinbutton',{name:'当前页码'}).fill('3');await one.getByRole('spinbutton',{name:'当前页码'}).press('Tab')
  await expect(one.getByRole('button',{name:'下一页',exact:true})).toBeDisabled()
  await page.evaluate(()=>window.one.update({preview:{html:'<!doctype html><p>已有 Word HTML</p>'}}));await expect(firstFrame.locator('p')).toHaveText('已有 Word HTML')
  await one.getByRole('button',{name:'原始尺寸 100%',exact:true}).click();assert.equal((await page.evaluate(()=>window.one.getState())).scale,1)
  await one.getByRole('button',{name:'放大',exact:true}).click();assert.equal((await page.evaluate(()=>window.one.getState())).scale,1.2)
  await expect(one.getByRole('spinbutton',{name:'当前页码'})).toBeHidden()
  await expect(one.getByRole('button',{name:'下一页',exact:true})).toBeHidden()
  await page.evaluate(()=>{
    const document={html:'<!doctype html><p>共享 DOCX/XLSX 文件正文</p>',description:{schemaVersion:1,kind:'document',sourceHash:'document-bytes',cacheKey:'same-document',rendererVersion:'fixture',fontFingerprint:'fixture',pageCount:null,pageWidth:null,pageHeight:null,warnings:[]}}
    window.one.update({preview:document});window.two.update({preview:document})
  })
  await one.getByRole('button',{name:'原始尺寸 100%',exact:true}).click()
  await one.getByRole('button',{name:'放大',exact:true}).click()
  assert.equal((await page.evaluate(()=>window.two.getState())).scale,1.2,'continuous document zoom shares the same file identity across entry points')
  await expect(secondFrame.locator('p')).toHaveText('共享 DOCX/XLSX 文件正文')
  assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[])
  const result={passed:true,externalModelCalls:false,errors,externalRequests,browserBytes:Buffer.byteLength(source),initial,shared,checks:['two independent module instances share only file reading state','fixed 4:3 page, no reflow in narrow/manual/fit modes','single-page navigation','refresh and reopen retain page and manual zoom','new file hash resets reading state','sandbox and no external resources','warnings outside page','declared page limit keeps available pages readable and reports total','invalid descriptor fails visibly','legacy non-slide HTML remains readable']}
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
} catch(error) {await writeFile(join(directory,'failure.json'),JSON.stringify({errors,externalRequests,error:String(error)},null,2));await page?.screenshot({path:join(directory,'failure.png')});throw error}
finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
