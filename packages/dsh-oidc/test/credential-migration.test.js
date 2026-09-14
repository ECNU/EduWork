import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { normalizeEnterpriseProfile, DEFAULT_CREDENTIAL_REF, legacyCredentialRefs } from '../src/host/profile.js'
import { WebOidcBackend, sessionRef } from '../src/host/oidc.js'
import { DesktopOidcBackend } from '../src/host/desktop-oidc.js'
import { TYPERT } from '../src/host/typert.host.js'

const raw = JSON.parse(await readFile(new URL('../examples/enterprise-profile.example.json', import.meta.url), 'utf8'))
const profile = normalizeEnterpriseProfile(raw)
const hash = value => createHash('sha256').update(value).digest('hex')
const binding = (p, ref = p.keyBinding.credentialRef) => ({ managementBaseURL: p.keyBinding.baseURL,
  runtimeBaseURL: p.provider.baseURL, providerID: p.provider.id, credentialRef: ref })
const session = (p, ref = p.keyBinding.credentialRef) => ({ issuer: p.oidc.issuer, clientId: p.oidc.clientId,
  accessToken: 'synthetic-access', expiresAt: Math.floor(Date.now() / 1000) + 3600,
  identity: { sub: `synthetic-${p.id}` }, resourceBinding: binding(p, ref) })
const expected = p => ({ credentialRef: p.keyBinding.credentialRef, runtimeBaseURL: p.provider.baseURL })

function fixture(profiles = [profile]) {
  const secrets = new Map(), calls = []
  const ctx = { credentials: {
    resolve: async ref => secrets.has(ref) ? { value: secrets.get(ref) } : undefined,
    set: async (ref, value) => { secrets.set(ref, value) }, unset: async ref => { secrets.delete(ref) },
  }, effect() {}, logger: { warn() {} } }
  const backend = new WebOidcBackend(ctx, new Map(profiles.map(p => [p.id, p])), {}, {
    transport: 'desktop', fetch: async url => { calls.push(url); throw new Error('Unexpected network request') },
  })
  return { backend, secrets, calls, ctx }
}

test('default and both legacy automatic names normalize to one institution-neutral ref; unrelated explicit refs remain unchanged', () => {
  assert.equal(DEFAULT_CREDENTIAL_REF, 'EDUWORK_API_KEY')
  for (const credentialRef of [undefined, 'EDUWORK_API_KEY', ...legacyCredentialRefs(profile)]) {
    const normalized = normalizeEnterpriseProfile({ ...raw, keyBinding: { ...raw.keyBinding, credentialRef } })
    assert.equal(normalized.keyBinding.credentialRef, 'EDUWORK_API_KEY')
  }
  const custom = normalizeEnterpriseProfile({ ...raw, keyBinding: { ...raw.keyBinding, credentialRef: 'MY_LOCAL_MODEL_KEY' } })
  assert.equal(custom.keyBinding.credentialRef, 'MY_LOCAL_MODEL_KEY')
})

for (const oldRef of legacyCredentialRefs(profile)) {
  test(`exact old binding migrates ${oldRef} to EDUWORK_API_KEY without a login or network request`, async () => {
    const f = fixture()
    f.secrets.set(sessionRef(profile), JSON.stringify(session(profile, oldRef)))
    f.secrets.set(oldRef, 'synthetic-managed-key')
    f.secrets.set('PERSONAL_KEY', 'personal-value')
    const result = await f.backend.status(profile.id)
    assert.equal(result.state, 'connected')
    assert.equal(f.secrets.get('EDUWORK_API_KEY'), 'synthetic-managed-key')
    assert.equal(f.secrets.has(oldRef), false)
    assert.equal(f.secrets.get('PERSONAL_KEY'), 'personal-value')
    assert.equal(JSON.parse(f.secrets.get(sessionRef(profile))).runtimeCredentialHash, hash('synthetic-managed-key'))
    assert.equal(JSON.stringify(result).includes('synthetic-managed-key'), false)
    assert.equal(JSON.stringify(result).includes(hash('synthetic-managed-key')), false)
    assert.deepEqual(f.calls, [])
    await f.backend.logout(profile.id)
    assert.deepEqual([...f.secrets], [['PERSONAL_KEY', 'personal-value']])
  })
}

test('migration never overwrites or adopts a populated new ref and logout does not delete its unknown owner', async () => {
  const f = fixture(), oldRef = legacyCredentialRefs(profile)[0]
  f.secrets.set(sessionRef(profile), JSON.stringify(session(profile, oldRef)))
  f.secrets.set(oldRef, 'old-value')
  f.secrets.set('EDUWORK_API_KEY', 'other-login-value')
  assert.equal((await f.backend.status(profile.id)).credentialReady, false)
  assert.equal(f.secrets.get('EDUWORK_API_KEY'), 'other-login-value')
  assert.equal(f.secrets.get(oldRef), 'old-value')
  await f.backend.logout(profile.id)
  assert.equal(f.secrets.get('EDUWORK_API_KEY'), 'other-login-value')
})

for (const field of ['issuer', 'clientId', 'managementBaseURL', 'runtimeBaseURL', 'providerID']) {
  test(`migration rejects a different ${field} before resolving a managed credential`, async () => {
    const f = fixture(), oldRef = legacyCredentialRefs(profile)[0], saved = session(profile, oldRef)
    if (field in saved) saved[field] += '-changed'
    else saved.resourceBinding[field] += '-changed'
    f.secrets.set(sessionRef(profile), JSON.stringify(saved)); f.secrets.set(oldRef, 'wrong-deployment-key')
    assert.equal((await f.backend.status(profile.id)).credentialReady, false)
    assert.equal(await f.backend.resolveBoundCredential(profile.id, expected(profile)), undefined)
    assert.equal(f.secrets.has('EDUWORK_API_KEY'), false)
    assert.deepEqual(f.calls, [])
  })
}

