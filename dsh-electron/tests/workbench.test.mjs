import test from 'node:test'
import assert from 'node:assert/strict'
import { startNativeBridge } from '../src/native-vault.mjs'
test('workbench bridge allows only authenticated fixed actions and no renderer-owned paths', async () => {
  const calls=[]
  const bridge=await startNativeBridge({vault:{flush:async()=>{}},workbench:async action=>{calls.push(action);return {shell:'electron',phase:'ready',message:'synthetic'}}})
  const {baseURL,token}=bridge.bootstrap.nativeBridge
  const call=(body,headers={})=>fetch(baseURL+'/v1/extensions/workbench',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...headers},body:JSON.stringify(body)})
  try {
    assert.equal((await call({action:'status'},{origin:'https://example.org'})).status,403)
    assert.equal((await call({action:'status'},{authorization:'Bearer wrong'})).status,403)
    assert.equal((await call({action:'status',path:'unowned'})).status,400)
    assert.equal((await call({action:'execute'})).status,400)
    assert.equal((await call({action:'status'})).status,200)
    assert.equal((await call({action:'download-content-update'})).status,200)
    assert.equal((await call({action:'restart-content-update'})).status,200)
    assert.deepEqual(calls,['status','download-content-update','restart-content-update'])
  } finally { await bridge.close() }
})
