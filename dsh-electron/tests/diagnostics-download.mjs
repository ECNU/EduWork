// Focused native-bridge + Chromium download acceptance. No user profile or model request.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'
import { startNativeBridge } from '../src/native-vault.mjs'
import { workbenchAction } from '../../dsh-host/workbench-support.mjs'
import { downloadDiagnosticArchive } from '../../dsh-plugins/workbench-native/lib/diagnostic-download.js'

const {values}=parseArgs({options:{runtime:{type:'string'},evidence:{type:'string'}}})
if(!values.runtime||!values.evidence)throw Error('Use --runtime <test dependencies> --evidence <isolated evidence directory>')
const req=createRequire(join(resolve(values.runtime),'package.json'))
const {chromium}=req('playwright-core')
await mkdir(resolve(values.evidence),{recursive:true})
const root=await mkdtemp(join(resolve(values.evidence),'download-')), logs=join(root,'logs'), config=join(root,'eduwork.jsonc')
await mkdir(logs)
await writeFile(config,JSON.stringify({schemaVersion:1,organizations:[]}))
await writeFile(join(logs,'desktop-host.log'),'启动正常\n模型失败: duplicate field reasoning\nAuthorization: Bearer <synthetic-test-key>\n')
const bridge=await startNativeBridge({vault:{flush:async()=>{},operation:async()=>{throw Error('Credentials are outside this test')}},workbench:action=>workbenchAction({action,config,logs,root,version:'0.3.5',shell:'electron'})})
let browser, evidence
try {
  const {baseURL,token}=bridge.bootstrap.nativeBridge
  const response=await fetch(baseURL+'/v1/extensions/workbench',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'diagnostics'})})
  assert.equal(response.status,200)
  const result=await response.json()
  browser=await chromium.launch({channel:'msedge',headless:true})
  const context=await browser.newContext({acceptDownloads:true}), page=await context.newPage()
  await page.setContent('<html lang="zh"><meta charset="utf-8"><button id="export">导出诊断</button></html>')
  await page.addScriptTag({content:`window.downloadDiagnosticArchive = ${downloadDiagnosticArchive.toString()}`})
  await page.evaluate(result=>document.querySelector('#export').onclick=()=>window.downloadDiagnosticArchive(result),result)
  const pending=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出诊断'}).click()
  const download=await pending, target=join(root,download.suggestedFilename())
  assert.match(download.suggestedFilename(),/^EduWork-diagnostics-.*\.zip$/)
  await download.saveAs(target)
  assert.equal(await download.failure(),null)
  assert.deepEqual(await readFile(target),Buffer.from(result.archive,'base64'))
  evidence={passed:true,checks:['authenticated-native-export','shared-renderer-download','ZIP-bytes-unchanged'],archive:target,limits:'Chromium download and native bridge; not a full desktop UI acceptance.'}
} finally {await browser?.close();await bridge.close()}
await writeFile(join(root,'result.json'),JSON.stringify(evidence,null,2))
console.log(JSON.stringify(evidence))
