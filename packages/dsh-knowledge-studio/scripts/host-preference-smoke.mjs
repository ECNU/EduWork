import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {startIsolatedHost} from './host-process.mjs'

let host=await startIsolatedHost()
const directory=resolve(process.env.STUDIO_PREFERENCE_OUTPUT||'dist/host-preferences');await mkdir(directory,{recursive:true})
async function connection(host) {
  const base=new URL(host.launch).origin,response=await fetch(host.launch,{redirect:'manual'})
  const cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
  return async(method,args={})=>{
    const result=await fetch(base+'/api/knowledgeStudio/'+method,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'preference-smoke',method:'knowledgeStudio/'+method,payload:{args}})})
    const envelope=await result.json();assert.equal(envelope.result.ok,true,JSON.stringify(envelope));return envelope.result.value
  }
}
try {
 const rpc=await connection(host);assert.deepEqual(await rpc('readUIPreferences'),{open:false})
 await rpc('setUIOpenPreference',{open:true})
 const firstPort=host.port,home=host.home;await host.stop();host=await startIsolatedHost({reuseHome:home})
 const restarted=await connection(host);assert.deepEqual(await restarted('readUIPreferences'),{open:true})
 await restarted('setUIOpenPreference',{open:false});await host.stop();host=await startIsolatedHost({reuseHome:home})
 assert.deepEqual(await (await connection(host))('readUIPreferences'),{open:false})
 await writeFile(join(directory,'result.json'),JSON.stringify({passed:true,firstPort,lastPort:host.port,hostRestarts:2,newAuthSessions:3,explicitOpenAndClosedPreserved:true},null,2))
 console.log('Real Host restart and new authentication sessions preserve explicit Studio preference')
}finally{await host.stop()}
