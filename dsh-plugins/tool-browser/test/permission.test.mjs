import test from 'node:test'
import assert from 'node:assert/strict'
import { decideBrowserPermission } from '../lib/permission.js'

test('managed browser checks canonical tool arguments before interacting with pages', async () => {
  let preset = 'workspace-write'
  const ctx = { permissionPresets: { current: () => preset } }
  const exec = { name: 'browser', agent: { session: {} } }
  const next = () => ({ kind: 'allow' })
  for (const args of [{ action: 'click' }, { action: 'type' }, { action: 'screenshot' },
    { action: 'close_tab' }, { action: 'navigate', url: 'http://127.0.0.1' },
    { action: 'snapshot', mode: 'visible' }]) {
    const decision = await decideBrowserPermission(ctx, { ...exec, arguments: args }, next)
    assert.equal(decision.kind, 'ask')
    assert.equal(decision.displayReason.en, decision.reason)
    assert.equal(decision.displayReason.zh, '允许智能体操作网页，或打开可见的托管浏览器窗口')
  }
  for (const args of [{ action: 'snapshot' }, { action: 'tabs' },
    { action: 'navigate', url: 'https://example.org' }]) {
    assert.equal((await decideBrowserPermission(ctx, { ...exec, arguments: args }, next)).kind, 'allow')
  }
  preset = 'danger-full-access'
  assert.equal((await decideBrowserPermission(ctx, { ...exec, arguments: { action: 'click' } }, next)).kind, 'allow')
  assert.equal((await decideBrowserPermission(ctx, { ...exec, agent: undefined }, next)).kind, 'deny')
})
