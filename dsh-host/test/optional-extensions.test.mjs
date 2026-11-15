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
