import test from 'node:test'
import assert from 'node:assert/strict'
import { validateReceipt,releasePublication,validateExtractorReceipt,validatedReleaseFiles } from '../scripts/publish-windows-release.mjs'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename,join,resolve,sep} from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
import {githubUpdateManifest,githubUpdateManifestBytes} from '../scripts/github-update-manifest.mjs'
import {windowsStages} from '../scripts/lib/windows-stages.mjs'
import {fileURLToPath} from 'node:url'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {installProductHost} from '../dsh-host/install-product-host.mjs'
import {windowsDeltaName} from '../scripts/windows-update-delta.mjs'
import {ZipWriter} from '../scripts/lib/zip.mjs'
const context={repository:'ECNU/EduWork',version:'0.3.0',commit:'a'.repeat(40)}
const receipt={schemaVersion:1,kind:'eduwork-windows-release',validationProfile:'ci-build-launch-and-extract-v2',automaticUpdates:true,passed:true,version:'0.3.0',edition:'EduWork',shell:'electron',platform:'windows-x64',coreCommit:'d'.repeat(40),editionCommit:context.commit,checks:Object.fromEntries(['sourceAndDependencies','desktopLaunch','archiveManifest','nativeRuntimes','portableExtractor','updateContract'].map(key=>[key,'passed'])),asset:{name:'EduWork-0.3.0-windows-x64-electron.zip',bytes:1024,sha256:'b'.repeat(64)}}
function extractorFiles(edition,version) {return {asset:{name:`${edition}-${version}-windows-x64-setup.zip`,bytes:2048,sha256:'e'.repeat(64)},receipt:{name:`${edition}-${version}-windows-x64-setup.zip.json`,bytes:512,sha256:'f'.repeat(64)}}}
receipt.portableExtractor=extractorFiles('EduWork',receipt.version)
receipt.releaseNotes={approved:true,sha256:'c'.repeat(64)}

test('Windows desktop stage preserves the edition policy of an already qualified Host', async t => {
 const root=await mkdtemp(join(tmpdir(),'eduwork-frozen-host-'))
 t.after(async()=>{
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep) && basename(root).startsWith('eduwork-frozen-host-'))
  await rm(root,{recursive:true,force:true})
 })
 const product=join(root,'product'),adapter=join(root,'host'),policyPath='desktop-host/lib/distribution-policy.patch.json'
 await mkdir(product);await mkdir(join(adapter,'desktop-host/lib'),{recursive:true});await mkdir(join(root,'inputs'))
 await writeFile(join(product,'assembly.json'),JSON.stringify({dshCommit:'fixture-upstream',dshVersion:'0.2.0-rc.2'}))
 const payloads={'desktop-host/lib/index.js':'export const fixture = true\n',[policyPath]:'[{"id":"product-analytics","disabled":true}]\n'}
 for(const [path,bytes] of Object.entries(payloads))await writeFile(join(adapter,path),bytes)
 await writeFile(join(adapter,'receipt.json'),JSON.stringify({upstreamCommit:'fixture-upstream',upstreamVersion:'0.2.0-rc.2',protocolVersion:3,outputs:Object.fromEntries(Object.entries(payloads).map(([path,bytes])=>[path,createHash('sha256').update(bytes).digest('hex')]))}))
 await installProductHost({product,adapter})
 const policyFile=join(product,'d/node_modules/@deepseek-ai/dsh-desktop-host/lib/distribution-policy.patch.json')
 const policy=JSON.stringify([...JSON.parse(payloads[policyPath]),{id:'retired-edition-plugin',disabled:true}])+'\n'
 await writeFile(policyFile,policy)
 // Reinstallation really rejects this legitimate, later edition overlay.
 // Keep that integrity guard; the desktop stage must consume the frozen product.
 await assert.rejects(installProductHost({product,adapter}),/another desktop Host/)
 await writeFile(join(root,'inputs/inputs.json'),JSON.stringify({node:process.execPath}))
 const assemblyURL=new URL('../dsh-electron/scripts/assemble-windows.mjs',import.meta.url).href
 const packingURL=new URL('../scripts/pack-windows-release.mjs',import.meta.url).href
 const stagesURL=new URL('../scripts/lib/windows-stages.mjs',import.meta.url).href
 const assembler=`import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';export async function assembleWindows(options){assert.equal(await readFile(${JSON.stringify(policyFile)},'utf8'),${JSON.stringify(policy)});await mkdir(options.output,{recursive:true});await writeFile(join(options.output,'edition-policy.json'),${JSON.stringify(policy)});}`
 const packer=`import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';export async function packWindowsRelease(options){assert.equal(await readFile(join(options.candidate,'edition-policy.json'),'utf8'),${JSON.stringify(policy)});await writeFile(options.output,'Synthetic archive boundary');return {output:options.output};}`
 // Only native packaging is stubbed. Execute the real stage and Host installer
 // in a separate module graph, so a duplicate install fails before packaging.
 const child=`import {registerHooks} from 'node:module';import {join} from 'node:path';
 const stubs=new Map(${JSON.stringify([[assemblyURL,'data:text/javascript,'+encodeURIComponent(assembler)],[packingURL,'data:text/javascript,'+encodeURIComponent(packer)]])});
 registerHooks({resolve(s,c,next){const r=next(s,c);return stubs.has(r.url)?{url:stubs.get(r.url),shortCircuit:true}:r}});
 const {windowsStages}=await import(${JSON.stringify(stagesURL)});
 const workspace={parameters:{version:'0.4.3-dev.20261011.1',development:true,edition:'ExampleCampus',forUpdate:false},resolvePath:p=>join(${JSON.stringify(root)},p)};
 await windowsStages({coreRoot:${JSON.stringify(fileURLToPath(new URL('..',import.meta.url)))},receiptBase:{},recipe:'pinned-source'}).find(s=>s.name==='desktop').run(workspace);`
 await promisify(execFile)(process.execPath,['--input-type=module','-e',child],{windowsHide:true})
 assert.equal(await readFile(policyFile,'utf8'),policy)
 const packed=JSON.parse(await readFile(join(root,'desktop/package.json'),'utf8'))
 assert.equal(packed.output,join(root,'desktop/ExampleCampus-0.4.3-dev.20261011.1-windows-x64-electron.zip'))
})

