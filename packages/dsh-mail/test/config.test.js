import assert from 'node:assert/strict'
import test from 'node:test'
import { assertConfigured, settingsBase, validateSettings } from '../src/host/config.js'

test('installation defaults both capabilities off and uses encrypted transports', () => {
  const value = settingsBase()
  assert.equal(value.readEnabled, false)
  assert.equal(value.sendEnabled, false)
  assert.equal(value.imapTls, 'implicit')
  assert.equal(value.smtpTls, 'implicit')
  assert.doesNotThrow(() => validateSettings(value))
})

test('invalid ports and insecure modes are rejected', () => {
  assert.throws(() => validateSettings({ ...settingsBase(), imapPort: 0 }), /IMAP port/)
  assert.throws(() => validateSettings({ ...settingsBase(), smtpTls: 'plain' }), /SMTP TLS/)
})

test('read and send have independent configuration requirements', () => {
  const base = { ...settingsBase(), email: 'user@example.edu', imapHost: 'imap.example.edu' }
  assert.doesNotThrow(() => assertConfigured(base, 'read'))
  assert.throws(() => assertConfigured(base, 'send'), /SMTP host/)
})
