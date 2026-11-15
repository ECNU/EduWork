import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
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
})
test('a vault this account cannot decrypt is kept aside and the app continues signed out', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-vault-test-')), path = join(root, 'credentials.encrypted')
  await new EncryptedVault(path, encryption()).operation('set', 'TEST_OLD', 'synthetic-old-secret')
  const original = await readFile(path), events = []
  // A different key stands in for a copied install or a reset OS password.
  const vault = new EncryptedVault(path, encryption(), { confirmReplacement: () => true, onUnreadable: event => events.push(event) })
  assert.deepEqual(await vault.operation('resolve', 'TEST_OLD'), { configured: false, writable: true, source: 'os-encrypted-vault' })
  assert.deepEqual(await readFile(path), original)
  assert.deepEqual(events, [])
  await assert.rejects(vault.operation('unset', 'TEST_OLD'))
  await vault.operation('set', 'TEST_NEW', 'synthetic-new-secret')
  assert.equal(events.length, 1)
  assert.deepEqual(await readFile(events[0].aside), original, 'the unreadable bytes are preserved, not deleted')
  assert.equal((await vault.operation('resolve', 'TEST_NEW')).value, 'synthetic-new-secret')
  assert.equal(events.length, 1, 'the fresh vault is readable')
  assert.deepEqual((await readdir(root)).filter(name => name.includes('unreadable')).length, 1)
})
test('a temporarily locked vault stays in place and is retried, including after a cancelled replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-vault-test-')), path = join(root, 'credentials.encrypted')
  const crypto = encryption()
  await new EncryptedVault(path, crypto).operation('set', 'TEST', 'synthetic')
  let locked = true, allow = false
  const vault = new EncryptedVault(path, {
    ...crypto, decryptString: bytes => { if (locked) throw new Error('key unavailable'); return crypto.decryptString(bytes) }
  }, { confirmReplacement: () => { if (allow) locked = false; return allow } })
  const original = await readFile(path)
  assert.equal((await vault.operation('describe', 'TEST')).configured, false)
  await assert.rejects(vault.operation('set', 'OTHER', 'new'))
  assert.deepEqual(await readFile(path), original)
  assert.deepEqual(await readdir(root), ['credentials.encrypted'])
  locked = false
  assert.equal((await vault.operation('resolve', 'TEST')).value, 'synthetic')
  locked = true
  allow = true
  await vault.operation('set', 'OTHER', 'new')
  assert.equal((await vault.operation('resolve', 'TEST')).value, 'synthetic')
  assert.equal((await vault.operation('resolve', 'OTHER')).value, 'new')
  assert.deepEqual(await readdir(root), ['credentials.encrypted'])
})
test('a future vault format and a file changed while confirming recovery are preserved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-vault-test-')), path = join(root, 'credentials.encrypted')
  const crypto = encryption()
  const future = crypto.encryptString(JSON.stringify({ schemaVersion: 2, values: {} }))
  let confirmations = 0
  const vault = new EncryptedVault(path, crypto, { confirmReplacement: async () => {
    confirmations++
    await writeFile(path, future)
    return true
  } })
  await writeFile(path, crypto.encryptString('{'))
  await assert.rejects(vault.operation('set', 'TEST', 'new'), /changed during recovery/)
  await assert.rejects(vault.operation('set', 'TEST', 'new'), /Unsupported credential vault version/)
  assert.equal(confirmations, 1)
  assert.deepEqual(await readFile(path), future)
  assert.deepEqual(await readdir(root), ['credentials.encrypted'])
})
test('a vault read error other than a missing file still fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-vault-test-'))
  // A directory in place of the file stands in for a locked or unreadable path.
  await mkdir(join(root, 'credentials.encrypted'))
  await assert.rejects(new EncryptedVault(join(root, 'credentials.encrypted'), encryption()).operation('resolve', 'TEST'))
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
