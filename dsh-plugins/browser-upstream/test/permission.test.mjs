import assert from 'node:assert/strict'
import test from 'node:test'
import { browserGuard, browserPermission, browserResult } from '../lib/permission.js'

const prefix = 'mcp__playwright-mcp__'
const ctx = mode => ({ sandboxPolicy: { resolve: () => ({ mode }) } })
const session = () => ({ session: {} })
const call = (name, args = {}, agent = session()) => ({ name: prefix + name, agent, arguments: args })
const allow = () => ({ kind: 'allow' })
const accept = () => ({ kind: 'accept' })
// Synthetic DNS: rebind.example points to loopback, everything else is public.
const dns = { lookup: async host => host === 'rebind.example' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.215.14', family: 4 }] }
const permission = (context, exec) => browserPermission(context, exec, allow, dns)
const page = url => ({ isError: false, content: [{ type: 'text', text: `### Page\n- Page URL: ${url}\n- Page Title: t` }] })

test('preserves read access and public interaction confirmations', async () => {
  const context = ctx('workspace-write')
  for (const name of ['browser_snapshot', 'browser_console_messages', 'browser_network_requests', 'browser_wait_for']) {
    assert.equal((await permission(context, call(name))).kind, 'allow')
  }
  assert.equal((await permission(context, call('browser_navigate', { url: 'https://example.org/' }))).kind, 'allow')
  const local = await permission(context, call('browser_navigate', { url: 'http://localhost/' }))
  assert.equal(local.kind, 'ask')
  assert.equal(local.displayReason.en, local.reason)
  assert.equal(local.displayReason.zh, '允许智能体打开本机或内网上的网页')
  for (const name of ['browser_click', 'browser_type', 'browser_evaluate', 'browser_file_upload', 'browser_take_screenshot', 'browser_close', 'browser_future_interaction']) {
    const decision = await permission(context, call(name))
    assert.equal(decision.kind, 'ask')
    assert.equal(decision.displayReason.en, decision.reason)
    assert.equal(decision.displayReason.zh, '允许智能体操作网页，或访问内网、本机等非公开浏览器地址')
    assert.equal((await permission(ctx('danger-full-access'), call(name))).kind, 'allow')
  }
  assert.equal((await permission(context, call('browser_tabs', { action: 'list' }))).kind, 'allow')
  assert.equal((await permission(context, call('browser_tabs', { action: 'close' }))).kind, 'ask')
  for (const name of ['browser_snapshot', 'browser_console_messages', 'browser_network_requests']) {
    assert.equal((await permission(ctx('read-only'), call(name, { filename: 'capture.txt' }))).kind, 'ask')
  }
})

test('private targets are decided on resolved addresses and every URL argument', async () => {
  const context = ctx('workspace-write')
  for (const url of ['http://rebind.example/', 'http://[::ffff:7f00:1]/', 'http://0.0.0.0/', 'http://localhost./', 'http://nas.lan/', 'http://100.64.0.1/', 'http://router/']) {
    assert.equal((await permission(context, call('browser_navigate', { url }))).kind, 'ask', url)
  }
  assert.equal((await permission(context, call('browser_tabs', { action: 'new', url: 'http://rebind.example/' }))).kind, 'ask')
  assert.equal((await permission(context, call('browser_tabs', { action: 'new', url: 'https://example.org/' }))).kind, 'allow')
  const unresolvable = { lookup: async () => { throw new Error('ENOTFOUND') } }
  assert.equal((await browserPermission(context, call('browser_navigate', { url: 'https://missing.example/' }), allow, unresolvable)).kind, 'ask')
})

test('a redirect to an unapproved private page withholds the result and later silent reads', async () => {
  const context = ctx('workspace-write')
  const agent = session()
  const redirected = await browserResult(context, call('browser_navigate', { url: 'https://example.org/' }, agent), page('http://192.168.1.1/admin'), accept, dns)
  assert.equal(redirected.kind, 'block')
  assert.match(redirected.feedback[0].text, /192\.168\.1\.1.*withheld/)
  assert.equal((await permission(context, call('browser_snapshot', {}, agent))).kind, 'ask')
  const tabs = { isError: false, content: [{ type: 'text', text: '### Open tabs\n- 0: [a](https://example.org/)\n- 1: (current) [b](http://rebind.example/x)' }] }
  assert.equal((await browserResult(context, call('browser_tabs', { action: 'list' }, agent), tabs, accept, dns)).kind, 'block')
  // Back on a public page, reads are silent again.
  assert.equal((await browserResult(context, call('browser_navigate', { url: 'https://example.org/' }, agent), page('https://example.org/'), accept, dns)).kind, 'accept')
  assert.equal((await permission(context, call('browser_snapshot', {}, agent))).kind, 'allow')
})

test('a confirmed private navigation approves its origin for the Session', async () => {
  const context = ctx('workspace-write')
  const agent = session()
  const exec = call('browser_navigate', { url: 'http://localhost:3000/' }, agent)
  assert.equal((await browserResult(context, exec, page('http://localhost:3000/app'), accept, dns)).kind, 'accept')
  assert.equal((await permission(context, call('browser_navigate', { url: 'http://localhost:3000/other' }, agent))).kind, 'allow')
  assert.equal((await permission(context, call('browser_snapshot', {}, agent))).kind, 'allow')
  assert.equal((await browserResult(context, call('browser_snapshot', {}, agent), page('http://localhost:8080/'), accept, dns)).kind, 'block')
  assert.equal((await permission(context, call('browser_navigate', { url: 'http://localhost:3000/' }))).kind, 'ask', 'approval is per Session')
  assert.equal((await browserResult(ctx('danger-full-access'), call('browser_snapshot'), page('http://10.0.0.1/'), accept, dns)).kind, 'accept')
})

test('final guard denies host code outside full access and direct local-file navigation', () => {
  for (const mode of ['read-only', 'workspace-write']) assert.match(browserGuard(ctx(mode), call('browser_run_code_unsafe')), /full access/)
  assert.equal(browserGuard(ctx('danger-full-access'), call('browser_run_code_unsafe')), undefined)
  assert.match(browserGuard(ctx('danger-full-access'), { ...call('browser_snapshot'), agent: undefined }), /Agent/)
  assert.match(browserGuard(ctx('workspace-write'), call('browser_navigate', { url: 'file:///synthetic' })), /HTTP/)
  assert.match(browserGuard(ctx('workspace-write'), call('browser_navigate', { url: 'https://user:secret@example.org/' })), /credentials/)
  assert.match(browserGuard(ctx('workspace-write'), call('browser_tabs', { action: 'new', url: 'file:///synthetic' })), /HTTP/)
  assert.equal(browserGuard(ctx('workspace-write'), call('browser_tabs', { action: 'new' })), undefined)
  assert.equal(browserGuard(ctx('workspace-write'), { name: 'web_search' }), undefined)
})
