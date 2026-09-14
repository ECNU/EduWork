// Synthetic settings store + actual shared React component, no user profile.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as concurrency from '../../request-concurrency/lib/index.js'

const runtime=process.env.EDUWORK_TEST_RUNTIME,buildTools=process.env.EDUWORK_TEST_BUILD_TOOLS
assert.ok(runtime && buildTools,'Set EDUWORK_TEST_RUNTIME and EDUWORK_TEST_BUILD_TOOLS to the pinned runtime/compiler directories')
const req=createRequire(join(runtime,'package.json')),load=name=>import(pathToFileURL(req.resolve(name)))
const ts=createRequire(join(buildTools,'package.json'))('typescript'),{chromium}=req('playwright-core')
const [{Context},{default:Settings},{default:Llm}]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-settings'),load('@deepseek-ai/dsh-llm')])
let stored={'eduwork-concurrency':{maxParallelSubagents:2}}
class MemorySettings extends Settings {
 writable=true
 async load(){return stored}
 async persist(ns,section){stored={...stored,[ns]:section};this.publish(stored)}
}
const ctx=new Context();new Llm(ctx);await ctx.plugin(MemorySettings)
const hook=registerHooks({resolve(name,context,next){return next(name,name==='@deepseek-ai/schemastery'?{...context,parentURL:pathToFileURL(join(runtime,'package.json')).href}:context)}})
try{await ctx.plugin(concurrency)}finally{hook.deregister()}
const component=ts.transpileModule(await readFile(new URL('../src/concurrency.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
 .replace(/import React, \{([^}]+)\} from ['"]react['"];?/, 'const {$1}=React;')
assert.doesNotMatch(component,/from ['"]react/)
const server=createServer(async(request,response)=>{
 try {
  if(request.url==='/react.js'||request.url==='/react-dom.js'){
   response.setHeader('content-type','text/javascript');response.end(await readFile(join(runtime,'node_modules',request.url==='/react.js'?'react/umd/react.development.js':'react-dom/umd/react-dom.development.js')));return
  }
  if(request.url==='/component.js'){response.setHeader('content-type','text/javascript');response.end(component);return}
  if(request.url==='/api/settings'){
   if(request.method==='POST'){
    let body='';for await(const chunk of request)body+=chunk
    await ctx.settings.update(concurrency.SETTINGS_NAMESPACE,JSON.parse(body))
   }
   response.setHeader('content-type','application/json');response.end(JSON.stringify(ctx.settings.get(concurrency.SETTINGS_NAMESPACE)));return
  }
  response.setHeader('content-type','text/html');response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:14px system-ui;margin:32px;background:#faf7f5;color:#302a27;max-width:720px}button:disabled{opacity:.45}</style><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">
   import {ConcurrencySettings} from '/component.js';
   const listeners=new Set();let snapshot={status:'loading'};
   const update=value=>{snapshot={status:'ready',value};listeners.forEach(fn=>fn())};
   const scope={getSnapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},set:async(key,value)=>{const r=await fetch('/api/settings',{method:'POST',body:JSON.stringify({[key]:value})});if(!r.ok)throw Error(await r.text());update(await r.json())}};
   ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ConcurrencySettings,{scope}));
   update(await(await fetch('/api/settings')).json());
  </script></html>`)
 }catch(error){response.statusCode=500;response.end(error.message)}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
let browser
try {
 browser=await chromium.launch({channel:'msedge',headless:true})
 const page=await browser.newPage({viewport:{width:820,height:310}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.goto(`http://127.0.0.1:${server.address().port}`)
 const input=page.getByRole('spinbutton',{name:'模型请求总并发'}),save=page.getByRole('button',{name:'保存',exact:true})
 await page.getByText('当前客户端的主会话和子代理共用上限，同时最多 3 个模型请求。').waitFor()
 assert.equal(await input.inputValue(),'3')
 assert.equal(await page.getByRole('spinbutton').count(),1)
 await input.fill('2');await save.click()
 await page.getByText('当前客户端的主会话和子代理共用上限，同时最多 2 个模型请求。').waitFor()
 assert.equal(stored['eduwork-concurrency'].maxConcurrentRequests,2)
 assert.equal(stored['eduwork-concurrency'].maxParallelSubagents,undefined)
 await page.reload();await page.getByText('当前客户端的主会话和子代理共用上限，同时最多 2 个模型请求。').waitFor()
 assert.equal(await input.inputValue(),'2')
 await input.fill('0');assert.equal(await save.isDisabled(),true)
 await input.fill('1');await save.click();await page.getByText('当前客户端的主会话和子代理共用上限，同时最多 1 个模型请求。').waitFor()
 assert.equal(stored['eduwork-concurrency'].maxConcurrentRequests,1)
 assert.deepEqual(errors,[])
 if(process.env.EDUWORK_TEST_EVIDENCE){const output=resolve(process.env.EDUWORK_TEST_EVIDENCE);await mkdir(output,{recursive:true});await page.screenshot({path:join(output,'concurrency-settings.png'),fullPage:true})}
 console.log('Concurrency UI passed: legacy 2 → displayed total 3; save 2/1; reload persistence; invalid input rejected; one control; no browser errors.')
} finally {
 await browser?.close();await new Promise(resolve=>server.close(resolve));await ctx.fiber.dispose()
}
