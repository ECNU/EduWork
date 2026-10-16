import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deltaBaseArchives, previousStableArchives } from '../update-delta-bases.mjs'

const release=(version,{draft=false,prerelease=false,tag=`v${version}`,digest=true}={})=>({tag_name:tag,draft,prerelease,assets:['windows-x64','macos-arm64'].map(platform=>({
  name:`EduWork-${version}-${platform}-electron.zip`,
  browser_download_url:`https://github.com/ECNU/EduWork/releases/download/${tag}/EduWork-${version}-${platform}-electron.zip`,
  digest:digest?`sha256:${version.replace(/\D/g,'').padStart(64,platform==='windows-x64'?'1':'0')}`:null,
}))})
test('patches come from the three latest earlier stable releases of the same platform',()=>{
  const releases=[release('0.4.12'),release('0.4.11',{draft:true}),release('0.4.10'),release('0.4.10-alpha.1',{prerelease:true}),release('0.4.2'),release('0.4.9'),release('0.4.1'),release('0.3.6-dev.20260921.2',{prerelease:true,tag:'macos-v0.3.6-dev.20260921.2'})]
  const archives=previousStableArchives(releases,{product:'EduWork',version:'0.4.11',platform:'macos'})
  assert.deepEqual(archives.map(archive=>archive.name),['EduWork-0.4.10-macos-arm64-electron.zip','EduWork-0.4.9-macos-arm64-electron.zip','EduWork-0.4.2-macos-arm64-electron.zip'])
  assert.deepEqual(archives[0],{name:'EduWork-0.4.10-macos-arm64-electron.zip',url:'https://github.com/ECNU/EduWork/releases/download/v0.4.10/EduWork-0.4.10-macos-arm64-electron.zip',sha256:'0410'.padStart(64,'0')})
  assert.deepEqual(previousStableArchives(releases,{product:'EduWork',version:'0.4.11',platform:'windows'})[0],{name:'EduWork-0.4.10-windows-x64-electron.zip',url:'https://github.com/ECNU/EduWork/releases/download/v0.4.10/EduWork-0.4.10-windows-x64-electron.zip',sha256:'0410'.padStart(64,'1')})
  assert.deepEqual(previousStableArchives(releases,{product:'EduWork',version:'0.4.12-dev.20261020.1',platform:'macos'}),[])
  assert.deepEqual(previousStableArchives(releases,{product:'EduWork',version:'0.4.1',platform:'windows'}),[])
  assert.throws(()=>previousStableArchives([release('0.4.3',{digest:false})],{product:'EduWork',version:'0.4.4',platform:'windows'}),/0\.4\.3 has no windows archive/)
})
test('the build patches every downloaded archive of a stable release',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'eduwork-delta-bases-'));t.after(()=>rm(directory,{recursive:true,force:true}))
  for(const name of ['EduWork-0.4.3-windows-x64-electron.zip','EduWork-0.4.2-windows-x64-electron.zip','notes.txt'])await writeFile(join(directory,name),'')
  assert.deepEqual(await deltaBaseArchives(directory,'0.4.4'),['EduWork-0.4.2-windows-x64-electron.zip','EduWork-0.4.3-windows-x64-electron.zip'].map(name=>join(directory,name)))
  assert.deepEqual(await deltaBaseArchives('','0.4.4'),[])
  await assert.rejects(deltaBaseArchives(directory,'0.4.4-dev.20261015.1'),/stable releases only/)
})
