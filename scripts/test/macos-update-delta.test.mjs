import test from 'node:test'
import assert from 'node:assert/strict'
import { deltaName } from '../macos-update-delta.mjs'

test('delta file names identify the release and the version they patch',()=>{
  assert.equal(deltaName('EduWork','0.4.4','0.4.3'),'EduWork-0.4.4-macos-arm64-electron-from-0.4.3.delta')
  assert.throws(()=>deltaName('EduWork','0.4.4','../0.4.3'))
})
