// Contract checks for test policy only; actual Loader/browser runs remain the
// acceptance evidence. Importing the entry must not start a Web or model call.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { configuredOIDCProfileIDs, oidcProfilePolicy, studioReadiness } from '../scripts/test-eduwork-web.mjs'

const descriptors = () => ['audio', 'flashcards', 'mindmap', 'quiz', 'report', 'slides', 'table', 'video'].map(id => ({
  id, title: id, description: `Capability ${id}`, rendererKey: id, interaction: 'dialog', execution: 'artifact',
  output: ['audio', 'video'].includes(id) ? 'media' : 'document', available: true,
  parameters: id === 'audio' ? [{ id: 'provider', label: 'Speech provider', type: 'select', options: [{ value: 'system', label: 'System' }] }] : [],
}))
const configuration = ids => ({ schemaVersion: 'dsh-oidc/v1alpha1', profiles: ids.map(id => ({ id })) })
const composition = [{ insert: [{ id: 'enterprise-oidc', name: '@eduwork/dsh-oidc', config: { profilePathEnv: 'EDUWORK_OIDC_PROFILE' } }] }]

test('full-ready stays strict while explicit clean-ci reports an observable unavailable reason', () => {
  const rows = descriptors()
  assert.equal(studioReadiness(rows).allReportedAvailable, true)
  rows[0].available = false
  rows[0].parameters[0].options = []
  assert.throws(() => studioReadiness(rows), /Full-ready acceptance requires/)
  const clean = studioReadiness(rows, 'clean-ci')
  assert.equal(clean.allReportedAvailable, false)
  assert.deepEqual(clean.unavailable, [{ id: 'audio', reason: 'no-speech-provider-with-voices' }])
  rows.find(row => row.id === 'report').available = false
  assert.throws(() => studioReadiness(rows, 'clean-ci'), /without a recognized, observable readiness reason/)
})

test('clean-ci never converts missing schema or contradictory readiness into a pass', () => {
  const rows = descriptors()
  delete rows[0].available
  assert.throws(() => studioReadiness(rows, 'clean-ci'), /readiness explicitly/)
  rows[0].available = false
  assert.throws(() => studioReadiness(rows, 'clean-ci'), /observable readiness reason/)
  assert.throws(() => studioReadiness(rows, 'unknown'), /Unknown Web acceptance mode/)
})

test('clean-ci preserves native media failure even when a system voice is available', () => {
  const rows = descriptors()
  for (const row of rows.filter(row => ['audio', 'video'].includes(row.id))) {
    row.available = false
    row.unavailableReason = '本机媒体渲染浏览器尚未配置，请准备媒体组件。'
  }
  const state = studioReadiness(rows, 'clean-ci')
  assert.equal(state.allReportedAvailable, false)
  assert.deepEqual(state.unavailable, ['audio', 'video'].map(id => ({ id, reason: 'host-reported-unavailable',
    detail: '本机媒体渲染浏览器尚未配置，请准备媒体组件。' })))
  assert.throws(() => studioReadiness(rows), /Full-ready acceptance requires/)
  rows[0].unavailableReason = ' '
  assert.throws(() => studioReadiness(rows, 'clean-ci'), /observable readiness reason/)
})

test('OIDC expectations follow explicit configuration, independent of edition branding', () => {
  assert.equal(oidcProfilePolicy(configuration([]), []).profileConfiguration, 'not-configured')
  assert.equal(oidcProfilePolicy(configuration(['campus']), ['campus']).configuredProfiles, 1)
  assert.throws(() => oidcProfilePolicy(configuration([]), ['campus']), /explicitly configured OIDC profile must load/)
  assert.throws(() => oidcProfilePolicy(configuration(['wrong']), ['campus']), /explicitly configured OIDC profile must load/)
  assert.throws(() => oidcProfilePolicy(configuration(['unexpected']), []), /No OIDC profile was configured/)
})

test('profile ID discovery mirrors file, environment alias and inline config without exposing profile contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-web-contract-'))
  try {
    await writeFile(join(root, 'profile.json'), JSON.stringify({ profiles: [{ id: 'campus', oidc: { clientSecret: '<SYNTHETIC_CLIENT_SECRET>' } }] }))
    const base = { assembly: root }
    assert.deepEqual(await configuredOIDCProfileIDs(base, composition, {}), [])
    assert.deepEqual(await configuredOIDCProfileIDs({ ...base, enterpriseProfile: 'profile.json' }, composition, {}), ['campus'])
    assert.deepEqual(await configuredOIDCProfileIDs(base, composition, { DSH_OIDC_ENTERPRISE_PROFILE: 'profile.json' }), ['campus'])
    assert.deepEqual(await configuredOIDCProfileIDs({ ...base, pluginConfig: { 'enterprise-oidc': { profile: { id: 'inline' } } } }, composition, {}), ['inline'])
    await assert.rejects(configuredOIDCProfileIDs({ ...base, enterpriseProfile: 'missing.json' }, composition, {}), /refusing to treat it as unconfigured/)
    await writeFile(join(root, 'empty.json'), '[]')
    await assert.rejects(configuredOIDCProfileIDs({ ...base, enterpriseProfile: 'empty.json' }, composition, {}), /must declare at least one profile/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
