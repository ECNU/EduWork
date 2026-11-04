import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeNativeProfile } from '../native-profile.mjs'
const json = async path => JSON.parse(await readFile(path, 'utf8'))
async function fixture(t) {
  const profile = await mkdtemp(join(tmpdir(), 'extension-policy-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  return { profile, manifest: join(profile, 'package.json'), generated: join(profile, 'node_modules/@eduwork/generated-profile/cordis.patch.yml'), preferences: join(profile, 'cordis.patch.yml') }
}
for (const enabled of [true, false]) test(`entry initial default ${enabled} survives a policy change while native user choice takes priority`, async t => {
  const f = await fixture(t), id = 'enterprise-oidc'
  const options = { profile: f.profile, bundles: [], patches: [{ insert: [{ id, name: '@eduwork/dsh-oidc', config: { backend: 'desktop' } }] }], optionalEntryDefaults: { [id]: enabled } }
  await writeNativeProfile(options)
  assert.equal((await json(f.generated))[0].insert[0].disabled, !enabled)
  const preference = JSON.stringify([{ id, disabled: enabled, config: { backend: 'desktop', custom: true } }])
  await writeFile(f.preferences, preference)
  await writeNativeProfile({ ...options, optionalEntryDefaults: { [id]: !enabled } })
  assert.equal((await json(f.generated))[0].insert[0].disabled, !enabled)
  assert.equal(await readFile(f.preferences, 'utf8'), preference)
  assert.equal((await json(f.manifest)).eduwork.optionalEntryDefaults[id], enabled)
})
test('adopting existing product entries preserves current defaults and does not seed entries absent on this platform', async t => {
  const f = await fixture(t), id = 'dsh-knowledge-studio'
  const options = { profile: f.profile, bundles: [], patches: [{ insert: [{ id, name: '@eduwork/dsh-knowledge-studio' }] }] }
  await writeNativeProfile(options)
  await writeNativeProfile({ ...options, optionalEntryDefaults: { [id]: false, 'eduwork-desktop-pet': false } })
  assert.equal((await json(f.generated))[0].insert[0].disabled, false)
  assert.deepEqual((await json(f.manifest)).eduwork.optionalEntryDefaults, { [id]: true })
})
for (const name of ['mail', 'literature']) for (const previous of ['fresh', 'enabled', 'disabled']) test(`${name} adopts existing bundle selection (${previous}) and stays user-controlled`, async t => {
  const f = await fixture(t), bundle = '@eduwork/dsh-' + name
  if (previous !== 'fresh') await writeFile(f.manifest, JSON.stringify({ dsh: { profile: { bundles: previous === 'enabled' ? [bundle] : [] } } }))
  const options = { profile: f.profile, bundles: [bundle], optionalBundles: [bundle], patches: [] }
  await writeNativeProfile(options)
  let saved = await json(f.manifest)
  assert.equal(saved.dsh.profile.bundles.includes(bundle), previous !== 'disabled')
  saved.dsh.profile.bundles = saved.dsh.profile.bundles.filter(name => name !== bundle)
  await writeFile(f.manifest, JSON.stringify(saved))
  await writeNativeProfile(options)
  assert.ok(!(await json(f.manifest)).dsh.profile.bundles.includes(bundle))
})
