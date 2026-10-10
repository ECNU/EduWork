import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReceipt,releasePublication,validateExtractorReceipt,validatedReleaseFiles } from '../scripts/publish-windows-release.mjs'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {githubUpdateManifest,githubUpdateManifestBytes} from '../scripts/github-update-manifest.mjs'
const context={repository:'ECNU/EduWork',version:'0.3.0',commit:'a'.repeat(40)}
const receipt={schemaVersion:1,kind:'eduwork-windows-release',validationProfile:'ci-build-launch-and-extract-v2',passed:true,version:'0.3.0',edition:'EduWork',shell:'electron',platform:'windows-x64',coreCommit:'d'.repeat(40),editionCommit:context.commit,checks:Object.fromEntries(['sourceAndDependencies','desktopLaunch','archiveManifest','nativeRuntimes','portableExtractor'].map(key=>[key,'passed'])),asset:{name:'EduWork-0.3.0-windows-x64-electron.zip',bytes:1024,sha256:'b'.repeat(64)}}
function extractorFiles(edition,version) {return {asset:{name:`${edition}-${version}-windows-x64-setup.zip`,bytes:2048,sha256:'e'.repeat(64)},receipt:{name:`${edition}-${version}-windows-x64-setup.zip.json`,bytes:512,sha256:'f'.repeat(64)}}}
receipt.portableExtractor=extractorFiles('EduWork',receipt.version)
receipt.releaseNotes={approved:true,sha256:'c'.repeat(64)}
test('release publisher accepts the complete matching Windows receipt',()=>assert.equal(validateReceipt(receipt,context),'EduWork'))

test('release publisher rejects missing or failed packaged native runtime checks',()=>{
 for(const nativeRuntimes of [undefined,'skipped','failed']) assert.throws(()=>validateReceipt({...receipt,checks:{...receipt.checks,nativeRuntimes}},context),/nativeRuntimes/)
})

test('published update metadata retains the legacy client wire representation',()=>{
 const row={...receipt,distribution:'eduwork'}
 const encoded=githubUpdateManifestBytes(row,context.repository)
 assert.deepEqual(JSON.parse(encoded),githubUpdateManifest(row,context.repository))
 assert.equal(encoded,JSON.stringify(JSON.parse(encoded)))
 assert.ok(!encoded.endsWith('\n'),'A trailing newline changes the legacy cached digest')
})

test('source releases generate upgrade manifests for subsequent stable versions in both editions',()=>{
 for(const version of ['0.4.0','0.4.1','0.5.0','1.0.0']) for(const [edition,distribution] of [['EduWork','eduwork'],['EduWork-ECNU','eduwork-chatecnu']]) {
  const row={...receipt,kind:'eduwork-source-release',version,edition,distribution,platform:'windows',automaticUpdates:true,checks:{...receipt.checks,updateContract:'passed'},asset:{...receipt.asset,name:`${edition}-${version}-windows-x64-electron.zip`}}
  const manifest=githubUpdateManifest(row,'ECNU/'+edition)
  assert.equal(manifest.channel,'stable')
  assert.equal(manifest.version,version)
  assert.equal(manifest.artifacts[0].url,`https://github.com/ecnu/${edition}/releases/download/v${version}/${row.asset.name}`)
  for(const bad of [{...row,automaticUpdates:false},{...row,passed:false},{...row,checks:{...row.checks,updateContract:'failed'}},{...row,version:version+'-dev.20261001.1',asset:{...row.asset,name:`${edition}-${version}-dev.20261001.1-windows-x64-electron.zip`}}])assert.throws(()=>githubUpdateManifest(bad,'ECNU/'+edition))
 }
})

test('approved development releases publish only to the development channel and never become latest stable',()=>{
 const version='0.3.6-dev.20260914.3'
 const row={...receipt,version,distribution:'eduwork',asset:{...receipt.asset,name:`EduWork-${version}-windows-x64-electron.zip`},portableExtractor:extractorFiles('EduWork',version)}
 assert.equal(validateReceipt(row,{...context,version}),'EduWork')
 assert.equal(githubUpdateManifest(row,context.repository).channel,'development')
 assert.deepEqual(releasePublication('EduWork',version),{name:`EduWork ${version}`,prerelease:true,make_latest:'false'})
 assert.equal(releasePublication('EduWork','0.3.6').prerelease,false)
 assert.equal(releasePublication('EduWork','0.3.6').make_latest,'true')
 for (const candidate of ['0.3.6-alpha.1', '0.3.6-beta.2', '0.3.6-rc.1']) {
  const prerelease = {...row, version: candidate, asset: {...row.asset, name: `EduWork-${candidate}-windows-x64-electron.zip`}}
  assert.equal(githubUpdateManifest(prerelease, context.repository).channel, 'development')
  assert.equal(releasePublication('EduWork', candidate).prerelease, true)
 }
 assert.throws(()=>githubUpdateManifest({...row,kind:'eduwork-windows-development'},context.repository))
 for(const invalid of ['0.3.6-dev.1','0.3.6-rc.0','0.3.6-dev.20260914.0','0.3.6-dev.20260914.03','00.3.6'])assert.throws(()=>releasePublication('EduWork',invalid))
})
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

