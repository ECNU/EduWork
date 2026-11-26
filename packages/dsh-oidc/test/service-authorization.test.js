import test from 'node:test'
import assert from 'node:assert/strict'
import { serviceReadAllowed } from '../src/host/service-authorization.js'

test('unbound insecure service grants require explicit development and literal loopback IPs', () => {
  for (const address of ['http://127.0.0.1:1234/calendar', 'http://[::1]:1234/calendar']) {
    const url = new URL(address)
    assert.equal(serviceReadAllowed({}, url, {}, { serviceURL: url.href }), false)
    assert.equal(serviceReadAllowed({ allowInsecureDevelopment: true }, url, {}, { serviceURL: url.href }), true)
    assert.equal(serviceReadAllowed({ allowInsecureDevelopment: true }, url, { method: 'POST' }, { serviceURL: url.href }), false)
  }
  for (const address of ['http://localhost:1234/calendar', 'http://example.edu/calendar', 'http://192.0.2.1/calendar', 'file:///calendar']) {
    const url = new URL(address)
    assert.equal(serviceReadAllowed({ allowInsecureDevelopment: true }, url, {}, { serviceURL: url.href }), false)
  }
  const url = new URL('https://school.example.edu/calendar')
  assert.equal(serviceReadAllowed({}, url, {}, { serviceURL: url.href }), true)
  assert.equal(serviceReadAllowed({}, url, {}, { serviceURL: url.href + '?other' }), false)
  assert.equal(serviceReadAllowed({}, url, { body: 'data' }, { serviceURL: url.href }), false)
})

test('HTTP test issuer reads stay bound to the configured origin, exact URL and GET method', () => {
  const url = new URL('http://192.0.2.10:8080/worker/points?page=0')
  for (const identity of [{ auth: { expectedIssuer: 'http://192.0.2.10:8080' } }, { oidc: { issuer: 'http://192.0.2.10:8080/issuer' } }]) {
    const profile = { ...identity, allowInsecureDevelopment: true }
    assert.equal(serviceReadAllowed(profile, url, {}, { serviceURL: url.href }), true)
    assert.equal(serviceReadAllowed(identity, url, {}, { serviceURL: url.href }), false)
    assert.equal(serviceReadAllowed(profile, url, {}, {}), false)
    assert.equal(serviceReadAllowed(profile, url, {}, { serviceURL: url.href + '1' }), false)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(serviceReadAllowed(profile, url, { method }, { serviceURL: url.href }), false)
    assert.equal(serviceReadAllowed(profile, url, { body: '' }, { serviceURL: url.href }), false)
    for (const address of ['http://192.0.2.11:8080/worker/points', 'http://192.0.2.10:8081/worker/points']) {
      const other = new URL(address)
      assert.equal(serviceReadAllowed(profile, other, {}, { serviceURL: other.href }), false)
    }
  }
  for (const expectedIssuer of [undefined, 'bad url', 'https://192.0.2.10:8080']) {
    assert.equal(serviceReadAllowed({ allowInsecureDevelopment: true, auth: { expectedIssuer } }, url, {}, { serviceURL: url.href }), false)
  }
})
