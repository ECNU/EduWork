import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {githubUpdateManifest} from '../scripts/github-update-manifest.mjs'

const repo=fileURLToPath(new URL('..',import.meta.url))
test('CI archive format supports stable and development updates in both editions',{skip:process.platform!=='win32'},t=>{
 const root=mkdtempSync(join(tmpdir(),'eduwork-update-package-'))
 t.after(()=>{if(resolve(root).startsWith(resolve(tmpdir())+'\\eduwork-update-package-'))rmSync(root,{recursive:true,force:true})})
 const run=(cmd,args)=>{const r=spawnSync(cmd,args,{cwd:repo,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stdout+'\n'+r.stderr)}
 for(const [name,distribution] of [['EduWork','eduwork'],['EduWork-ECNU','eduwork-chatecnu']])for(const development of [false,true]){
  const version=development?'0.3.7-dev.20260914.1':'0.3.7',dir=join(root,`${name}-${version}`)
  mkdirSync(join(dir,'resources/app'),{recursive:true});mkdirSync(join(dir,'resources/update'),{recursive:true});mkdirSync(join(dir,'config'),{recursive:true})
  writeFileSync(join(dir,'resources/app/eduwork.desktop.json'),JSON.stringify({productVersion:version,distribution,shell:'electron'}))
  writeFileSync(join(dir,'config/eduwork.jsonc'),'{}')
  for(const file of ['EduWork-Electron.exe','EduWork.exe','ChatECNU-Work.exe','resources/update/EduWork-Updater.exe'])writeFileSync(join(dir,file),'Synthetic packaging fixture; not executable.')
  const zip=join(root,`${name}-${version}-windows-x64-electron.zip`)
  run('pwsh',['-NoProfile','-File',join(repo,'scripts/pack-windows-release.ps1'),'-Candidate',dir,'-Output',zip,'-ForUpdate',...(development?['-Development']:[])])
  const extracted=join(root,`extracted-${name}-${version}`);mkdirSync(extracted)
  run('tar',['-xf',zip,'-C',extracted])
  run(process.execPath,[join(repo,'scripts/verify-windows-release.mjs'),join(extracted,name),'--for-update'])
  const m=JSON.parse(readFileSync(join(extracted,name,'RELEASE-MANIFEST.json'),'utf8'))
  assert.equal(m.launch.distribution,distribution);assert.equal(m.launcherVersion,version)
  if(!development){
   const hash=readFileSync(zip+'.sha256','utf8').trim().split(/\s+/)[0]
   const manifest=githubUpdateManifest({kind:'eduwork-windows-release',passed:true,version,edition:name,distribution,shell:'electron',platform:'windows-x64',asset:{name:zip.split(/[\\/]/).at(-1),bytes:readFileSync(zip).length,sha256:hash}},'ecnu/'+name)
   assert.equal(manifest.artifacts[0].sha256,hash)
  }
 }
})
