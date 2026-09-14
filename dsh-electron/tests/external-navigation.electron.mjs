// Run with the verified raw Electron runtime. Uses a hidden synthetic renderer,
// no debug port, no user profile, and a spy at the OS browser-launch boundary.
import { app, BrowserWindow } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { attachExternalNavigation } from '../src/external-navigation.mjs'

const evidence = resolve(process.argv[2])
mkdirSync(evidence,{recursive:true})
const root = mkdtempSync(join(evidence,'run-'))
app.setPath('userData',join(root,'browser'))
const checks=[],opened=[],result={passed:false,checks,scope:'Actual Electron anchor navigation; system browser invocation captured by a spy, no production profile or debug port'}
let window
async function main() {
try {
  if (process.argv[3]) {
    const bundle=await readFile(resolve(process.argv[3],'lib/main.js'),'utf8')
    assert.ok(bundle.includes('configureWindowNavigation(window)') && bundle.includes('attachExternalNavigation'))
    checks.push('recorded-shell-build-contains-navigation-adapter')
  }
  await app.whenReady()
  window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
  attachExternalNavigation(window.webContents,async url=>opened.push(url))
  const page = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><a id="same" href="https://example.org/same?q=1#part">same</a><a id="new" target="_blank" href="https://example.org/new">new</a>')
  await window.loadURL(page)
  for(const [id,count]of [['same',1],['new',2]]) {
    await window.webContents.executeJavaScript(`document.getElementById('${id}').click()`)
    const deadline=Date.now()+5000
    while(opened.length<count && Date.now()<deadline)await delay(50)
    assert.equal(opened.length,count)
    assert.equal(window.webContents.getURL(),page)
    checks.push(id+'-target-opens-external-without-replacing-app')
  }
  assert.deepEqual(opened,['https://example.org/same?q=1#part','https://example.org/new'])
  result.passed=true
}catch(error){result.error=error.message}
finally{
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result))
  window?.destroy()
  app.exit(result.passed?0:1)
}
}
// Electron emits ready after evaluating the ESM entry.
void main()
