import assert from 'node:assert/strict'
import test from 'node:test'
import { readActivityProfile, emptyProfile } from '../lib/profile.js'

test('OIDC public status supplies the real identity and logout clears it', async () => {
  let status = { userName: '测试用户', organization: '测试学校', credentialReady: true, state: 'ready' }
  const accounts = { configuration: async () => ({ profiles: [{ id: 'school', displayName: '学校服务' }] }), status: async () => status }
  const ctx = { get: name => name === 'oidcAccounts' ? accounts : undefined }
  assert.deepEqual(await readActivityProfile(ctx), { displayName: '测试用户', organization: '测试学校', affiliation: null, connected: true })
  status = { state: 'signed-out', credentialReady: false }
  assert.deepEqual(await readActivityProfile(ctx), emptyProfile())
})

test('one unavailable account does not hide a later signed-in account', async () => {
  const accounts = { configuration: async () => ({ profiles: [{ id: 'a' }, { id: 'b' }] }),
    status: async id => { if (id === 'a') throw new Error('offline'); return { userName: '乙', credentialReady: true } } }
  assert.equal((await readActivityProfile({ get: () => accounts })).displayName, '乙')
})