test('legacy custom ref and tampered old key cannot be silently imported into the common ref', async () => {
  for (const [ref, digest] of [['CUSTOM_KEY', undefined], [legacyCredentialRefs(profile)[0], hash('original-key')]]) {
    const f = fixture()
    f.secrets.set(sessionRef(profile), JSON.stringify({ ...session(profile, ref), ...(digest ? { runtimeCredentialHash: digest } : {}) }))
    f.secrets.set(ref, 'replaced-key')
    assert.equal((await f.backend.status(profile.id)).credentialReady, false)
    assert.equal(f.secrets.has('EDUWORK_API_KEY'), false)
  }
})

test('migration does not import a legacy reference explicitly owned by another configured profile', async () => {
  const oldRef = legacyCredentialRefs(profile)[0]
  const second = normalizeEnterpriseProfile({ ...raw, id: 'second',
    keyBinding: { ...raw.keyBinding, credentialRef: oldRef }, provider: { ...raw.provider, id: 'second-ai' } })
  const f = fixture([profile, second])
  f.secrets.set(sessionRef(profile), JSON.stringify(session(profile, oldRef)))
  f.secrets.set(oldRef, 'second-profile-key')
  assert.equal((await f.backend.status(profile.id)).credentialReady, false)
  assert.equal(f.secrets.has('EDUWORK_API_KEY'), false)
  assert.equal(f.secrets.get(oldRef), 'second-profile-key')
})

test('a legacy single-profile binding may be adopted, but ambiguous multi-profile bindings require reconnection', async () => {
  const second = normalizeEnterpriseProfile({ ...raw, id: 'second', provider: { ...raw.provider, id: 'second-ai' } })
  for (const profiles of [[profile], [profile, second]]) {
    const f = fixture(profiles)
    f.secrets.set(sessionRef(profile), JSON.stringify(session(profile)))
    f.secrets.set('EDUWORK_API_KEY', 'legacy-key')
    assert.equal((await f.backend.status(profile.id)).credentialReady, profiles.length === 1)
  }
})

test('a shared ref only enables its matching login; another profile cannot read, transmit, or clear the current key', async () => {
  const second = normalizeEnterpriseProfile({ ...raw, id: 'second', oidc: { ...raw.oidc, issuer: 'https://second.example/oidc' },
    keyBinding: { ...raw.keyBinding, baseURL: 'https://second.example/management' },
    provider: { ...raw.provider, id: 'second-ai', baseURL: 'https://second.example/v1' } })
  const f = fixture([profile, second])
  for (const p of [profile, second]) await f.backend.saveSession(p, session(p))
  await f.backend.setRuntimeCredential(profile, session(profile), 'first-key')
  assert.equal((await f.backend.status(second.id)).credentialReady, false)
  await f.backend.setRuntimeCredential(second, session(second), 'second-key')
  assert.equal((await f.backend.status(profile.id)).credentialReady, false)
  assert.equal(await f.backend.resolveBoundCredential(profile.id, expected(profile)), undefined)
  assert.equal((await f.backend.resolveBoundCredential(second.id, expected(second))).value, 'second-key')
  assert.equal(await f.backend.resolveBoundCredential(second.id, expected(profile)), undefined)
  await assert.rejects(f.backend.modelResourceFetch(profile.id, '/account-summary'), { code: 'oidc_login_required' })
  assert.deepEqual(f.calls, [])
  await f.backend.logout(profile.id)
  assert.equal(f.secrets.get('EDUWORK_API_KEY'), 'second-key')
  assert.equal((await f.backend.status(second.id)).credentialReady, true)
  await f.backend.logout(second.id)
  assert.equal(f.secrets.has('EDUWORK_API_KEY'), false)
})

test('host-only credential snapshots reject stale reads after logout and are absent from RPC', async () => {
  const f = fixture()
  await f.backend.saveSession(profile, session(profile))
  await f.backend.setRuntimeCredential(profile, session(profile), 'synthetic-key')
  const bound = f.backend.boundCredential.bind(f.backend)
  f.backend.boundCredential = async (...args) => {
    const result = await bound(...args)
    await f.backend.logout(profile.id)
    return result
  }
  assert.equal(await f.backend.resolveBoundCredential(profile.id, expected(profile)), undefined)
  assert.equal(TYPERT.invocations.some(item => item.method === 'resolveBoundCredential'), false)
})

test('desktop cancellation cannot restore its snapshot over another profile binding the shared key', async () => {
  const second = normalizeEnterpriseProfile({ ...raw, id: 'second', provider: { ...raw.provider, id: 'second-ai' } })
  const f = fixture([profile, second])
  const backend = new DesktopOidcBackend(f.ctx, new Map([[profile.id, profile], [second.id, second]]))
  await backend.saveSession(profile, session(profile))
  await backend.setRuntimeCredential(profile, session(profile), 'original-key')
  const attempt = { profileID: profile.id, state: 'pending', flow: { epoch: 0 } }
  backend.exchangeAuthorization = async () => session(profile)
  backend.reconcile = async () => {
    await backend.setRuntimeCredential(profile, session(profile), 'cancelled-key')
    await backend.saveSession(second, session(second))
    await backend.setRuntimeCredential(second, session(second), 'second-key')
    attempt.state = 'cancelled'
  }
  await backend.finishAuthorization(attempt, new URL('http://127.0.0.1/oauth/callback'))
  assert.equal(f.secrets.get('EDUWORK_API_KEY'), 'second-key')
  assert.equal((await backend.status(profile.id)).credentialReady, false)
  assert.equal((await backend.status(second.id)).credentialReady, true)
  await backend.dispose()
})
