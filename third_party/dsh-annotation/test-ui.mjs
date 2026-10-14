import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
assert.ok(process.argv[2] && process.argv[3], 'Usage: node test-ui.mjs ORIGINAL PATCHED [PLAYWRIGHT_PACKAGE_JSON]');
const req=createRequire(resolve(process.argv[4] || 'package.json'));
const directories = [resolve(process.argv[2]), resolve(process.argv[3])];
const {chromium}=req('playwright-core');
const browser=await chromium.launch({...(process.env.ANNOTATION_TEST_BROWSER ? {executablePath:process.env.ANNOTATION_TEST_BROWSER} : {}),headless:true});
const results=[];
try {
 for(const variant of ['package','ui-fix']) {
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  await page.setContent('<style>body{font:16px sans-serif} #reply{margin:120px 300px;width:330px} .bubble{white-space:pre-wrap}</style><div data-chat-flow-kind="assistant-step" id="reply">A selected passage that wraps over several lines to exercise the selection focus.</div>');
  await page.evaluate(()=>{window.__ModuleLoader__={load({factory}){window.plugin=factory()}}});
  await page.addScriptTag({content:readFileSync(join(directories[variant === 'package' ? 0 : 1],'client.js'),'utf8')});
  await page.addStyleTag({content:'.dsh-ann-bar { animation: none !important; transition: none !important; }'});
  await page.evaluate(()=>{
   const source={getSnapshot:()=>({current:'fixture',byId:{}}),subscribe:()=>()=>{}};
   window.dispose=window.plugin.apply({sessions:{list:source,scope:()=>undefined},get:()=>null});
   const node=document.querySelector('#reply').firstChild;
   window.getSelection().setBaseAndExtent(node,0,node,node.length);
  });
  await page.waitForSelector('.dsh-ann-bar');
  const position=await page.evaluate(()=>{
   const s=getSelection(),r=document.createRange();r.setStart(s.focusNode,s.focusOffset);r.collapse(true);
   const f=r.getBoundingClientRect(),b=document.querySelector('.dsh-ann-bar').getBoundingClientRect();
   return {distanceX:Math.abs((b.left+b.right)/2-f.left),gapY:b.top-f.bottom,withinViewport:b.left>=8&&b.right<=innerWidth-8};
  });
  // Two adjacent render batches deliberately hit the full-history throttle.
  const paints=await page.evaluate(async()=>{
   const content='我批注了以下 1 处内容（编号与原文对应），请针对它们回答我的问题：\n\n1. 原文\n   批注：注释\n\n请用「Annotation 1：…」到「Annotation 1：…」的格式，逐条回应上面每一条批注，最后再回答我的问题。\n\n提问：\n问题';
   function append(id,text){const row=document.createElement('div');row.dataset.chatFlowKind='user';row.id=id;const b=document.createElement('div');b.className='bubble';b.textContent=text;row.append(b);document.body.append(row);return b;}
   append('warm',content);
   await new Promise(r=>setTimeout(r,0));
   const b=append('next',content);
   const first=await new Promise(resolve=>requestAnimationFrame(()=>resolve({text:b.textContent,tag:!!b.querySelector('[data-annotation-bubble-tag]')})));
   const late=append('late','');
   late.appendChild(document.createTextNode(''));
   await new Promise(r=>setTimeout(r,0));
   late.firstChild.nodeValue=content;
   const character=await new Promise(resolve=>requestAnimationFrame(()=>resolve({text:late.textContent,tag:!!late.querySelector('[data-annotation-bubble-tag]')})));
   return {first,character};
  });
  results.push({variant,position,paints});
  if(variant==='ui-fix'){
   assert.ok(position.distanceX<2); assert.ok(position.gapY>=7&&position.gapY<=9); assert.ok(position.withinViewport);
   for(const p of Object.values(paints)){assert.ok(p.tag);assert.ok(!p.text.includes('我批注了'));assert.ok(p.text.startsWith('问题'));}
   const lifecycle=await page.evaluate(()=>{
    const oldDispose=window.dispose;
    const cleanups=[];
    const ctx={sessions:{list:{getSnapshot:()=>({current:'fixture'}),subscribe:()=>()=>{}},scope:()=>undefined},get:()=>null,effect(start){const dispose=start();cleanups.push(dispose);return dispose}};
    window.plugin.apply(ctx);
    oldDispose();
    const replaced=document.querySelectorAll('[data-annotation-for-dsh]').length;
    window.plugin.apply(ctx);
    cleanups[0]();
    const remounted=document.querySelectorAll('[data-annotation-for-dsh]').length;
    cleanups[1]();
    return {replaced,remounted,disposed:document.querySelectorAll('[data-annotation-for-dsh]').length};
   });
   assert.deepEqual(lifecycle,{replaced:1,remounted:1,disposed:0});
   results.at(-1).lifecycle=lifecycle;
  }
  await page.close();
 }
 // JSON output can be redirected to an external acceptance record.
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close()}
