import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDesktopUpdates, compareVersions } from '../desktop-updates.mjs'

const updates={manifestURL:'https://releases.example.edu/stable/latest-windows-x64.json'}
const fixture=(manifest, extra={})=>checkDesktopUpdates({updates,version:'0.3.0-rc.1',shell:'electron',platform:'win32',arch:'x64',fetcher:async(url,options)=>{assert.equal(options.redirect,'error');return Response.json(manifest)},...extra})
const manifest={schemaVersion:1,version:'0.3.0',target:'windows-x64',artifacts:[{shell:'electron',url:'https://releases.example.edu/stable/electron.zip'}]}

test('public update feeds cannot promote internal builds', async () => {
 for (const version of ['0.3.1-dev.20260911.1','0.4.0-rc.1']) assert.equal((await fixture({...manifest,version})).phase,'error')
})
test('unconfigured is not reported as up to date and makes no request',async()=>{
 const result=await checkDesktopUpdates({version:'0.3.0',shell:'wails',fetcher:()=>{throw Error('must not fetch')}})
 assert.equal(result.phase,'unconfigured')
})
test('same-shell product release is discovered, current version is compared numerically',async()=>{
 assert.equal((await fixture(manifest)).phase,'available')
 assert.equal((await fixture(manifest,{version:'0.3.0'})).phase,'current')
 assert.equal(compareVersions('0.3.0-rc.10','0.3.0-rc.2'),1)
})
test('cross-shell, wrong platform, insecure and foreign package redirects are rejected',async()=>{
 assert.equal((await fixture(manifest,{shell:'wails'})).phase,'error')
 assert.equal((await fixture({...manifest,target:'darwin-arm64'})).phase,'error')
 for(const url of ['https://unrelated.example/electron.zip','http://releases.example.edu/electron.zip']) {
   assert.equal((await fixture({...manifest,artifacts:[{shell:'electron',url}]})).phase,'error')
 }
})
test('network/server failures and oversized responses are visible failures',async()=>{
 assert.equal((await fixture(manifest,{fetcher:async()=>new Response('',{status:503})})).phase,'error')
 assert.equal((await fixture(manifest,{fetcher:async()=>new Response('x'.repeat(300000))})).phase,'error')
})