test('portable extractor is mandatory and must bind the same clean core and payload',()=>{
 const child={schemaVersion:1,kind:'eduwork-portable-extractor',format:'zip-containing-self-extracting-exe',version:receipt.version,distribution:'eduwork',payload:receipt.asset,asset:receipt.portableExtractor.asset,extractor:{name:'EduWork-Setup.exe',bytes:1536,sha256:'1'.repeat(64),sourceCommit:receipt.coreCommit,sourceDirty:false},checks:{embeddedArchive:'passed',manifestIdentity:'passed',outerZIP:'passed',extraction:'passed',executionLevel:'asInvoker'}}
 validateExtractorReceipt(child,receipt)
 for(const bad of [{...receipt,portableExtractor:undefined},{...receipt,checks:{...receipt.checks,portableExtractor:'skipped'}},{...receipt,portableExtractor:{...receipt.portableExtractor,asset:{...receipt.portableExtractor.asset,name:'../unpack.zip'}}}])assert.throws(()=>validateReceipt(bad,context))
 for(const bad of [{...child,version:'other'},{...child,distribution:'eduwork-chatecnu'},{...child,payload:{...child.payload,sha256:'2'.repeat(64)}},{...child,asset:{...child.asset,bytes:7}},{...child,extractor:{...child.extractor,sourceDirty:true}},{...child,extractor:{...child.extractor,sourceCommit:'3'.repeat(40)}},{...child,checks:{...child.checks,extraction:'skipped'}},{...child,checks:{...child.checks,executionLevel:'requireAdministrator'}}])assert.throws(()=>validateExtractorReceipt(bad,receipt))
})

async function publicationFixture(t,edition='EduWork') {
 const root=await mkdtemp(join(tmpdir(),'eduwork-publication-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const ctx={...context,repository:'ECNU/'+edition}
 const row=structuredClone(receipt);row.edition=edition;row.distribution=edition==='EduWork'?'eduwork':'eduwork-chatecnu'
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
 const archive=Buffer.from('Synthetic update ZIP; not an application'),unpack=Buffer.from('Synthetic extraction ZIP; not an executable'),notes='Synthetic approved release notes'
 row.asset={name:`${edition}-${row.version}-windows-x64-electron.zip`,bytes:archive.length,sha256:digest(archive)}
 row.portableExtractor=extractorFiles(edition,row.version)
 row.portableExtractor.asset.bytes=unpack.length;row.portableExtractor.asset.sha256=digest(unpack)
 row.releaseNotes.sha256=digest(notes)
 const child={schemaVersion:1,kind:'eduwork-portable-extractor',format:'zip-containing-self-extracting-exe',version:row.version,distribution:row.distribution,payload:row.asset,asset:row.portableExtractor.asset,extractor:{name:`${edition}-Setup.exe`,bytes:12,sha256:'1'.repeat(64),sourceCommit:row.coreCommit,sourceDirty:false},checks:{embeddedArchive:'passed',manifestIdentity:'passed',outerZIP:'passed',extraction:'passed',executionLevel:'asInvoker'}}
 const childBytes=JSON.stringify(child)
 row.portableExtractor.receipt.bytes=Buffer.byteLength(childBytes);row.portableExtractor.receipt.sha256=digest(childBytes)
 const files={[row.asset.name]:archive,[row.asset.name+'.sha256']:`${row.asset.sha256}  ${row.asset.name}\n`,'RELEASE-NOTES.md':notes,'release-receipt.json':JSON.stringify(row),'update-windows-amd64.json':githubUpdateManifestBytes(row,ctx.repository),[row.portableExtractor.asset.name]:unpack,[row.portableExtractor.asset.name+'.sha256']:`${row.portableExtractor.asset.sha256}  ${row.portableExtractor.asset.name}\n`,[row.portableExtractor.receipt.name]:childBytes}
 for(const [name,value] of Object.entries(files))await writeFile(join(root,name),value)
 return {root,ctx,row}
}
test('publication validates eight files for both editions while the updater keeps the original ZIP',async t=>{
 for(const edition of ['EduWork','EduWork-ECNU']){
  const {root,ctx,row}=await publicationFixture(t,edition)
  const result=await validatedReleaseFiles(root,ctx)
  assert.equal(result.files.length,8)
  assert.equal(githubUpdateManifest(row,ctx.repository).artifacts.length,1)
  assert.equal(githubUpdateManifest(row,ctx.repository).artifacts[0].fileName,row.asset.name)
 }
})
test('publication rejects missing, modified, unrecorded or mismatched extractor assets before upload',async t=>{
 const mutations=[
  async({root,row})=>rm(join(root,row.portableExtractor.asset.name)),
  async({root,row})=>writeFile(join(root,row.portableExtractor.asset.name),'corrupt'),
  async({root,row})=>writeFile(join(root,row.portableExtractor.asset.name+'.sha256'),'wrong'),
  async({root,row})=>writeFile(join(root,row.portableExtractor.receipt.name),'{}'),
  async({root})=>writeFile(join(root,'unexpected.txt'),'not approved')
 ]
 for(const mutate of mutations){const fixture=await publicationFixture(t);await mutate(fixture);await assert.rejects(()=>validatedReleaseFiles(fixture.root,fixture.ctx))}
})
