import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {chromium,expect} from '@playwright/test'
import {startIsolatedHost} from './host-process.mjs'
import {studioNavigation} from './host-studio-navigation.mjs'

const directory=resolve(process.env.STUDIO_MINDMAP_UI_OUTPUT||'dist/mindmap-host-ui');await mkdir(directory,{recursive:true})
const host=await startIsolatedHost({syntheticMindmap:true})
let browser,page
try {
 browser=await chromium.launch({headless:true,...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{})})
 page=await browser.newPage({locale:'zh-CN',viewport:{width:1440,height:960},acceptDownloads:true})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto(host.launch)
 const base=new URL(host.launch).origin
 const rpc=async(method,args)=>{const response=await page.request.post(base+'/api/'+method,{headers:{origin:base},data:{type:'client-request',rpcId:'mindmap-ui',method,payload:{args}}});const result=(await response.json()).result;assert.equal(result.ok,true,JSON.stringify(result));return result.value}
 const {title}=await rpc('session/rename',{request:{sessionId:host.fixture.sessionId,title:host.fixture.title}})
 await page.reload()
 await page.getByRole('button',{name:'继续',exact:true}).click();await page.getByRole('button',{name:'稍后配置',exact:true}).click()
 if(!await page.getByText(title,{exact:true}).count())await page.getByText('合成工作区',{exact:true}).first().click()
 await page.getByText(title,{exact:true}).first().click()
 const entry=studioNavigation(page);await entry.open()
 const artifact=host.fixture.artifacts[0]
 const canvas=page.locator('svg[data-mindmap-canvas]'),nodes=canvas.locator('[data-mindmap-node]'),edges=canvas.locator('[data-mindmap-edge]')
 await page.getByText(artifact.title,{exact:true}).last().click()
 await expect(nodes).toHaveCount(17);await expect(edges).toHaveCount(16)
 await page.screenshot({path:join(directory,'sidebar-map.png')})
 await entry.fullscreen()
 await page.getByRole('button',{name:'适应视图',exact:true}).click()
 const initial=Number(await canvas.getAttribute('data-zoom'))
 await page.getByRole('button',{name:'放大导图',exact:true}).click();assert.ok(Number(await canvas.getAttribute('data-zoom'))>initial)
 const box=await canvas.boundingBox(),beforePan=Number(await canvas.getAttribute('data-pan-x'))
 await page.mouse.move(box.x+10,box.y+box.height-15);await page.mouse.down();await page.mouse.move(box.x+75,box.y+box.height-40,{steps:5});await page.mouse.up()
 assert.ok(Math.abs(Number(await canvas.getAttribute('data-pan-x'))-beforePan)>40)
 await page.getByRole('button',{name:'适应视图',exact:true}).click()
 await canvas.locator('[data-node-id="services"]').click()
 await expect(page.locator('[data-mindmap-node-detail]')).toContainText('服务设计')
 await page.getByRole('button',{name:'收起子节点',exact:true}).click();await expect(nodes).toHaveCount(11)
 await page.screenshot({path:join(directory,'collapsed-map.png')})
 const downloads={}
 for(const format of ['md','svg','png']) {
   const event=page.waitForEvent('download')
   await page.locator('[data-export-format="'+format+'"]').click()
   const download=await event;assert.match(download.suggestedFilename(),new RegExp('\\.'+format+'$'))
   downloads[format]=join(directory,'complete.'+format);await download.saveAs(downloads[format])
 }
 const exported=await readFile(downloads.svg,'utf8'),markdown=await readFile(downloads.md,'utf8')
 assert.equal((exported.match(/data-mindmap-node=/g)||[]).length,17);assert.equal((exported.match(/data-mindmap-edge=/g)||[]).length,16)
 assert.match(markdown,/^        - \*\*面向不同使用者/m);assert.match(markdown,/synthetic-notes.md/)
 assert.ok(!/foreignObject|<image|https?:\/\//.test(exported.replace('http://www.w3.org/2000/svg','')))
 const imageReport=JSON.parse(execFileSync(process.env.DSH_OFFICE_PYTHON||'python',['-I','-c',
  'import json,sys,xml.etree.ElementTree as E; from PIL import Image,ImageChops; r=E.parse(sys.argv[1]).getroot(); im=Image.open(sys.argv[2]).convert("RGB"); box=ImageChops.difference(im,Image.new("RGB",im.size,"white")).getbbox(); assert box and box[0]>1 and box[1]>1 and box[2]<im.width-1 and box[3]<im.height-1; assert im.width>=int(r.attrib["width"]) and im.height>=int(r.attrib["height"]); assert len(im.getcolors(im.width*im.height))>20; print(json.dumps({"width":im.width,"height":im.height,"contentBounds":box,"svgNodes":sum("data-mindmap-node" in n.attrib for n in r.iter())}))',downloads.svg,downloads.png],{encoding:'utf8',windowsHide:true}))
 await page.getByRole('button',{name:'展开全部',exact:true}).click();await expect(nodes).toHaveCount(17)
 await canvas.locator('[data-node-id="root"]').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('[data-mindmap-node-detail]')).toContainText('服务设计')
 for(let depth=0;depth<3;depth++)await page.keyboard.press('ArrowRight')
 await expect(page.locator('[data-mindmap-node-detail]')).toContainText('面向不同使用者')
 await page.getByRole('button',{name:'文字大纲',exact:true}).click();await expect(page.locator('[data-mindmap-outline] [data-outline-node]')).toHaveCount(17)
 await page.getByRole('button',{name:'思维导图',exact:true}).click();await expect(nodes).toHaveCount(17)
 await page.screenshot({path:join(directory,'reading-map.png')})
 await page.locator('[data-mindmap-node-detail]').getByRole('button',{name:/synthetic-notes.md/}).click()
 await expect(page.getByText(artifact.citations[0].excerpt,{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'← 返回',exact:true}).click();await expect(page.locator('[data-mindmap-node-detail]')).toContainText('面向不同使用者')
 await entry.click();await entry.click();await expect(page.locator('[data-mindmap-node-detail]')).toContainText('面向不同使用者')
 await page.setViewportSize({width:780,height:960});await expect(nodes).toHaveCount(17);await page.getByRole('button',{name:'适应视图',exact:true}).click()
 await page.screenshot({path:join(directory,'narrow-map.png')})
 await page.getByRole('button',{name:'围绕此节点提问',exact:true}).click()
 const draft=page.locator('[data-composer-input="true"]');await expect(draft).toContainText('服务设计 → 服务渠道 → 线上办理');await expect(draft).toContainText('synthetic-notes.md');assert.ok(!(await draft.textContent()).includes('培训与交接'))
 await entry.open();await page.getByRole('button',{name:'返回 Studio',exact:true}).click()
 await page.getByText(host.fixture.artifacts[1].title,{exact:true}).last().click()
 await expect(nodes).toHaveCount(7);await expect(edges).toHaveCount(6);await page.screenshot({path:join(directory,'legacy-map.png')})
 assert.deepEqual(errors,[])
 const dsh=JSON.parse(await readFile(resolve(process.env.STUDIO_TEST_DSH_RUNTIME||'.','node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version
 const result={passed:true,dsh,externalModelCalls:false,errors,imageReport,downloads,checks:['real Host persisted old node schema','17 real nodes and 16 edges','long Chinese and five levels','pan zoom fit keyboard collapse','collapsed view exports complete MD/SVG/PNG via real Host','independent SVG hierarchy and PNG nonblank/bounds inspection','outline','source and selection return','reopen and narrow reading','selected-node prompt without model submission','seven-node legacy map without regeneration']}
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
} catch(error) {if(page){await writeFile(join(directory,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:join(directory,'failure.png')})}throw error}
finally {await browser?.close();await host.stop()}
