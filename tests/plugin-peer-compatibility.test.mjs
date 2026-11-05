import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {packages} from '../scripts/packages/catalog.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const runtime=process.env.EDUWORK_TEST_RUNTIME
test('independent plugins accept every declared peer supplied by the selected Host', {skip:!runtime}, async()=>{
  const require=createRequire(join(runtime,'package.json'))
  const {satisfies}=require('semver')
  let checked=0
  for(const entry of packages){
    const manifest=JSON.parse(await readFile(join(root,entry.directory,'package.json'),'utf8'))
    for(const [name,range] of Object.entries(manifest.peerDependencies??{})){
      const hostPackage=await readFile(join(runtime,'node_modules',name,'package.json'),'utf8').then(JSON.parse).catch(error=>{
        if(error.code==='ENOENT')return undefined
        throw error
      })
      // Packages not shipped by the Runtime (e.g. optional Codex/ACP providers)
      // are qualified with their product assembly, rather than invented here.
      if(!hostPackage)continue
      assert.ok(satisfies(hostPackage.version,range),`${manifest.name} rejects Host ${name}@${hostPackage.version}: ${range}`)
      checked++
    }
  }
  assert.ok(checked>30,'Expected an installed Host with actual shared dependencies')
})
