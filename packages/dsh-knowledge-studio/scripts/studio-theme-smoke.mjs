import {build} from 'esbuild'
import {chromium} from '@playwright/test'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
// Supply real host CSS/token sources rather than inventing a parallel palette.
assert.ok(process.env.STUDIO_THEME_CSS&&process.env.STUDIO_THEME_MODULE,'Set actual DSH CSS and host branding module paths')
const css=await readFile(process.env.STUDIO_THEME_CSS,'utf8')
const {COLOR_SCHEME_TOKENS}=await import(pathToFileURL(resolve(process.env.STUDIO_THEME_MODULE)))
assert.deepEqual(Object.keys(COLOR_SCHEME_TOKENS).sort(),['blue','red'])
const overrideKeys=[...new Set(Object.values(COLOR_SCHEME_TOKENS).flatMap(tokens=>Object.keys(tokens||{})))]
const out=resolve(process.env.STUDIO_THEME_OUTPUT||'dist/studio-theme');await mkdir(out,{recursive:true})
const bundle=await build({entryPoints:['test/fixtures/studio-theme.tsx'],bundle:true,write:false,format:'iife',platform:'browser'})
const browser=await chromium.launch({headless:true,...(process.env.STUDIO_TEST_BROWSER?{executablePath:process.env.STUDIO_TEST_BROWSER}:{})})
const page=await browser.newPage({viewport:{width:1300,height:900}}),errors=[],rows=[]
page.on('pageerror',e=>errors.push(e.message))
try{
 await page.setContent('<style>'+css+'</style><div id="root"></div><div id="expanded"></div>')
 await page.addScriptTag({content:bundle.outputFiles[0].text})
 await page.locator('[data-studio-artifact]').waitFor()
 for(const mode of ['light','dark'])for(const theme of ['blue','red','blue']){
  await page.evaluate(({tokens,keys,mode})=>{
   document.body.toggleAttribute('data-ds-dark-theme',mode==='dark')
   for(const key of keys)document.body.style.removeProperty(key)
   for(const [key,value]of Object.entries(tokens||{}))document.body.style.setProperty(key,value[mode])
  },{tokens:COLOR_SCHEME_TOKENS[theme],keys:overrideKeys,mode})
  const row=await page.evaluate(()=>{
   const root=getComputedStyle(document.body),selectors={home:'[data-knowledge-studio-details]',card:'[data-knowledge-studio-capability]',detail:'[data-studio-artifact]',download:'[data-export-format="png"]',reading:'[data-studio-reading-actions] button',warning:'[data-studio-revision-warning]',icon:'[data-knowledge-studio-capability] svg',map:'[data-mindmap-node] rect',mapText:'[data-mindmap-node] text'}
   const expected={home:['backgroundColor','--dsw-alias-bg-base'],card:['backgroundColor','--dsw-alias-bg-layer-2'],detail:['color','--dsw-alias-label-primary'],download:['backgroundColor','--dsw-alias-state-business-primary'],reading:['borderTopColor','--dsw-alias-border-l2'],warning:['color','--dsw-alias-state-warn-label'],icon:['color','--dsw-alias-state-business-primary'],map:['fill','--dsw-alias-state-business-primary'],mapText:['fill','--dsw-alias-label-primary-inverted']}
   return Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{const node=document.querySelector(selector),style=getComputedStyle(node);const [property,token]=expected[name];const probe=document.createElement('span');probe.style.color=`var(${token})`;document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return [name,{actual:style[property],expected:color,tokenPresent:!!root.getPropertyValue(token).trim()}]}))
  })
  for(const [name,value]of Object.entries(row)){assert.equal(value.tokenPresent,true,name);assert.equal(value.actual,value.expected,name)}
  rows.push({mode,theme,checks:row})
  if(mode==='light')await page.screenshot({path:resolve(out,theme+'-sidebar.png')})
 }
 await page.getByRole('button',{name:'展开阅读',exact:true}).first().click()
 assert.equal(await page.locator('#expanded [data-studio-artifact]').count(),1)
 await page.evaluate(tokens=>{for(const [key,value]of Object.entries(tokens))document.body.style.setProperty(key,value.dark)},COLOR_SCHEME_TOKENS.red)
 assert.equal(await page.locator('#expanded [data-studio-artifact]').evaluate(n=>getComputedStyle(n).backgroundColor),await page.locator('[data-knowledge-studio-details]').evaluate(n=>getComputedStyle(n).backgroundColor))
 await page.screenshot({path:resolve(out,'expanded.png'),fullPage:true})
 assert.deepEqual(errors,[])
 await writeFile(resolve(out,'result.json'),JSON.stringify({passed:true,rows,portalMoved:true,interactiveMapFollowsTheme:true,errors,scope:'Actual React components using supplied host token files, not a running DSH host'},null,2))
}finally{await browser.close()}
