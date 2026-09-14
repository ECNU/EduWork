import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseIdentity, versionParts } from '../release-policy.mjs'
import { compareVersions } from '../desktop-updates.mjs'
import { verifyProductReleaseIdentity } from '../../scripts/verify-product-release-identity.mjs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('published EduWork on an upstream RC is public beta, development stays distinct', () => {
  assert.equal(releaseIdentity('0.3.0', '0.1.5-rc.1').badge.zh, '公测版')
  assert.equal(releaseIdentity('0.3.0-dev.20260911.1', '0.1.5-rc.1').publishable, false)
  assert.equal(releaseIdentity('0.3.0-rc.4', '0.1.5-rc.1').badge.zh, '开发版')
  assert.equal(releaseIdentity('0.4.0', '0.1.5').badge.zh, '正式版')
})

test('assembling a developer shell with stale public badge resources is refused', async t=>{
  const product=await mkdtemp(join(tmpdir(),'eduwork-badge-'));t.after(()=>rm(product,{recursive:true,force:true}))
  const directory=join(product,'d/node_modules/@chatecnu-work/dsh-client-ui-conversation-brand/lib')
  await mkdir(directory,{recursive:true})
  await writeFile(join(product,'assembly.json'),JSON.stringify({version:'0.3.5-dev.20260912.1',dshVersion:'0.1.5-rc.2'}))
  const client=join(directory,'client.js')
  await writeFile(client,'{"hero.preview": "公测版"}\n{"hero.preview": "PUBLIC BETA"}')
  await assert.rejects(verifyProductReleaseIdentity(product,'0.3.5-dev.20260912.1'),/badge differs/)
  await writeFile(client,'{"hero.preview": "开发版"}\n{"hero.preview": "DEV"}')
  assert.equal((await verifyProductReleaseIdentity(product,'0.3.5-dev.20260912.1')).stage,'development')
  await assert.rejects(verifyProductReleaseIdentity(product,'0.3.5'),/version differs/)
})
test('the first public release upgrades every previously shipped version scheme', () => {
  const route=['0.2.0-dev.20260909.3','0.3.3','0.3.4','0.3.5-dev.20260912.1','0.3.5-dev.20260912.2','0.3.5','0.3.6-dev.20260913.1','0.3.6']
  for(let i=1;i<route.length;i++)assert.equal(compareVersions(route[i],route[i-1]),1)
  for (const previous of ['0.2.0-dev.20260909.3','0.2.0','0.3.0-dev.20260910.4','0.3.0-rc.1','0.3.0-rc.4']) {
    assert.equal(compareVersions('0.3.0', previous), 1, previous)
  }
  assert.equal(compareVersions('0.3.1', '0.3.1-dev.20260912.10'), 1)
  assert.equal(compareVersions('0.3.1-dev.20260912.10', '0.3.1-dev.20260912.2'), 1)
  for (const invalid of ['01.3.0','0.3.0-dev..1','0.3.0-dev.01','0.3.0+']) assert.throws(()=>versionParts(invalid))
})
