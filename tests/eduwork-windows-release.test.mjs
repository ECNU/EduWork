import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReceipt } from '../scripts/publish-windows-release.mjs'
import {githubUpdateManifest} from '../scripts/github-update-manifest.mjs'
const context={repository:'ECNU/EduWork',version:'0.3.0',commit:'a'.repeat(40)}
const receipt={schemaVersion:1,kind:'eduwork-windows-release',validationProfile:'ci-build-and-launch-v1',passed:true,version:'0.3.0',edition:'EduWork',shell:'electron',platform:'windows-x64',editionCommit:context.commit,checks:Object.fromEntries(['sourceAndDependencies','desktopLaunch','archiveManifest'].map(key=>[key,'passed'])),asset:{name:'EduWork-0.3.0-windows-x64-electron.zip',bytes:1024,sha256:'b'.repeat(64)}}
receipt.releaseNotes={approved:true,sha256:'c'.repeat(64)}
test('release publisher accepts the complete matching Windows receipt',()=>assert.equal(validateReceipt(receipt,context),'EduWork'))
test('release publisher requires approved notes and rejects a Go artifact',()=>{
  for(const row of [{...receipt,releaseNotes:undefined},{...receipt,releaseNotes:{approved:false,sha256:'c'.repeat(64)}},{...receipt,releaseNotes:{approved:true,sha256:''}},{...receipt,shell:'wails'}]) assert.throws(()=>validateReceipt(row,context))
})

test('GitHub update manifest binds repository, edition, version, platform and ZIP hash',()=>{
 const row={...receipt,distribution:'eduwork'}
 const manifest=githubUpdateManifest(row,'ecnu/EduWork')
 assert.deepEqual(githubUpdateManifest(row,'ECNU/EduWork'),manifest)
 assert.equal(manifest.distribution,'eduwork')
 assert.equal(manifest.channel,'stable')
 assert.equal(manifest.artifacts[0].url,'https://github.com/ecnu/EduWork/releases/download/v0.3.0/EduWork-0.3.0-windows-x64-electron.zip')
 assert.equal(manifest.artifacts[0].sha256,receipt.asset.sha256)
 for(const bad of [{...row,version:'0.3.0-dev.20260914.1'},{...row,distribution:'eduwork-chatecnu'},{...row,shell:'wails'},{...row,passed:false},{...row,asset:{...row.asset,bytes:2**31}}])assert.throws(()=>githubUpdateManifest(bad,'ecnu/EduWork'))
 assert.throws(()=>githubUpdateManifest(row,'ecnu/EduWork-ECNU'))
 const school={...row,edition:'EduWork-ECNU',distribution:'eduwork-chatecnu',asset:{...row.asset,name:'EduWork-ECNU-0.3.0-windows-x64-electron.zip'}}
 assert.equal(githubUpdateManifest(school,'ecnu/EduWork-ECNU').distribution,'eduwork-chatecnu')
})
test('release publisher rejects wrong edition, commit, development versions and partial tests',()=>{
  for (const [row,ctx] of [[receipt,{...context,repository:'ECNU/EduWork-ECNU'}],[receipt,{...context,version:'0.3.0-dev.1'}],[{...receipt,editionCommit:'c'.repeat(40)},context],[{...receipt,checks:{...receipt.checks,desktopLaunch:'skipped'}},context],[{...receipt,passed:false},context],[{...receipt,asset:{...receipt.asset,name:'../../secret.zip'}},context]]) assert.throws(()=>validateReceipt(row,ctx))
})
