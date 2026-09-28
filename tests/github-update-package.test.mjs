import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,copyFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {githubUpdateManifest} from '../scripts/github-update-manifest.mjs'
import {validateExtractorReceipt} from '../scripts/publish-windows-release.mjs'

const repo=fileURLToPath(new URL('..',import.meta.url))
test('CI archive format supports stable and development updates in both editions',{skip:process.platform!=='win32'},t=>{
 const root=mkdtempSync(join(tmpdir(),'eduwork-update-package-'))
 t.after(()=>{if(resolve(root).startsWith(resolve(tmpdir())+'\\eduwork-update-package-'))rmSync(root,{recursive:true,force:true})})
 const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:repo,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stdout+'\n'+r.stderr)}
 const helper=join(root,'EduWork-Updater.exe'),manifestScript=join(repo,'dsh-electron/scripts/set-updater-manifest.ps1')
 run('go',['-C',join(repo,'dsh-desktop'),'build','-buildvcs=false','-trimpath','-ldflags','-s -w -H windowsgui','-o',helper,'./cmd/eduwork-updater'])
 for(const [name,distribution] of [['EduWork','eduwork'],['EduWork-ECNU','eduwork-chatecnu']])for(const development of [false,true]){
  const version=development?'0.3.7-dev.20260914.1':'0.3.7',dir=join(root,`${name}-${version}`)
  mkdirSync(join(dir,'resources/app'),{recursive:true});mkdirSync(join(dir,'resources/update'),{recursive:true});mkdirSync(join(dir,'resources/brand'),{recursive:true});mkdirSync(join(dir,'config'),{recursive:true})
  writeFileSync(join(dir,'resources/app/eduwork.desktop.json'),JSON.stringify({productVersion:version,productName:name,distribution,shell:'electron'}))
  copyFileSync(join(repo,'assets/eduwork/icon.ico'),join(dir,'resources/brand/icon.ico'))
  const deepRelative='resources/'+('dependency/'.repeat(18))+'file.txt'
  mkdirSync(join(dir,deepRelative,'..'),{recursive:true});writeFileSync(join(dir,deepRelative),'Synthetic long-path fixture')
  writeFileSync(join(dir,'config/eduwork.jsonc'),'{}')
  for(const file of ['EduWork-Electron.exe','EduWork.exe','ChatECNU-Work.exe'])writeFileSync(join(dir,file),'Synthetic packaging fixture; not executable.')
  const updater=join(dir,'resources/update/EduWork-Updater.exe');copyFileSync(helper,updater)
  const zip=join(root,`${name}-${version}-windows-x64-electron.zip`)
  const rejected=spawnSync('pwsh',['-NoProfile','-File',join(repo,'scripts/pack-windows-release.ps1'),'-Candidate',dir,'-Output',zip,'-ForUpdate',...(development?['-Development']:[])],{cwd:repo,encoding:'utf8',windowsHide:true})
  assert.notEqual(rejected.status,0,'Unmanifested updater must block packaging')
  assert.equal(existsSync(zip),false,'Rejected candidate must not leave a release ZIP')
  run('pwsh',['-NoProfile','-File',manifestScript,'-Executable',updater])
  run('pwsh',['-NoProfile','-File',join(repo,'scripts/pack-windows-release.ps1'),'-Candidate',dir,'-Output',zip,'-ForUpdate',...(development?['-Development']:[])])
  const extracted=join(root,`extracted-${name}-${version}`);mkdirSync(extracted)
  const hash=readFileSync(zip+'.sha256','utf8').trim().split(/\s+/)[0]
  const extractorBuild=join(root,`extractor-${name}-${version}`),publish=join(root,`publish-${name}-${version}`);mkdirSync(publish)
  run('pwsh',['-NoProfile','-File',join(repo,'scripts/prepare-windows-portable-extractor.ps1'),'-Archive',zip,'-ExpectedSHA256',hash,'-OutputDirectory',extractorBuild,'-Target',join(extracted,name),'-PublishDirectory',publish])
  const unpackName=`${name}-${version}-windows-x64-unpack.zip`
  const extractorReceipt=JSON.parse(readFileSync(join(publish,unpackName+'.json'),'utf8'))
  assert.equal(extractorReceipt.checks.outerZIP,'passed');assert.equal(extractorReceipt.checks.extraction,'passed')
  assert.ok(join(extracted,name,deepRelative).length>260)
  assert.equal(readFileSync(join(extracted,name,deepRelative),'utf8'),'Synthetic long-path fixture')
  validateExtractorReceipt(extractorReceipt,{edition:name,version,coreCommit:extractorReceipt.extractor.sourceCommit,asset:{name:zip.split(/[\\/]/).at(-1),bytes:readFileSync(zip).length,sha256:hash},portableExtractor:{asset:extractorReceipt.asset}})
  run(process.execPath,[join(repo,'scripts/verify-windows-release.mjs'),join(extracted,name),'--for-update'])
  run('pwsh',['-NoProfile','-File',manifestScript,'-Executable',join(extracted,name,'resources/update/EduWork-Updater.exe'),'-VerifyOnly'])
  const m=JSON.parse(readFileSync(join(extracted,name,'RELEASE-MANIFEST.json'),'utf8'))
  assert.equal(m.launch.distribution,distribution);assert.equal(m.launcherVersion,version)
  if(!development){
   const manifest=githubUpdateManifest({kind:'eduwork-windows-release',passed:true,version,edition:name,distribution,shell:'electron',platform:'windows-x64',asset:{name:zip.split(/[\\/]/).at(-1),bytes:readFileSync(zip).length,sha256:hash}},'ecnu/'+name)
   assert.equal(manifest.artifacts[0].sha256,hash)
  }
 }
})