test('Windows publish stage keeps institution artifacts without inventing an ECNU update repository',async t=>{
 const coreRoot=fileURLToPath(new URL('..',import.meta.url))
 const recipe='pinned-source'
 for(const [name,distribution] of [['EduWork','eduwork'],['EduWork-ECNU','eduwork-chatecnu'],['ExampleCampus','example-campus']]) {
  for(const [version,development] of [['0.4.3',false],['0.4.3-alpha.1',false],['0.4.3-dev.20261010.1',true]]) await t.test(`${recipe}: ${name} ${version}`,async t=>{
   const root=await mkdtemp(join(tmpdir(),'eduwork-publish-stage-'))
   t.after(async()=>{
    const target=resolve(root)
    assert.ok(target.startsWith(resolve(tmpdir())+sep) && basename(target).startsWith('eduwork-publish-stage-'))
    await rm(target,{recursive:true,force:true})
   })
   const file=async(path,content)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),content)}
   const json=async(path,value)=>file(path,JSON.stringify(value))
   const asset={name:`${name}-${version}-windows-x64-electron.zip`,bytes:32,sha256:'a'.repeat(64)}
   const extractor=extractorFiles(name,version)
   const archive=Buffer.from('Synthetic publication input, not an application')
   await file(`desktop/${asset.name}`,archive)
   await json('desktop/package.json',{output:join(root,'desktop',asset.name)})
   await json('product/assembly.json',{distribution,dshVersion:'0.2.0-rc.2',dshCommit:'b'.repeat(40)})
   await json('inputs/inputs.json',{})
   await json('gui/acceptance-checks.json',{asset,portableExtractorAssets:extractor})
   for(const filename of [extractor.asset.name,`${extractor.asset.name}.sha256`,extractor.receipt.name]) await file(`gui/extractor-publish/${filename}`,'Synthetic extractor evidence')
   await file('RELEASE-NOTES.md','Synthetic approved release notes')
   const workspace={parameters:{name,version,development,releaseNotesFile:'RELEASE-NOTES.md',editionRoot:root,recipe,deltaBases:[]},resolvePath:path=>join(root,path)}
   const receiptBase={schemaVersion:1,kind:development?'eduwork-windows-development':'eduwork-windows-release',edition:name,version,shell:'electron',platform:'windows-x64'}
   await windowsStages({coreRoot,receiptBase,recipe}).find(stage=>stage.name==='publish').run(workspace)
   const files=await readdir(join(root,'publish'))
   const expectedManifest=!development && name!=='ExampleCampus'
   assert.equal(files.includes('update-windows-amd64.json'),expectedManifest)
   assert.equal(files.includes('RELEASE-NOTES.md'),!development)
   assert.equal(files.includes(extractor.asset.name),!development)
   assert.deepEqual(await readFile(join(root,'publish',asset.name)),archive)
   const published=JSON.parse(await readFile(join(root,'publish/release-receipt.json'),'utf8'))
   assert.equal(published.distribution,distribution)
   assert.deepEqual(published.asset,asset)
   if(expectedManifest){
    const manifest=JSON.parse(await readFile(join(root,'publish/update-windows-amd64.json'),'utf8'))
    assert.equal(manifest.artifacts[0].url,`https://github.com/ecnu/${name}/releases/download/v${version}/${asset.name}`)
    assert.equal(manifest.artifacts[0].sha256,asset.sha256)
   }
  })
 }
})
test('Windows publish stage publishes delta updates in the receipt and the update manifest',async t=>{
 const root=await mkdtemp(join(tmpdir(),'eduwork-publish-delta-'))
 t.after(async()=>{
  assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep) && basename(root).startsWith('eduwork-publish-delta-'))
  await rm(root,{recursive:true,force:true})
 })
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
 const file=async(path,content)=>{await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),content)}
 const release=async(path,version,files)=>{
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,version,launcherVersion:version,flavor:'offline',files:Object.entries(files).map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:digest(bytes)}))}))
  await mkdir(join(root,path,'..'),{recursive:true})
  const zip=await ZipWriter.create(join(root,path))
  await zip.addEntry('EduWork/RELEASE-MANIFEST.json',manifest)
  for(const [name,bytes] of Object.entries(files))await zip.addEntry('EduWork/'+name,bytes)
  await zip.close()
  return manifest
 }
 // Incompressible, so the unchanged runtime dominates the full archive.
 const runtime=randomBytes(64<<10)
 const asset={name:'EduWork-0.4.4-windows-x64-electron.zip'}
 const previous=await release('bases/EduWork-0.4.3-windows-x64-electron.zip','0.4.3',{'EduWork-Electron.exe':runtime,'resources/app.js':Buffer.from('old app')})
 await release('desktop/'+asset.name,'0.4.4',{'EduWork-Electron.exe':runtime,'resources/app.js':Buffer.from('new app')})
 const archive=await readFile(join(root,'desktop',asset.name))
 Object.assign(asset,{bytes:archive.length,sha256:digest(archive)})
 const extractor=extractorFiles('EduWork','0.4.4')
 await file('desktop/package.json',JSON.stringify({output:join(root,'desktop',asset.name)}))
 await file('product/assembly.json',JSON.stringify({distribution:'eduwork',dshVersion:'0.2.0-rc.2',dshCommit:'b'.repeat(40)}))
 await file('inputs/inputs.json','{}')
 await file('gui/acceptance-checks.json',JSON.stringify({asset,portableExtractorAssets:extractor}))
 for(const filename of [extractor.asset.name,`${extractor.asset.name}.sha256`,extractor.receipt.name])await file(`gui/extractor-publish/${filename}`,'Synthetic extractor evidence')
 await file('RELEASE-NOTES.md','Synthetic approved release notes')
 const workspace={parameters:{name:'EduWork',version:'0.4.4',development:false,releaseNotesFile:'RELEASE-NOTES.md',editionRoot:root,recipe:'pinned-source',deltaBases:[join(root,'bases/EduWork-0.4.3-windows-x64-electron.zip')]},resolvePath:path=>join(root,path)}
 const receiptBase={schemaVersion:1,kind:'eduwork-windows-release',edition:'EduWork',version:'0.4.4',shell:'electron',platform:'windows-x64'}
 await windowsStages({coreRoot:fileURLToPath(new URL('..',import.meta.url)),receiptBase,recipe:'pinned-source'}).find(stage=>stage.name==='publish').run(workspace)
 const name=windowsDeltaName('EduWork','0.4.4','0.4.3'),delta=await readFile(join(root,'publish',name))
 const recorded={from:'0.4.3',fromManifestSha256:digest(previous),name,bytes:delta.length,sha256:digest(delta)}
 assert.deepEqual(JSON.parse(await readFile(join(root,'publish/release-receipt.json'),'utf8')).deltas,[recorded])
 assert.equal(await readFile(join(root,'publish',name+'.sha256'),'utf8'),`${recorded.sha256}  ${name}\n`)
 const url=`https://github.com/ecnu/EduWork/releases/download/v0.4.4/${name}`
 assert.deepEqual(JSON.parse(await readFile(join(root,'publish/update-windows-amd64.json'),'utf8')).artifacts[0].deltas,
  [{fromVersion:'0.4.3',fromManifestSha256:recorded.fromManifestSha256,fileName:name,bytes:recorded.bytes,sha256:recorded.sha256,url,sha256Url:url+'.sha256'}])
})
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

