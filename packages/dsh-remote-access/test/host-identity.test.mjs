/**
 * The Host identity is the one piece of state a restart must not change.
 *
 * The relay binds `hostId` to the public key of the first registration and refuses
 * any other, and every paired device pins that key. So these tests are not about
 * "does it store something" — they are about the two facts that make a restart
 * survivable: the same public key comes back, and a record that cannot be read is
 * never silently replaced by a new one.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { encodePublicKey } from '../src/channel/crypto.js'
import { HOST_IDENTITY_KEY, hasCredentialRecords, loadHostIdentity } from '../src/host-identity.js'

const publicOf = (identity) => encodePublicKey(identity.signing.publicKey)

/**
 * A credential store with the record seam's documented semantics.
 *
 * `modifyRecord` is an exclusive read-decide-replace — that exclusion is what
 * stops two boots creating two identities — so this one serializes its writes the
 * same way the real providers do.
 */
function memoryCredentials(initial = new Map()) {
  const records = initial
  let chain = Promise.resolve()
  return {
    records,
    async readRecord(key) {
      return records.get(key)
    },
    modifyRecord(key, mutate) {
      const run = chain.then(async () => {
        const current = records.get(key)
        const next = await mutate(current)
        if (next !== undefined) records.set(key, next)
        return records.get(key)
      })
      chain = run.then(() => undefined, () => undefined)
      return run
    },
    async deleteRecord(key) {
      records.delete(key)
    },
  }
}

test('首次装载创建身份并写入记录，第二次装载读回同一把公钥', async () => {
  const credentials = memoryCredentials()
  const firstProbe = []
  const first = await loadHostIdentity(credentials, (step, detail) => firstProbe.push([step, detail]))

  assert.equal(first.source, 'created')
  assert.equal(credentials.records.size, 1, 'one record, not one per key half')
  const record = credentials.records.get(HOST_IDENTITY_KEY)
  assert.equal(record.kind, 'grant')
  // It has to survive the JSON round trip the providers put it through.
  const stored = JSON.parse(JSON.stringify(record))
  assert.equal(stored.kind, 'grant')
  assert.equal(typeof stored.payload.signing.private, 'string')

  const secondProbe = []
  const second = await loadHostIdentity(credentials, (step) => secondProbe.push(step))

  assert.equal(second.source, 'stored')
  assert.equal(await publicOf(second.identity), await publicOf(first.identity),
    'a restart must present the same key to the relay and to paired devices')
  assert.ok(firstProbe.some(([step]) => step === 'identity created'))
  assert.ok(secondProbe.includes('identity loaded'))
})

test('并发装载只创建一把身份', async () => {
  // Two boots or a settings change can race the effect. `modifyRecord` is
  // exclusive, and the read-back is what makes every caller end up with the winner.
  const credentials = memoryCredentials()
  const loaded = await Promise.all([
    loadHostIdentity(credentials),
    loadHostIdentity(credentials),
    loadHostIdentity(credentials),
  ])
  const keys = new Set(await Promise.all(loaded.map(entry => publicOf(entry.identity))))
  assert.equal(keys.size, 1, 'concurrent loads must not produce two identities')
  assert.equal(credentials.records.size, 1)
})

test('没有凭据记录服务时退回临时身份，并留下可判读的 trace', async () => {
  const probes = []
  const first = await loadHostIdentity(undefined, step => probes.push(step))
  const second = await loadHostIdentity(undefined)

  assert.equal(first.source, 'ephemeral')
  assert.ok(probes.includes('identity unavailable'),
    'a boot that cannot persist its identity must say so, not look like a normal one')
  assert.notEqual(await publicOf(first.identity), await publicOf(second.identity),
    'without a store the identity really is per-boot; the caller is told so via source')

  // A provider that only implements the reference half cannot hold a key.
  assert.equal(hasCredentialRecords({ readRecord() {} }), false)
  assert.equal(hasCredentialRecords({ readRecord() {}, modifyRecord() {} }), true)
  assert.equal(hasCredentialRecords(undefined), false)
})

test('记录读不出来时抛错，并且绝不覆盖旧记录', async () => {
  const credentials = memoryCredentials()
  const brokenPayload = {
    version: 1,
    signing: { private: 'AA', public: 'p256:not-a-point' },
    agreement: { private: 'AA', public: 'p256:not-a-point' },
  }
  credentials.records.set(HOST_IDENTITY_KEY, { kind: 'grant', payload: brokenPayload })
  const before = JSON.stringify(credentials.records.get(HOST_IDENTITY_KEY))

  const probes = []
  await assert.rejects(
    () => loadHostIdentity(credentials, step => probes.push(step)),
    /could not be read/,
  )
  assert.ok(probes.includes('identity corrupt'))
  assert.equal(JSON.stringify(credentials.records.get(HOST_IDENTITY_KEY)), before,
    'rotating a key the relay already bound would lock every paired device out')
})

test('记录不是 grant 时拒绝，而不是当成身份读', async () => {
  const credentials = memoryCredentials()
  credentials.records.set(HOST_IDENTITY_KEY, { kind: 'api-key', key: 'not-an-identity' })
  await assert.rejects(() => loadHostIdentity(credentials), /not a grant/)
})
