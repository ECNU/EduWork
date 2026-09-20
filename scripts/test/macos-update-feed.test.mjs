import test from 'node:test'
import assert from 'node:assert/strict'
import { bundleVersion, validateMacUpdateConfig, appcast } from '../macos-update-feed.mjs'
test('release feed uses the same prerelease-safe bundle version as assembly',()=>{
  assert.equal(bundleVersion('0.3.6-dev.20260920.2'),'0.3.6dev20260920.2')
  assert.equal(bundleVersion('0.3.6'),'0.3.6')
  assert.throws(()=>bundleVersion('0.3.6-preview'))
  const content=appcast({version:'0.3.6-dev.20260920.2',url:'https://example.org/app.zip',bytes:10,signature:Buffer.alloc(64).toString('base64')})
  assert.match(content,/<sparkle:version>0.3.6dev20260920.2<\/sparkle:version>/)
})
test('the packaged feed descriptor pins both HTTPS channels and its signing key',()=>{
  const raw={schemaVersion:1,feeds:{stable:'https://example.org/stable.xml',development:'https://example.org/dev.xml'},publicEDKey:Buffer.alloc(32).toString('base64')}
  assert.equal(validateMacUpdateConfig(raw),raw)
  assert.throws(()=>validateMacUpdateConfig({...raw,feeds:{stable:raw.feeds.stable}}))
  assert.throws(()=>validateMacUpdateConfig({...raw,feeds:{...raw.feeds,development:'http://example.org/dev.xml'}}))
})
