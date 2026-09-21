import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEnterpriseProfile, enterpriseProviderConfig } from '../src/host/profile.js'
import { resolveEnterpriseProfiles } from '../src/host/provider/core.js'
import { detectGatewayProtocol } from '../src/host/litellm-protocol.js'

const profile = (origin, enabled) => normalizeEnterpriseProfile({ schemaVersion: 'dsh-oidc/v1alpha1', id: 'example', displayName: 'Example',
  ...(enabled === undefined ? {} : { allowInsecureDevelopment: enabled }), auth: { discoveryUrl: origin + '/discovery' } })
const metadata = origin => ({ contract_version: 1, issuer: origin, resource: origin,
  authorization_endpoint: origin + '/authorize', token_endpoint: origin + '/token', registration_endpoint: origin + '/register', revocation_endpoint: origin + '/revoke',
  userinfo_endpoint: origin + '/user/info', api_base: origin + '/v1',
  response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'],
})

test('one boolean controls HTTP for DNS, IP, loopback and model requests; HTTPS stays available', () => {
  for (const host of ['uat.example.test:8080', '192.0.2.10', '127.0.0.1:18080', '[::1]:18080']) {
    const origin = 'http://' + host
    for (const setting of [undefined, false]) assert.throws(() => profile(origin, setting), /HTTPS/)
    const allowed = profile(origin, true)
    const descriptor = detectGatewayProtocol(metadata(origin), allowed)
    assert.equal(descriptor.issuer, origin)
    const configured = { ...allowed, provider: { ...allowed.provider, baseURL: origin + '/v1', models: [{ id: 'model', input: ['text'] }] } }
    const [model] = resolveEnterpriseProfiles(enterpriseProviderConfig(new Map([['example', configured]])))
    assert.equal(model.baseURL, origin + '/v1')
    assert.throws(() => detectGatewayProtocol({ ...metadata(origin), token_endpoint: 'http://other.example.test/token' }, allowed), /trust boundary/)
    for (const setting of [false, true]) assert.equal(profile('https://' + host, setting).allowInsecureDevelopment, setting)
  }
})

test('HTTP opt-in never allows other URL schemes or weakens explicit issuer validation', () => {
  for (const scheme of ['ftp', 'file', 'javascript', 'ws']) assert.throws(() => profile(scheme + '://example.test', true))
  for (const bad of ['http://user:pass@example.org', 'http://example.test?query=1', 'http://example.test#fragment']) assert.throws(() => profile(bad, true))
  for (const value of ['true', 1, null]) assert.throws(() => profile('https://example.test', value), /boolean/)
  const allowed = { ...profile('http://example.test', true), auth: { discoveryUrl: 'http://example.test/discovery', expectedIssuer: 'http://example.test/expected' } }
  assert.throws(() => detectGatewayProtocol(metadata('http://example.test'), allowed), /expectedIssuer/)
})

test('an obsolete origin field cannot enable HTTP and is not forwarded to model settings', () => {
  const raw = { schemaVersion: 'dsh-oidc/v1alpha1', id: 'example', displayName: 'Example', insecureDevelopmentOrigin: 'http://old.example.test', auth: { discoveryUrl: 'http://new.example.test/discovery' } }
  assert.throws(() => normalizeEnterpriseProfile(raw), /HTTPS/)
  const current = normalizeEnterpriseProfile({ ...raw, allowInsecureDevelopment: true })
  assert.equal(current.insecureDevelopmentOrigin, undefined)
  assert.equal(current.allowInsecureDevelopment, true)
})
