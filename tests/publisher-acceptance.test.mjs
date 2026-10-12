import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { verifyPublisherFirstLaunch } from '../scripts/lib/publisher-acceptance.mjs'

const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' })
const descriptor = (configuration, skills) => ({ contentUpdates: {
  publisher: 'test-publisher', baseURL: 'https://updates.example.test/content',
  publicKey, configuration, skills, bundled: { configuration: 0, skills: 0 },
} })

test('configuration-only publisher can ship bundled skills without an online skill revision', () => {
  verifyPublisherFirstLaunch(descriptor(true, false), { configurationRevision: 8, skillsRevision: 0 })
})

test('every enabled component must actually have activated on first launch', () => {
  const both = descriptor(true, true)
  verifyPublisherFirstLaunch(both, { configurationRevision: 8, skillsRevision: 2 })
  assert.throws(() => verifyPublisherFirstLaunch(both, { configurationRevision: 8, skillsRevision: 0 }), /publisher skills/)
  assert.throws(() => verifyPublisherFirstLaunch(both, { configurationRevision: 0, skillsRevision: 2 }), /publisher configuration/)
  verifyPublisherFirstLaunch(descriptor(false, true), { configurationRevision: 0, skillsRevision: 2 })
})

test('missing, malformed or unsuccessful launch evidence cannot pass acceptance', () => {
  for (const revision of [undefined, null, 0, -1, '8', 1.5, NaN]) {
    assert.throws(() => verifyPublisherFirstLaunch(descriptor(true, false), { configurationRevision: revision }), /publisher configuration/)
  }
  assert.throws(() => verifyPublisherFirstLaunch(descriptor(true, false), null), /publisher configuration/)
  assert.throws(() => verifyPublisherFirstLaunch(descriptor(false, false), { configurationRevision: 8 }), /enabled content source/)
  assert.throws(() => verifyPublisherFirstLaunch({}, { configurationRevision: 8 }), /enabled content source/)
  assert.throws(() => verifyPublisherFirstLaunch({ contentUpdates: { ...descriptor(true, false).contentUpdates, configuration: 'true' } }, { configurationRevision: 8 }))
})
