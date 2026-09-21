import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ConfigurationFile, configurationFingerprints, mergeConfiguration, readConfiguration } from '../configuration-file.mjs'
import { loadUserConfig } from '../user-config.mjs'

const scope = 'a'.repeat(64), key = revision => `${revision}-${'b'.repeat(64)}`
const profile = (context = 100) => ({ id: 'school', oidc: { issuer: 'https://production.example.org' }, provider: {
  baseURL: 'https://production.example.org/v1', models: [{ id: 'max', contextWindow: context }, { id: 'plus', contextWindow: context }] } })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-one-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'config'))
  const path = join(root, 'config/eduwork.jsonc'), dataRoot = join(root, 'data')
  const value = { schemaVersion: 1, organizations: [profile()], features: { maxConcurrentRequests: 3 }, updates: { provider: 'disabled' } }
  await writeFile(path, '// My configuration\n' + JSON.stringify(value, null, 2))
  const open = () => new ConfigurationFile(path, dataRoot).open()
  return { root, path, value, open, file: await open(), dataRoot }
}

test('manual UAT edits and per-model settings survive while untouched defaults update', async t => {
  const f = await fixture(t)
  await f.file.apply({ scope, key: key(1), revision: 1, patch: { organizations: [profile()], features: { maxConcurrentRequests: 3 } } }); await f.file.commit()
  const local = (await readConfiguration(f.path)).value
  local.organizations[0].oidc.issuer = 'https://uat.example.org'
  local.organizations[0].provider.baseURL = 'https://uat.example.org/v1'
  local.organizations[0].provider.models[0].contextWindow = 77
  local.organizations.push({ id: 'personal' })
  await writeFile(f.path, '// My UAT configuration\n' + JSON.stringify(local, null, 2))
  const before = await readFile(f.path, 'utf8')
  const conflicts = await f.file.apply({ scope, key: key(2), revision: 2, patch: { organizations: [profile(200)], features: { maxConcurrentRequests: 4 } } })
  const active = loadUserConfig(f.path)
  assert.equal(active.organizations[0].oidc.issuer, 'https://uat.example.org')
  assert.equal(active.organizations[0].provider.baseURL, 'https://uat.example.org/v1')
  assert.equal(active.organizations[0].provider.models[0].contextWindow, 77)
  assert.equal(active.organizations[0].provider.models[1].contextWindow, 200)
  assert.equal(active.organizations[1].id, 'personal')
  assert.equal(active.features.maxConcurrentRequests, 4)
  assert.ok(conflicts.includes('organizations[school].provider.models[max].contextWindow'))
  assert.equal(await readFile(f.file.backup, 'utf8'), before)
  assert.match(await readFile(f.path, 'utf8'), /^\/\/ My UAT configuration/)
  await f.file.commit()
  const edited = (await readFile(f.path, 'utf8')).replace('200', '250')
  await writeFile(f.path, edited)
  await f.file.apply({ scope, key: key(2), revision: 2, patch: { organizations: [profile(200)] } })
  assert.equal(await readFile(f.path, 'utf8'), edited, 'restarting with the same revision never overlays the editable file')
  assert.equal(await readFile(f.file.backup, 'utf8'), before)
  assert.deepEqual((await readdir(join(f.dataRoot, 'configuration'))).filter(name => name.endsWith('.jsonc')), ['eduwork.previous.jsonc'])
})

test('deleted default entries stay deleted and removed unchanged defaults disappear', () => {
  const original = { organizations: [profile(), { id: 'removed', label: 'default' }] }
  const local = { organizations: [{ id: 'removed', label: 'default' }, { id: 'mine' }] }
  const conflicts = [], merged = mergeConfiguration(local, configurationFingerprints(original), { organizations: [profile(200)] }, conflicts)
  assert.deepEqual(merged.organizations, [{ id: 'mine' }])
  assert.ok(conflicts.includes('organizations[school]'))
})

test('interrupted replacement restores the only backup while retaining edits made during the trial', async t => {
  const f = await fixture(t)
  await f.file.apply({ scope, key: key(1), revision: 1, patch: { features: { maxConcurrentRequests: 4 } } })
  const current = (await readConfiguration(f.path)).value
  current.organizations[0].oidc.issuer = 'https://uat.example.org'
  await writeFile(f.path, JSON.stringify(current))
  const recovered = await f.open()
  assert.equal(loadUserConfig(f.path).features.maxConcurrentRequests, 3)
  assert.equal(loadUserConfig(f.path).organizations[0].oidc.issuer, 'https://uat.example.org')
  assert.equal(recovered.state.trial, null)
  assert.equal(recovered.state.defaults, null)
})

test('content commit followed by a crash finishes configuration metadata without rolling back', async t => {
  const f = await fixture(t)
  await f.file.apply({ scope, key: key(1), revision: 1, patch: { features: { maxConcurrentRequests: 4 } } })
  const directory = join(f.dataRoot, 'content-updates', scope)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'state.json'), JSON.stringify({ active: { configuration: key(1) }, trial: null }))
  const recovered = await f.open()
  assert.equal(loadUserConfig(f.path).features.maxConcurrentRequests, 4)
  assert.equal(recovered.state.defaults.key, key(1))
  assert.equal(recovered.state.trial, null)
})

test('bad backup fails closed and never replaces the active config', async t => {
  const f = await fixture(t)
  await f.file.apply({ scope, key: key(1), patch: { features: { maxConcurrentRequests: 4 } } })
  const active = await readFile(f.path, 'utf8')
  await writeFile(f.file.backup, '{"schemaVersion":1}')
  await assert.rejects(f.open(), /备份校验失败/)
  assert.equal(await readFile(f.path, 'utf8'), active)
})

test('interrupted replacement restores a missing active file from the only backup', async t => {
  const f = await fixture(t)
  const before = await readFile(f.path, 'utf8')
  await f.file.apply({ scope, key: key(1), revision: 1, patch: { features: { maxConcurrentRequests: 4 } } })
  await rm(f.path)
  const recovered = await f.open()
  assert.equal(await readFile(f.path, 'utf8'), before)
  assert.equal(await readFile(recovered.backup, 'utf8'), before)
  assert.equal(recovered.state.trial, null)
  assert.deepEqual((await readdir(join(f.dataRoot, 'configuration'))).filter(name => name.endsWith('.jsonc')), ['eduwork.previous.jsonc'])
})
