import assert from 'node:assert/strict'
import test from 'node:test'
import { loginLoadStatus, loginErrorMessages } from '../src/login-errors.mjs'

test('certificate failures differ from unavailable servers and cancellation', () => {
  for (const code of ['ERR_CERT_AUTHORITY_INVALID', 'ERR_CERT_DATE_INVALID', 'ERR_CERT_COMMON_NAME_INVALID', 'ERR_SSL_PROTOCOL_ERROR']) {
    assert.equal(loginLoadStatus({ code }), 'login-certificate-error')
  }
  assert.equal(loginLoadStatus(Error('ERR_CERT_AUTHORITY_INVALID (-202) loading secret-url')), 'login-certificate-error')
  assert.equal(loginLoadStatus({ code: 'ERR_CONNECTION_REFUSED' }), 'login-connection-failed')
  assert.equal(loginLoadStatus({ code: 'ERR_ABORTED' }), 'cancelled')
  assert.equal(loginLoadStatus(Error('sensitive provider detail')), 'login-connection-failed')
  assert.ok(!JSON.stringify(loginErrorMessages).includes('sensitive provider detail'))
})
