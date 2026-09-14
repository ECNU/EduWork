import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFile,realpath,mkdir,writeFile} from 'node:fs/promises'
import {resolve,relative,isAbsolute,join,dirname} from 'node:path'
import {createHash} from 'node:crypto'
assert.ok(process.env.STUDIO_TEST_DSH_RUNTIME,'An exact runtime is required')
const runtime=await realpath(process.env.STUDIO_TEST_DSH_RUNTIME)
const receipt=JSON.parse(await readFile(join(runtime,'.chatecnu-dsh-runtime.json'),'utf8'))
assert.equal(receipt.dshVersion,'0.1.5-rc.1')
assert.equal(receipt.dshCommit,'183f08e9c6dde7e36cd2318eaee70b0da08fb35e')
const installLockSHA256=createHash('sha256').update(await readFile(join(runtime,'.chatecnu-dsh-source-install-lock.json'))).digest('hex')
assert.equal(installLockSHA256,receipt.sourceInstallLockSHA256)
const resolutions=[]
for(const importer of ['package.json','packages/artifact-services/package.json']){
 const require=createRequire(resolve(importer))
 for(const name of ['cordis','schemastery','dsh-tools','dsh-llm','dsh-home-paths','dsh-typert-protocol','dsh-session']){
  const entry=await realpath(require.resolve('@deepseek-ai/'+name)),rel=relative(runtime,entry)
  assert.ok(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'),'Mixed DSH dependency: '+name+' from '+importer)
  let directory=dirname(entry),manifest
  for(;;){try{manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(manifest.name==='@deepseek-ai/'+name)break}catch{}const parent=dirname(directory);assert.notEqual(parent,directory);directory=parent}
  if(name==='dsh'||name.startsWith('dsh-'))assert.equal(manifest.version,'0.1.5-rc.1')
  resolutions.push({importer,name:manifest.name,version:manifest.version,entry})
 }
}
const directory=resolve(process.env.STUDIO_RUNTIME_EVIDENCE||'dist/rc-20260910');await mkdir(directory,{recursive:true})
await writeFile(join(directory,'dependency-resolution.json'),JSON.stringify({passed:true,runtime,commit:receipt.dshCommit,installLockSHA256,packManifestSHA256:receipt.packManifestSHA256,resolutions},null,2))
console.log('Both packages resolve all DSH imports to the same verified rc runtime')
