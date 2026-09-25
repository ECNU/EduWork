// Isolated component + real importer acceptance. Does not open a user profile.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { DataImporter } from '../lib/data-import.js'
import { loadImportFormats } from '../lib/import-inspection.js'

const root=fileURLToPath(new URL('../../..',import.meta.url)),runtime=process.env.EDUWORK_TEST_RUNTIME
assert.ok(runtime,'Set EDUWORK_TEST_RUNTIME to the installed product/d directory')
const req=createRequire(join(runtime,'package.json')),load=name=>import(pathToFileURL(req.resolve(name)))
const ts=createRequire(join(process.env.EDUWORK_TEST_BUILD_TOOLS || join(root,'.cache/client-build-tools'),'package.json'))('typescript')
const {chromium}=req('playwright-core')
const [{Context},{default:Jsonl},{sessionFormatCatalog:formats}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-session-persistence-jsonl'),load('@deepseek-ai/dsh-session-format-catalog')])
const hook=registerHooks({resolve(name,ctx,next){return next(name,name==='zod'?{...ctx,parentURL:pathToFileURL(join(runtime,'package.json')).href}:ctx)}})
const {descriptors}=await import('../lib/typert-schemas.js');hook.deregister()
const validate=(method,value)=>descriptors.find(d=>d.method===method).result.schema.parse(value)
const temp=await mkdtemp(join(tmpdir(),'eduwork-import-browser-')),source=join(temp,'old'),home=join(temp,'new')
await mkdir(home);await mkdir(join(source,'workspace'),{recursive:true})
const openStore=async(root,compression='zstd')=>{const ctx=new Context();await ctx.plugin(Jsonl,{root,compression});return {persistence:ctx.sessionPersistence,close:()=>ctx.fiber.dispose()}}
const dest=await openStore(join(home,'sessions')),src=await openStore(join(source,'data/dsh/sessions'))
await src.close()
const old=join(source,'data/dsh/sessions/project/session-browser');await mkdir(old,{recursive:true})
await writeFile(join(old,'session.v3.jsonl'),[
 {type:'session',version:3,id:'session-browser',createdAt:100,cwd:join(source,'workspace'),isSeeded:false,delegationDepth:0,agentPreset:'standard'},
 {seq:0,type:'session/title',time:100,data:{title:'浏览器导入测试',source:{kind:'user'},messageSeqs:[]}},
].map(row=>JSON.stringify(row)).join('\n')+'\n')
const futureVersion=formats.currentVersion+1
const future=join(source,'data/dsh/sessions/project/session-future');await mkdir(future,{recursive:true});await writeFile(join(future,`session.v${futureVersion}.jsonl`),JSON.stringify({type:'session',version:futureVersion,id:'session-future'})+'\n')
const importer=new DataImporter({home,persistence:dest.persistence,openStore,loadFormats:()=>loadImportFormats(load)})
const component=ts.transpileModule(await readFile(new URL('../src/data-import.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/import React, \{ useEffect, useState \} from ['"]react['"];?/,'const {useEffect,useState}=React;')
assert.doesNotMatch(component,/from ['"]react/)
let previewCalls=0,importCalls=0
const server=createServer(async(request,response)=>{
 try {
  if(request.url==='/react.js'||request.url==='/react-dom.js') {
   response.setHeader('content-type','text/javascript');response.end(await readFile(join(runtime,'node_modules',request.url==='/react.js'?'react/umd/react.development.js':'react-dom/umd/react-dom.development.js')));return
  }
  if(request.url==='/component.js'){response.setHeader('content-type','text/javascript');response.end(component);return}
  if(request.url?.startsWith('/api/')) {
   const name=request.url.slice(5);let result
   if(name==='status')result=validate('importStatus',importer.status())
   else if(name==='preview'){previewCalls++;result=validate('inspectImport',importer.preview(source))}
   else if(name==='start'){importCalls++;result=validate('importData',importer.start(importer.status().id))}
   else if(name==='cancel')result=validate('cancelImport',await importer.cancel())
   else throw Error('Unknown action')
   response.setHeader('content-type','application/json');response.end(JSON.stringify(result));return
  }
  response.setHeader('content-type','text/html');response.end(`<html><meta charset="utf-8"><body style="font:14px system-ui;margin:40px;max-width:720px;background:#faf9f6"><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">import {DataImportPanel} from '/component.js';const call=async action=>{const r=await fetch('/api/'+action,{method:'POST'});if(!r.ok)throw Error(await r.text());return r.json()};ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(DataImportPanel,{service:{pickDirectory:async()=>true,preview:()=>call('preview'),start:()=>call('start'),cancel:()=>call('cancel'),status:()=>call('status')}}));</script></body></html>`)
 }catch(error){response.statusCode=500;response.end(error.message)}
})
await new Promise(ok=>server.listen(0,'127.0.0.1',ok))
let browser
try {
 browser=await chromium.launch({channel:'msedge',headless:true})
 const page=await browser.newPage({viewport:{width:1000,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 await page.getByRole('button',{name:'选择旧客户端目录并检查'}).click()
 await page.getByRole('button',{name:'导入 1 个可读会话'}).waitFor()
 assert.equal((await dest.persistence.list()).length,0)
 assert.match(await page.locator('body').innerText(),/无法导入（1 项）/)
 assert.match(await page.locator('body').innerText(),/更新客户端后重试/)
 const evidence=resolve(process.env.EDUWORK_TEST_EVIDENCE||join(root,'dist/import-vision-20260912'));await mkdir(evidence,{recursive:true})
 await page.screenshot({path:join(evidence,'import-preflight.png'),fullPage:true})
 await page.getByRole('button',{name:'导入 1 个可读会话'}).click()
 await page.getByText(/导入结束（有未导入项）/).waitFor()
 assert.equal((await dest.persistence.list()).length,1)
 await page.screenshot({path:join(evidence,'import-complete.png'),fullPage:true})
 assert.deepEqual(errors,[]);assert.equal(previewCalls,1);assert.equal(importCalls,1)
 await writeFile(join(evidence,'browser.json'),JSON.stringify({passed:true,previewBeforeMerge:true,visibleExclusions:true,strictRemoteSchemas:true,errors},null,2))
 console.log('Import browser acceptance passed')
} finally {await browser?.close();await importer.running;await importer.cleanup();await dest.close();await new Promise(ok=>server.close(ok));await rm(temp,{recursive:true,force:true})}
