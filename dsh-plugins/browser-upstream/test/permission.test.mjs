import assert from 'node:assert/strict'
import test from 'node:test'
import { browserGuard, browserPermission } from '../lib/permission.js'

const prefix = 'mcp__playwright-mcp__'
const ctx = mode => ({ sandboxPolicy: { resolve: () => ({ mode }) } })
const call = (name, args = {}) => ({ name: prefix + name, agent: { session: {} }, arguments: args })
const allow = () => ({ kind: 'allow' })

test('preserves read access and public interaction confirmations', () => {
  const context = ctx('workspace-write')
  for (const name of ['browser_snapshot', 'browser_console_messages', 'browser_network_requests', 'browser_wait_for']) {
    assert.equal(browserPermission(context, call(name), allow).kind, 'allow')
  }
  assert.equal(browserPermission(context, call('browser_navigate', { url: 'https://example.org/' }), allow).kind, 'allow')
  assert.equal(browserPermission(context, call('browser_navigate', { url: 'http://localhost/' }), allow).kind, 'ask')
  for (const name of ['browser_click', 'browser_type', 'browser_evaluate', 'browser_file_upload', 'browser_take_screenshot', 'browser_close', 'browser_future_interaction']) {
    assert.equal(browserPermission(context, call(name), allow).kind, 'ask')
    assert.equal(browserPermission(ctx('danger-full-access'), call(name), allow).kind, 'allow')
  }
  assert.equal(browserPermission(context, call('browser_tabs', { action: 'list' }), allow).kind, 'allow')
  assert.equal(browserPermission(context, call('browser_tabs', { action: 'close' }), allow).kind, 'ask')
  for (const name of ['browser_snapshot', 'browser_console_messages', 'browser_network_requests']) {
    assert.equal(browserPermission(ctx('read-only'), call(name, { filename: 'capture.txt' }), allow).kind, 'ask')
  }
})

test('final guard denies host code outside full access and direct local-file navigation', () => {
  for (const mode of ['read-only', 'workspace-write']) assert.match(browserGuard(ctx(mode), call('browser_run_code_unsafe')), /full access/)
  assert.equal(browserGuard(ctx('danger-full-access'), call('browser_run_code_unsafe')), undefined)
  assert.match(browserGuard(ctx('danger-full-access'), { ...call('browser_snapshot'), agent: undefined }), /Agent/)
  assert.match(browserGuard(ctx('workspace-write'), call('browser_navigate', { url: 'file:///synthetic' })), /HTTP/)
  assert.match(browserGuard(ctx('workspace-write'), call('browser_navigate', { url: 'https://user:secret@example.org/' })), /credentials/)
  assert.equal(browserGuard(ctx('workspace-write'), { name: 'web_search' }), undefined)
})