async function publicationFixture(t,edition='EduWork',deltas=[]) {
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
 row.deltas=deltas.map(({from,bytes})=>({from,fromManifestSha256:'9'.repeat(64),name:windowsDeltaName(edition,row.version,from),bytes:bytes.length,sha256:digest(bytes)}))
 const child={schemaVersion:1,kind:'eduwork-portable-extractor',format:'zip-containing-self-extracting-exe',version:row.version,distribution:row.distribution,payload:row.asset,asset:row.portableExtractor.asset,extractor:{name:`${edition}-Setup.exe`,bytes:12,sha256:'1'.repeat(64),sourceCommit:row.coreCommit,sourceDirty:false},checks:{embeddedArchive:'passed',manifestIdentity:'passed',outerZIP:'passed',extraction:'passed',executionLevel:'asInvoker'}}
 const childBytes=JSON.stringify(child)
 row.portableExtractor.receipt.bytes=Buffer.byteLength(childBytes);row.portableExtractor.receipt.sha256=digest(childBytes)
 const files={[row.asset.name]:archive,[row.asset.name+'.sha256']:`${row.asset.sha256}  ${row.asset.name}\n`,'RELEASE-NOTES.md':notes,'release-receipt.json':JSON.stringify(row),'update-windows-amd64.json':githubUpdateManifestBytes(row,ctx.repository),[row.portableExtractor.asset.name]:unpack,[row.portableExtractor.asset.name+'.sha256']:`${row.portableExtractor.asset.sha256}  ${row.portableExtractor.asset.name}\n`,[row.portableExtractor.receipt.name]:childBytes}
 deltas.forEach(({bytes},index)=>{const delta=row.deltas[index];files[delta.name]=bytes;files[delta.name+'.sha256']=`${delta.sha256}  ${delta.name}\n`})
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
test('publication verifies every delta update and its sidecar before upload',async t=>{
 const deltas=[{from:'0.2.8',bytes:Buffer.from('Synthetic delta from 0.2.8')},{from:'0.2.9',bytes:Buffer.from('Synthetic delta from 0.2.9')}]
 const {root,ctx,row}=await publicationFixture(t,'EduWork',deltas)
 assert.equal((await validatedReleaseFiles(root,ctx)).files.length,12)
 assert.deepEqual(githubUpdateManifest(row,ctx.repository).artifacts[0].deltas.map(delta=>delta.fileName),row.deltas.map(delta=>delta.name))
 const mutations=[
  async({root,row})=>writeFile(join(root,row.deltas[1].name),'changed'),
  async({root,row})=>writeFile(join(root,row.deltas[1].name+'.sha256'),'0'.repeat(64)+'  '+row.deltas[1].name),
  async({root,row})=>rm(join(root,row.deltas[0].name)),
  async({root})=>writeFile(join(root,windowsDeltaName('EduWork','0.3.0','0.2.7')),'unrecorded'),
 ]
 for(const mutate of mutations){const fixture=await publicationFixture(t,'EduWork',deltas);await mutate(fixture);await assert.rejects(()=>validatedReleaseFiles(fixture.root,fixture.ctx))}
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
