import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openConfigurationFile } from '../src/configuration-files.mjs'
import { startNativeBridge } from '../src/native-vault.mjs'
test('configuration buttons open only host-selected paths through authenticated bridge', async () => {
 const root=await mkdtemp(join(tmpdir(),'eduwork-config-open-')), config=join(root,'中文 空格.jsonc'), opened=[]
 await writeFile(config,'{}');await mkdir(join(root,'examples'))
 const bridge=await startNativeBridge({vault:{flush:async()=>{}},openConfiguration:target=>openConfigurationFile(config,target,async path=>{opened.push(path);return ''})})
 try {
  const {baseURL,token}=bridge.bootstrap.nativeBridge
  const call=(body,authorization='Bearer '+token)=>fetch(baseURL+'/v1/extensions/open-configuration',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)})
  assert.equal((await call({target:'config'})).status,204)
  assert.equal((await call({target:'examples'})).status,204)
  for(const body of [{target:'../other'},{target:'config',path:'C:/other'}])assert.equal((await call(body)).status,400)
  assert.equal((await call({target:'config'},'Bearer wrong')).status,403)
  assert.deepEqual(opened,[config,join(root,'examples')])
  await assert.rejects(openConfigurationFile(config,'other',()=>{}))
  await assert.rejects(openConfigurationFile(config,'config',async()=> 'Editor unavailable'),/Editor unavailable/)
 }finally{await bridge.close()}
})
