import test from 'node:test'
import assert from 'node:assert/strict'
import { serviceReadAllowed } from '../src/host/service-authorization.js'

test('insecure service grants require explicit development and literal loopback IPs', () => {
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
