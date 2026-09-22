import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const runtime = process.env.EDUWORK_TEST_RUNTIME, buildTools = process.env.EDUWORK_TEST_BUILD_TOOLS, evidence = process.env.EDUWORK_TEST_EVIDENCE
assert.ok(runtime && buildTools && evidence, 'Set EDUWORK_TEST_RUNTIME, EDUWORK_TEST_BUILD_TOOLS and EDUWORK_TEST_EVIDENCE')
const req = createRequire(join(runtime, 'package.json')), ts = createRequire(join(buildTools, 'package.json'))('typescript'), { chromium } = req('playwright-core')
const component = ts.transpileModule(await readFile(new URL('../src/notifications.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  .replace(/import React, \{ useState, useSyncExternalStore \} from ['"]react['"];?/, 'const {useState,useSyncExternalStore}=React;')
assert.doesNotMatch(component, /from ['"]react/)
const server = createServer(async (request, response) => {
  if (['/react.js', '/react-dom.js'].includes(request.url)) { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(join(runtime, 'node_modules', request.url === '/react.js' ? 'react/umd/react.development.js' : 'react-dom/umd/react-dom.development.js'))); return }
  if (request.url === '/component.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(component); return }
  response.setHeader('Content-Type', 'text/html')
  response.end(`<html lang="zh-CN"><meta charset="utf-8"><style>body{font:14px system-ui;margin:40px;background:#fffaf7;color:#222}main{max-width:720px}input{accent-color:#9f2636}input:focus-visible{outline:2px solid #9f2636;outline-offset:3px}</style><main><h1 style="font-size:18px">通用设置</h1><div id="root"></div></main><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">
  import {NotificationSettings,installNotificationNavigation} from '/component.js';
  let value={enabled:true,attention:true,completed:true,failed:true,studio:true,sound:false,preview:false},state={value,writable:true},listeners=new Set();
  const scope={getSnapshot:()=>state,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},set:async(k,v)=>{if(window.failSave)throw Error('保存失败');value={...value,[k]:v};state={value,writable:true};listeners.forEach(f=>f())}};
  let session='one',sessionListeners=new Set();window.calls=[];window.navigated=[];window.target=null;
  const ctx={sessions:{list:{getSnapshot:()=>({current:session}),subscribe:f=>{sessionListeners.add(f);return()=>sessionListeners.delete(f)}}},uiWorkspace:{openSession:id=>{session=id;window.navigated.push(id);sessionListeners.forEach(f=>f())}},get:()=>({openTab:(kind,options)=>window.calls.push({kind,options})})};
  const controller=installNotificationNavigation(ctx,async(view)=>{window.lastView=view;const target=window.target;window.target=null;return{desktop:true,delivery:'available',target}});
  window.controller=controller;window.scope=scope;ReactDOM.createRoot(document.querySelector('#root')).render(React.createElement(NotificationSettings,{scope,status:controller.status}));
  </script></html>`)
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } }), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('checkbox', { name: '桌面弹窗', exact: true }).waitFor()
  await page.getByRole('checkbox', { name: '通知声音', exact: true }).check()
  assert.equal(await page.evaluate(() => window.scope.getSnapshot().value.sound), true)
  await page.evaluate(() => { window.failSave = true })
  await page.getByRole('checkbox', { name: '显示会话与成果标题', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByRole('checkbox', { name: '显示会话与成果标题', exact: true }).isChecked(), false)
  await page.evaluate(() => { window.failSave = false; window.target = { key: 'studio-a', sessionId: 'two', artifactId: 'artifact_a' }; window.dispatchEvent(new Event('focus')) })
  await page.waitForFunction(() => window.calls.length === 1)
  assert.deepEqual(await page.evaluate(() => window.navigated), ['two'])
  assert.deepEqual(await page.evaluate(() => window.calls[0]), { kind: 'knowledge-studio', options: { params: { artifactId: 'artifact_a' } } })
  await page.waitForFunction(() => window.lastView.openedKey === 'studio-a')
  await page.getByRole('checkbox', { name: '显示会话与成果标题', exact: true }).check()
  await mkdir(evidence, { recursive: true }); await page.screenshot({ path: join(evidence, 'notification-settings.png') })
  await page.evaluate(() => window.controller.close())
  assert.deepEqual(errors, [])
  console.log('PASS: notification settings save/failure, native target navigation and acknowledgement; isolated browser fixture')
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)) }
