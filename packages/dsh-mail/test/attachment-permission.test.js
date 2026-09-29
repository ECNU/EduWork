import test from 'node:test'
import assert from 'node:assert/strict'
import { decideMailPermission } from '../src/host/permission.js'

test('attachment downloads honor the session write mode without granting SMTP permission', async () => {
  const session = { header: { cwd: '/workspace' } }
  let mode = 'workspace-write', root = '/workspace', nextCalls = 0
  const ctx = {
    get: key => key === 'sandboxPolicy' ? { resolve: request => {
      assert.equal(request.session, session)
      return { mode, workspaceRoot: root }
    } } : undefined,
    permissionPresets: { current: () => 'custom' },
    fs: { resolve: async (path, options) => path === '.' ? options.cwd : path,
      contains: (parent, child) => parent === child },
  }
  const exec = { name: 'mail_get_attachment', agent: { session } }
  const next = () => { nextCalls++; return { kind: 'allow' } }
  assert.equal((await decideMailPermission(ctx, exec, next)).kind, 'allow')
  mode = 'read-only'
  assert.equal((await decideMailPermission(ctx, exec, next)).kind, 'ask')
  assert.equal(nextCalls, 1, 'no attachment access before approval')
  mode = 'workspace-write'; root = '/different'
  assert.equal((await decideMailPermission(ctx, exec, next)).kind, 'deny')
  mode = 'danger-full-access'
  assert.equal((await decideMailPermission(ctx, exec, next)).kind, 'allow')
  assert.equal((await decideMailPermission(ctx, { ...exec, agent: undefined }, next)).kind, 'deny')
  assert.equal((await decideMailPermission(ctx, { ...exec, name: 'mail_send' }, next)).kind, 'ask')
})

test('older hosts support canonical workspace presets and unknown modes ask', async () => {
  const exec = { name: 'mail_get_attachment', agent: { session: { header: { cwd: '/workspace' } } } }
  for (const mode of ['workspace-write', 'danger-full-access', 'read-only', 'custom']) {
    const ctx = { permissionPresets: { current: () => mode } }
    assert.equal((await decideMailPermission(ctx, exec, () => ({ kind: 'allow' }))).kind,
      ['workspace-write', 'danger-full-access'].includes(mode) ? 'allow' : 'ask')
  }
})
