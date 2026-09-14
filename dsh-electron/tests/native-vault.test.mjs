import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { EncryptedVault, externalBrowserURL, startNativeBridge } from '../src/native-vault.mjs'

function encryption() {
  const key = randomBytes(32)
  return {
    encryptString(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]) },
    decryptString(bytes) { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8') },
  }
}
test('vault encrypts at rest, serializes writes, and survives a new provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-vault-test-')), path = join(root, 'credentials.encrypted'), crypto = encryption()
  const vault = new EncryptedVault(path, crypto)
  await Promise.all(Array.from({ length: 20 }, (_, index) => vault.operation('set', 'TEST_' + index, 'synthetic-secret-' + index)))
  assert.equal((await new EncryptedVault(path, crypto).operation('resolve', 'TEST_4')).value, 'synthetic-secret-4')
  assert.equal((await readFile(path)).includes(Buffer.from('synthetic-secret')), false)
  assert.equal(Object.hasOwn(await vault.operation('describe', 'TEST_4'), 'value'), false)
  await vault.operation('unset', 'TEST_4')
  assert.equal((await vault.operation('resolve', 'TEST_4')).configured, false)
  await assert.rejects(vault.operation('set', 'TEST_INVALID', ''))
  await assert.rejects(new EncryptedVault(path, encryption()).operation('resolve', 'TEST_3'))
})
test('native bridge rejects browser origins and unauthenticated callers; external opening is controlled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-bridge-test-')), opened = []
  const bridge = await startNativeBridge({ vault: new EncryptedVault(join(root, 'vault'), encryption()), openExternal: async url => opened.push(url) })
  try {
    const { baseURL, token } = bridge.bootstrap.nativeBridge
    const call = (path, body, extra = {}) => fetch(baseURL + path, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) })
    assert.equal((await call('/v1/credentials/resolve', { ref: 'TEST' }, { authorization: 'Bearer wrong' })).status, 403)
    assert.equal((await call('/v1/credentials/resolve', { ref: 'TEST' }, { origin: 'https://unowned.invalid' })).status, 403)
    assert.equal((await call('/v1/credentials/set', { ref: 'TEST', value: 'synthetic' })).status, 200)
    assert.equal((await (await call('/v1/credentials/resolve', { ref: 'TEST' })).json()).value, 'synthetic')
    for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'https://user:pass@example.org/']) assert.equal((await call('/v1/desktop/open-external', { url })).status, 400)
    assert.equal((await call('/v1/desktop/open-external', { url: 'https://login.example.org/authorize?state=synthetic' })).status, 204)
    assert.equal(opened.length, 1)
  } finally { await bridge.close() }
})
test('external URL normalization accepts only web schemes without embedded credentials', () => {
  assert.equal(externalBrowserURL('https://example.org'), 'https://example.org/')
  assert.throws(() => externalBrowserURL('mailto:user@example.org'))
})

test('closing the bridge drains an accepted encrypted write before resolving', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-bridge-drain-'))
  const vault = new EncryptedVault(join(root, 'vault'), encryption())
  let release
  const barrier = new Promise(resolve => { release = resolve })
  vault.queue = barrier
  const accepted = vault.operation('set', 'PENDING_TEST', 'synthetic-drained')
  const bridge = await startNativeBridge({ vault, openExternal: async () => {} })
  let closed = false
  const close = bridge.close().then(() => { closed = true })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(closed, false)
  release()
  await accepted; await close
  assert.equal((await vault.operation('resolve', 'PENDING_TEST')).value, 'synthetic-drained')
})
