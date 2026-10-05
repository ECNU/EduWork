import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { migrateAlphaUpdates } from '../src/alpha-update-migration.mjs'
import { migrateUpdateChannel } from '../src/update-channel-migration.mjs'
import { loadUserConfig } from '../../dsh-host/user-config.mjs'
import { editablePortableUpdateConfiguration } from '../src/portable-updates.mjs'
import { editableMacUpdateConfiguration } from '../src/mac-sparkle-updates.mjs'
import { readPublisherBootstrap } from '../../dsh-host/publisher-bootstrap.mjs'

async function fixture(t, updates = { provider: 'disabled' }, preference) {
  const root = await mkdtemp(join(tmpdir(), 'alpha-update-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dataRoot = join(root, 'data'), logs = join(dataRoot, 'logs'), config = join(root, 'eduwork.jsonc')
  await mkdir(logs, { recursive: true }); await mkdir(join(dataRoot, 'state'))
  await writeFile(join(logs, 'desktop-start.json'), JSON.stringify({ productVersion: '0.3.6-dev.20260928.2', dshVersion: '0.1.7-rc.2' }))
  await writeFile(config, JSON.stringify({ schemaVersion: 1, updates }) + '\n')
  if (preference) await writeFile(join(dataRoot, 'state/update-preferences.json'), JSON.stringify(preference))
  const policy = await migrateUpdateChannel({ dataRoot, version: '0.4.0' })
  return { dataRoot, logs, config, policy, platform: 'win32', version: '0.4.0', defaults: { provider: 'github', repository: 'ECNU/EduWork' } }
}

test('old Alpha selection enables both software routes without changing explicit dev policy', async t => {
  const input = await fixture(t, undefined, { schemaVersion: 1, source: 'user', policy: 'development' })
  let prompts = 0
  await migrateAlphaUpdates({ ...input, choose: async ({ policy }) => { assert.equal(policy, 'development'); prompts++; return 'enable' } })
  const updates = loadUserConfig(input.config).updates
  assert.equal(editablePortableUpdateConfiguration({ updates, version: '0.4.0' }).provider, 'github')
  assert.equal(editableMacUpdateConfiguration({ updates, version: '0.4.0' }).provider, 'github')
  assert.equal(updates.defaultPolicy, 'development')
  const original = JSON.parse(await readFile(join(input.dataRoot, 'state/alpha-updates-040.previous.jsonc'), 'utf8'))
  assert.deepEqual(original.updates, { provider: 'disabled' })
  await migrateAlphaUpdates({ ...input, choose: assert.fail }); assert.equal(prompts, 1)
})

test('dismiss or decline keeps disabled, records once, and inherits stable', async t => {
  const input = await fixture(t)
  await migrateAlphaUpdates({ ...input, choose: async () => undefined })
  assert.equal(input.policy, 'stable')
  assert.equal(loadUserConfig(input.config).updates.provider, 'disabled')
  await migrateAlphaUpdates({ ...input, choose: assert.fail })
})

for (const dshVersion of ['0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.3', '0.2.0', '0.2.1']) test(`stable migration recognizes Alpha running ${dshVersion}`, async t => {
  const input = await fixture(t)
  await writeFile(join(input.logs, 'desktop-start.json'), JSON.stringify({ productVersion: '0.4.0-alpha.4', dshVersion }))
  let prompts = 0
  await migrateAlphaUpdates({ ...input, choose: async () => { prompts++; return 'enable' } })
  assert.equal(prompts, 1)
  assert.equal(loadUserConfig(input.config).updates.provider, 'github')
})

for (const dshVersion of ['0.3.0-alpha.1', '0.3.0', 'bad', '0.2.0-rc.01']) test(`migration does not infer permission from ${dshVersion}`, async t => {
  const input = await fixture(t)
  await writeFile(join(input.logs, 'desktop-start.json'), JSON.stringify({ productVersion: '0.4.0-alpha.4', dshVersion }))
  await migrateAlphaUpdates({ ...input, choose: assert.fail })
  assert.equal(loadUserConfig(input.config).updates.provider, 'disabled')
})

test('institution route and unknown origin are never silently replaced', async t => {
  const input = await fixture(t, { provider: 'disabled', manifestURL: 'https://example.org/updates/stable/latest-windows-amd64.json' })
  await migrateAlphaUpdates({ ...input, choose: assert.fail })
  assert.equal(loadUserConfig(input.config).updates.manifestURL, 'https://example.org/updates/stable/latest-windows-amd64.json')
  await rm(join(input.logs, 'desktop-start.json'))
  await migrateAlphaUpdates({ ...input, choose: assert.fail })
})

test('pending choice resumes after interruption, with user edits preserved', async t => {
  const input = await fixture(t)
  await migrateAlphaUpdates({ ...input, choose: async () => 'enable' })
  const path = join(input.dataRoot, 'state/alpha-updates-040.json')
  const receipt = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...receipt, state: 'pending' }))
  await writeFile(input.config, '{"schemaVersion":1,"updates":{"provider":"disabled","repository":"example/custom"}}\n')
  await migrateAlphaUpdates({ ...input, choose: assert.fail })
  assert.equal(loadUserConfig(input.config).updates.repository, 'example/custom')
  assert.equal(JSON.parse(await readFile(path, 'utf8')).state, 'complete')
})

