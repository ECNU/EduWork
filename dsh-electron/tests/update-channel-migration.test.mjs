import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { migrateUpdateChannel, usesStableDefault } from '../src/update-channel-migration.mjs'

async function fixture(t, saved) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'eduwork-channel-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  await mkdir(join(dataRoot, 'state'))
  const preferences = join(dataRoot, 'state/update-preferences.json')
  if (saved) await writeFile(preferences, JSON.stringify(saved))
  return { dataRoot, preferences, version: '0.4.0', fallback: 'development' }
}
for (const [label, source, policy, expected] of [
  ['new', null, null, 'stable'],
  ['old default', 'packaged-default', 'development', 'stable'],
  ['unknown provenance', undefined, 'development', 'stable'],
  ['explicit dev', 'user', 'development', 'development'],
  ['explicit stable', 'user', 'stable', 'stable'],
]) test(`0.4.0 channel: ${label}`, async t => {
  const f = await fixture(t, policy && { schemaVersion: 1, policy, source })
  assert.equal(await migrateUpdateChannel(f), expected)
  const receipt = JSON.parse(await readFile(join(f.dataRoot, 'state/update-channel-040.json')))
  assert.equal(receipt.state, 'complete')
  // Future user choices survive; the one-time receipt is independent of prefs.
  await writeFile(f.preferences, JSON.stringify({ schemaVersion: 1, policy: 'development', source: 'user' }))
  assert.equal(await migrateUpdateChannel({ ...f, version: '0.4.1' }), 'development')
})
test('interrupted migration resumes before or after atomic preferences commit', async t => {
  const before = { schemaVersion: 1, policy: 'development', source: 'packaged-default' }
  const after = { schemaVersion: 1, policy: 'stable', source: 'packaged-default' }
  for (const saved of [before, after]) {
    const f = await fixture(t, saved)
    await writeFile(join(f.dataRoot, 'state/update-channel-040.json'), JSON.stringify({ schemaVersion: 1, state: 'pending', before, after }))
    assert.equal(await migrateUpdateChannel(f), 'stable')
  }
})
test('invalid preferences fail without replacement; old versions retain prior defaults', async t => {
  const f = await fixture(t, { schemaVersion: 1, policy: 'invalid' })
  const original = await readFile(f.preferences, 'utf8')
  await assert.rejects(migrateUpdateChannel(f), /原文件已保留/)
  assert.equal(await readFile(f.preferences, 'utf8'), original)
  const old = await fixture(t, { schemaVersion: 1, policy: 'development' })
  assert.equal(await migrateUpdateChannel({ ...old, version: '0.3.6' }), 'development')
})

test('prereleases do not migrate preferences or consume the future stable migration receipt', async t => {
  for (const version of ['0.4.0-alpha.1','0.4.0-beta.1','0.4.0-rc.1','0.4.0-dev.20260929.1','1.0.0-alpha.1']) {
    assert.equal(usesStableDefault(version), false)
    for (const source of ['user','packaged-default']) {
      const f = await fixture(t, {schemaVersion:1, policy:'development', source})
      const before = await readFile(f.preferences,'utf8')
      assert.equal(await migrateUpdateChannel({...f,version}), 'development')
      assert.equal(await readFile(f.preferences,'utf8'), before)
      await assert.rejects(readFile(join(f.dataRoot,'state/update-channel-040.json')), {code:'ENOENT'})
      assert.equal(await migrateUpdateChannel(f), source === 'user' ? 'development' : 'stable')
    }
  }
  assert.equal(usesStableDefault('0.4.0'), true)
  assert.equal(usesStableDefault('1.0.0'), true)
})
