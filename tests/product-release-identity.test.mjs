import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyProductReleaseIdentity } from '../scripts/verify-product-release-identity.mjs'

async function fixture(t, badges, version='0.4.11', dshVersion='0.2.2-rc.1') {
  const product=await mkdtemp(join(tmpdir(),'eduwork-release-identity-'))
  t.after(()=>rm(product,{recursive:true,force:true}))
  const client=join(product,'d/node_modules/@chatecnu-work/dsh-client-ui-conversation-brand/lib')
  await mkdir(client,{recursive:true})
  await writeFile(join(product,'assembly.json'),JSON.stringify({version,dshVersion}))
  await writeFile(join(client,'client.js'),badges.map(value=>JSON.stringify({'hero.preview':value})).join('\n'))
  return product
}

test('release badges tolerate the additional upstream locale dictionaries', async t=>{
  const extras=['プレビュー','Vista previa','Aperçu','Vorschau','Предварительный просмотр','Visualização']
  const product=await fixture(t,['公测版','PUBLIC BETA',...extras])
  assert.equal((await verifyProductReleaseIdentity(product,'0.4.11')).stage,'public-beta')
})

test('development and stable badges remain valid with two or more dictionaries',async t=>{
  for(const [version,dshVersion,badges,stage] of [
    ['0.4.11-dev.20261105.1','0.2.2-rc.1',['开发版','DEV','Aperçu'],'development'],
    ['0.4.11','0.2.2',['正式版','RELEASE'],'stable'],
  ]) {
    const product=await fixture(t,badges,version,dshVersion)
    assert.equal((await verifyProductReleaseIdentity(product,version)).stage,stage)
  }
})

test('additional languages cannot hide missing, stale or duplicated product badges',async t=>{
  for(const badges of [
    ['开发版','DEV','Aperçu'],
    ['公测版','DEV','Aperçu'],
    ['PUBLIC BETA','Aperçu'],
    ['公测版','PUBLIC BETA','PUBLIC BETA'],
    ['公测版','公测版','PUBLIC BETA'],
  ]) {
    const product=await fixture(t,badges)
    await assert.rejects(verifyProductReleaseIdentity(product,'0.4.11'),/Product badge differs/)
  }
})

test('assembled product version still has to match the requested release',async t=>{
  const product=await fixture(t,['公测版','PUBLIC BETA','Aperçu'])
  await assert.rejects(verifyProductReleaseIdentity(product,'0.4.12'),/Desktop version differs/)
})