for (const policy of ['stable', 'development']) test(`Mac Alpha uses its packaged ${policy} appcast and retains the selected channel`, async t => {
  const input = await fixture(t, undefined, { schemaVersion: 1, source: 'user', policy })
  const macFeeds = { stable: 'https://updates.example.org/stable.xml', development: 'https://updates.example.org/dev.xml' }
  await migrateAlphaUpdates({ ...input, platform: 'darwin', defaults: { macFeeds }, choose: async () => 'enable' })
  const updates = loadUserConfig(input.config).updates
  assert.notEqual(updates.provider, 'disabled')
  assert.equal(updates.defaultPolicy, policy)
  assert.deepEqual(updates.macFeeds, macFeeds)
  await migrateAlphaUpdates({ ...input, platform: 'darwin', choose: assert.fail })
})

test('Mac Alpha without an appcast for the chosen channel remains untouched', async t => {
  const input = await fixture(t)
  await migrateAlphaUpdates({ ...input, platform: 'darwin', defaults: { macFeeds: { development: 'https://updates.example.org/dev.xml' } }, choose: assert.fail })
  assert.equal(loadUserConfig(input.config).updates.provider, 'disabled')
})

test('publisher Alpha restores the trusted institution route rather than the public repository', async t => {
  const input = await fixture(t)
  const product = join(input.dataRoot, 'product'), resources = join(product, 'resources/desktop')
  await mkdir(resources, { recursive: true })
  const updates = { provider: 'static', manifestURL: 'https://updates.example.org/stable/latest-windows-amd64.json' }
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })
  await writeFile(join(resources, 'publisher-bootstrap.win32.json'), JSON.stringify({ schemaVersion: 1, updates,
    contentUpdates: { publisher: 'example', baseURL: 'https://updates.example.org/content', publicKey, configuration: true, bundled: { configuration: 0 } } }))
  const trusted = await readPublisherBootstrap({ ownership: 'publisher', product, platform: 'win32' })
  await migrateAlphaUpdates({ ...input, platform: 'win32', defaults: trusted.updates, choose: async () => 'enable' })
  assert.equal(loadUserConfig(input.config).updates.manifestURL, updates.manifestURL)
  assert.equal(loadUserConfig(input.config).updates.repository, undefined)
  const effective = editablePortableUpdateConfiguration({ updates: loadUserConfig(input.config).updates, version: '0.4.0', distribution: 'example' })
  assert.equal(effective.provider, 'static')
  assert.equal(effective.manifestURL, updates.manifestURL)
})

test('custom legacy bridge routes and release links prevent public-default migration', async t => {
  for (const priorUpdates of [
    { schemaVersion: 1, enabled: true, manifestBaseURL: 'https://updates.example.org/custom' },
    { schemaVersion: 1, enabled: false, provider: 'github', repository: 'example/custom' },
  ]) {
    const input = await fixture(t)
    const before = await readFile(input.config, 'utf8')
    await migrateAlphaUpdates({ ...input, priorUpdates, choose: assert.fail })
    assert.equal(await readFile(input.config, 'utf8'), before)
  }
  const input = await fixture(t, { provider: 'disabled', releasesURL: 'https://updates.example.org/releases' })
  await migrateAlphaUpdates({ ...input, choose: assert.fail })
  assert.equal(loadUserConfig(input.config).updates.releasesURL, 'https://updates.example.org/releases')
})

test('old Mac Alpha with normalized empty feeds can opt into the packaged stable appcast', async t => {
  const input = await fixture(t, {provider:'disabled', defaultPolicy:'development', macFeeds:{}})
  const macFeeds = {stable:'https://updates.example.org/stable.xml'}
  let prompts = 0
  await migrateAlphaUpdates({...input, platform:'darwin', defaults:{macFeeds}, choose:async () => {prompts++; return 'enable'}})
  assert.equal(prompts, 1)
  assert.deepEqual(loadUserConfig(input.config).updates.macFeeds, macFeeds)
  await migrateAlphaUpdates({...input, platform:'darwin', defaults:{macFeeds}, choose:assert.fail})
})

test('known 0.4.0 prereleases retain a one-time update choice on stable upgrade', async t => {
  for (const productVersion of ['0.4.0-alpha.1','0.4.0-beta.1','0.4.0-rc.1','0.4.0-dev.20260929.1']) {
    const input = await fixture(t)
    await writeFile(join(input.logs,'desktop-start.json'), JSON.stringify({productVersion,dshVersion:'0.2.0-rc.1'}))
    let prompts = 0
    await migrateAlphaUpdates({...input, choose:async () => {prompts++; return 'disabled'}})
    assert.equal(prompts, 1, productVersion)
    assert.equal(loadUserConfig(input.config).updates.provider, 'disabled')
    await migrateAlphaUpdates({...input, choose:assert.fail})
  }
})

test('new Alpha detection preserves unknown origins, real Mac feeds and prerelease destinations', async t => {
  for (const prior of [{productVersion:'0.4.0-alpha.1',dshVersion:'9.0.0'}, {productVersion:'0.4.0',dshVersion:'0.2.0-rc.1'}]) {
    const input = await fixture(t)
    await writeFile(join(input.logs,'desktop-start.json'), JSON.stringify(prior))
    await migrateAlphaUpdates({...input, choose:assert.fail})
  }
  const input = await fixture(t, {provider:'disabled',macFeeds:{stable:'https://updates.example.org/custom.xml'}})
  const before = await readFile(input.config,'utf8')
  await migrateAlphaUpdates({...input, platform:'darwin', defaults:{macFeeds:{stable:'https://updates.example.org/packaged.xml'}}, choose:assert.fail})
  assert.equal(await readFile(input.config,'utf8'), before)
  const alpha = await fixture(t)
  await migrateAlphaUpdates({...alpha, version:'0.4.0-alpha.1', choose:assert.fail})
})
