import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pickImportDirectory} from '../lib/directory-picker.js'

test('Go owns its modal directory dialog; Electron and Web use official uiWorkspace', async()=>{
  const unexpected=()=>{throw Error('wrong picker')}
  assert.equal(await pickImportDirectory({pickDirectory:unexpected},{PickDirectory:async()=> 'C:\\旧版 目录'}),'C:\\旧版 目录')
  assert.equal(await pickImportDirectory({pickDirectory:async()=> '/old-client'},{}),'/old-client')
})
test('cancel has one null contract and picker failures do not open another dialog',async()=>{
  assert.equal(await pickImportDirectory({}, {PickDirectory:async()=> ''}),null)
  assert.equal(await pickImportDirectory({pickDirectory:async()=> null},{}),null)
  await assert.rejects(pickImportDirectory({pickDirectory:()=>assert.fail('unexpected fallback')},{PickDirectory:async()=>{throw Error('native failure')}}),/native failure/)
})
