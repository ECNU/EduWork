import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startIsolatedHost} from './host-process.mjs'
const host=await startIsolatedHost()
try {
  const base=new URL(host.launch).origin,exchange=await fetch(host.launch,{redirect:'manual'})
  const cookie=exchange.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  assert.ok(cookie);assert.equal((await fetch(base,{headers:{cookie}})).status,200)
  const method='knowledgeStudio/listCapabilities'
  const response=await fetch(base+'/api/'+method,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'studio-smoke',method,payload:{args:{}}})})
  const envelope=await response.json();assert.equal(response.status,200);assert.equal(envelope.result.ok,true,JSON.stringify(envelope));assert.equal(envelope.result.value.length,8)
  const dsh=JSON.parse(await readFile(resolve(process.env.STUDIO_TEST_DSH_RUNTIME||'.','node_modules/@deepseek-ai/dsh/package.json'),'utf8')).version
  const result={passed:true,dsh,capabilities:8,authenticatedPage:200,externalModelCalls:false,isolatedHome:true}
  const directory=resolve(process.env.STUDIO_HOST_OUTPUT||'dist/host')
  await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
} finally {await host.stop()}
