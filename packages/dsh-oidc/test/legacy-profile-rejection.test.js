import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeEnterpriseProfile } from '../src/host/profile.js'
import { reconcileOptionsSchema } from '../src/host/typert-schemas.js'
import { sessionRef } from '../src/host/oidc.js'
import { fixture } from './helpers/desktop-fixture.js'

test('legacy model-key profiles are rejected instead of choosing an old or guessed model endpoint', () => {
  const old = { schemaVersion: 'dsh-oidc/v1alpha1', id: 'legacy', displayName: 'Legacy',
    oidc: { issuer: 'https://id.example.edu', clientId: 'synthetic-client', scopes: ['openid', 'profile'] },
    keyBinding: { baseURL: 'https://models.example.edu/management' },
    provider: { id: 'legacy', adapter: 'openai-compatible', baseURL: 'https://models.example.edu/v1', models: [{ id: 'chat' }] } }
  assert.throws(() => normalizeEnterpriseProfile(old), /keyBinding is not allowed/)
  const { keyBinding, ...missingBinding } = old
  assert.throws(() => normalizeEnterpriseProfile(missingBinding), /identity profiles cannot configure model resources/)
  assert.equal(reconcileOptionsSchema.safeParse({ allowProvision: true }).success, false)
})

test('upgraded gateway ignores saved model-key sessions and leaves unrelated credentials untouched', async t => {
  const f = await fixture(t, { resources: true })
  f.records.set('EDUWORK_API_KEY', 'previous-managed-key')
  f.records.set(sessionRef(f.profile), JSON.stringify({ issuer: f.origin, clientId: 'desktop-test',
    accessToken: 'old-token', expiresAt: Math.floor(Date.now() / 1000) + 3600, identity: { sub: 'synthetic-user' },
    resourceBinding: { credentialRef: 'EDUWORK_API_KEY' }, runtimeCredentialHash: 'obsolete' }))
  assert.equal((await f.backend.status(f.profile.id)).state, 'signed_out')
  await assert.rejects(f.backend.modelResourceFetch(f.profile.id, '/quota'), { code: 'oidc_login_required' })
  assert.ok(!f.requests.some(row => /\/v1\/|bootstrap|runtime-credential/.test(row.path)))
  const { callback } = await f.authorization()
  assert.equal((await fetch(callback)).status, 200)
  assert.equal((await f.backend.modelResourceFetch(f.profile.id, '/quota')).status, 200)
  assert.equal(f.records.get('EDUWORK_API_KEY'), 'previous-managed-key')
  await f.backend.logout(f.profile.id)
  assert.equal(f.records.get('PERSONAL_API_KEY'), '<PERSONAL_KEY>')
  assert.equal(f.records.get('EDUWORK_API_KEY'), 'previous-managed-key')
})
