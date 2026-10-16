import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleVersion, validateMacUpdateConfig, appcast } from '../macos-update-feed.mjs'
import { deltaName } from '../macos-update-delta.mjs'
test('release feed uses the same prerelease-safe bundle version as assembly',()=>{
  assert.equal(bundleVersion('0.3.6-dev.20260920.2'),'0.3.6dev20260920.2')
  assert.equal(bundleVersion('0.3.6'),'0.3.6')
  assert.equal(bundleVersion('0.4.0-alpha.1'),'0.4.0alpha1')
  assert.equal(bundleVersion('0.4.0-beta.2'),'0.4.0beta2')
  assert.equal(bundleVersion('0.4.0-rc.1'),'0.4.0rc1')
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
test('delta updates follow the full archive and name the bundle version they patch',()=>{
  const signature=Buffer.alloc(64).toString('base64'),patch={from:'0.4.3',url:'https://example.org/v0.4.4/app-from-0.4.3.delta',bytes:2,signature}
  const content=appcast({version:'0.4.4',url:'https://example.org/v0.4.4/app.zip',bytes:10,signature,deltas:[patch,{...patch,from:'0.4.4-dev.20261015.1'}]})
  assert.match(content,/<enclosure url="https:\/\/example\.org\/v0\.4\.4\/app\.zip" length="10" type="application\/octet-stream" sparkle:edSignature="[^"]+"\/><sparkle:deltas><enclosure url="https:\/\/example\.org\/v0\.4\.4\/app-from-0\.4\.3\.delta" length="2" type="application\/octet-stream" sparkle:deltaFrom="0\.4\.3" sparkle:edSignature="[^"]+"\/><enclosure [^>]*sparkle:deltaFrom="0\.4\.4dev20261015\.1"[^>]*\/><\/sparkle:deltas><\/item>/)
  assert.doesNotMatch(appcast({version:'0.4.4',url:'https://example.org/v0.4.4/app.zip',bytes:10,signature}),/sparkle:deltas/)
  assert.throws(()=>appcast({version:'0.4.4',url:'https://example.org/v0.4.4/app.zip',bytes:10,signature,deltas:[{...patch,url:'http://example.org/app.delta'}]}),/fixed HTTPS/)
})
test('signing checks each delta update against the receipt and signs it beside the archive',async t=>{
  const root=await mkdtemp(join(tmpdir(),'eduwork-mac-feed-'));t.after(()=>rm(root,{recursive:true,force:true}))
  const hash=value=>createHash('sha256').update(value).digest('hex'),{publicKey,privateKey}=generateKeyPairSync('ed25519')
  const archive=join(root,'EduWork-0.4.4-macos-arm64-electron.zip'),name=deltaName('EduWork','0.4.4','0.4.3')
  await writeFile(archive,'full archive');await writeFile(join(root,name),'patch')
  await writeFile(join(root,'receipt.json'),JSON.stringify({version:'0.4.4',edition:'EduWork',softwareAutoUpdate:true,bundleVersion:'0.4.4',asset:{sha256:hash('full archive')},deltas:[{from:'0.4.3',name,bytes:5,sha256:hash('patch')}]}))
  await writeFile(join(root,'config.json'),JSON.stringify({schemaVersion:1,feeds:{stable:'https://example.org/stable.xml',development:'https://example.org/dev.xml'},publicEDKey:publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')}))
  await writeFile(join(root,'key.pem'),privateKey.export({format:'pem',type:'pkcs8'}))
  const signFeed=output=>execFileSync(process.execPath,[fileURLToPath(new URL('../macos-update-feed.mjs',import.meta.url)),'sign',archive,join(root,'receipt.json'),join(root,'config.json'),join(root,'key.pem'),'https://example.org/v0.4.4/EduWork-0.4.4-macos-arm64-electron.zip',join(root,output)],{stdio:'pipe'})
  signFeed('appcast.xml')
  const [,url,from,signature]=/<sparkle:deltas><enclosure url="([^"]+)"[^>]* sparkle:deltaFrom="([^"]+)" sparkle:edSignature="([^"]+)"/.exec(await readFile(join(root,'appcast.xml'),'utf8'))
  assert.equal(url,`https://example.org/v0.4.4/${name}`)
  assert.equal(from,'0.4.3')
  assert.ok(verify(null,Buffer.from('patch'),publicKey,Buffer.from(signature,'base64')))
  await writeFile(join(root,name),'changed')
  assert.throws(()=>signFeed('changed.xml'),/Delta update does not match the verified Sparkle receipt/)
})
