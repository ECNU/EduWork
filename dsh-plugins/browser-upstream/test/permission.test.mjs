import assert from 'node:assert/strict'
import test from 'node:test'
import { browserGuard, browserPermission } from '../lib/permission.js'

const prefix = 'mcp__playwright-mcp__'
const ctx = mode => ({ sandboxPolicy: { resolve: () => ({ mode }) } })
const call = (name, args = {}) => ({ name: prefix + name, agent: { session: {} }, arguments: args })
const allow = () => ({ kind: 'allow' })

test('browser steps run without asking; the application asks for what is risky whatever the task', () => {
  const context = ctx('workspace-write')
  const kind = (name, args) => browserPermission(context, call(name, args), allow).kind
  for (const name of ['browser_snapshot', 'browser_find', 'browser_console_messages', 'browser_network_requests', 'browser_network_request', 'browser_wait_for', 'browser_take_screenshot',
    'browser_click', 'browser_type', 'browser_fill_form', 'browser_select_option', 'browser_hover', 'browser_drag', 'browser_press_key', 'browser_navigate_back', 'browser_resize']) {
    assert.equal(kind(name), 'allow')
  }
  for (const args of [{ action: 'list' }, { action: 'select', index: 1 }, { action: 'new' }, { action: 'new', url: 'https://example.org/' }, { action: 'close', index: 1 }]) assert.equal(kind('browser_tabs', args), 'allow')
  assert.equal(kind('browser_navigate', { url: 'https://example.org/' }), 'allow')
  // Cancelling a file chooser, clearing it or dismissing a dialog sends nothing.
  for (const [name, args] of [['browser_file_upload', {}], ['browser_file_upload', { paths: [] }], ['browser_handle_dialog', { accept: false }], ['browser_drop', { element: 'Zone', target: 'e1' }]]) assert.equal(kind(name, args), 'allow')
  for (const [name, args] of [['browser_navigate', { url: 'http://localhost/' }], ['browser_tabs', { action: 'new', url: 'http://localhost:3000/' }], ['browser_evaluate', {}],
    ['browser_file_upload', { paths: ['/synthetic/a.pdf'] }], ['browser_drop', { paths: ['/synthetic/a.pdf'] }], ['browser_handle_dialog', { accept: true }], ['browser_close', {}], ['browser_future_interaction', {}]]) {
    const decision = browserPermission(context, call(name, args), allow)
    assert.equal(decision.kind, 'ask', name)
    assert.equal(decision.displayReason.en, decision.reason)
    assert.match(decision.displayReason.zh, /^允许智能体/)
    assert.equal(browserPermission(ctx('danger-full-access'), call(name, args), allow).kind, 'allow')
  }
  // Saving what was read into the workspace follows the session's file access.
  for (const name of ['browser_snapshot', 'browser_console_messages', 'browser_network_requests', 'browser_network_request', 'browser_take_screenshot']) {
    assert.equal(browserPermission(ctx('read-only'), call(name, { filename: 'capture.txt' }), allow).kind, 'ask')
    assert.equal(kind(name, { filename: 'capture.txt' }), 'allow')
  }
})

test('approvals name what the Agent will do', () => {
  const ask = (name, args) => browserPermission(ctx('workspace-write'), call(name, args), allow).displayReason
  assert.deepEqual(ask('browser_evaluate', { function: '() => 1' }), { en: 'Allow the Agent to run a script in the page', zh: '允许智能体在网页中运行脚本' })
  assert.equal(ask('browser_evaluate', { function: '() => 1', element: 'Chart', target: 'e3' }).zh, '允许智能体对“Chart”运行脚本')
  assert.equal(ask('browser_file_upload', { paths: ['/synthetic/a.pdf'] }).zh, '允许智能体上传“a.pdf”')
  assert.equal(ask('browser_drop', { element: 'Drop zone', target: 'e4', paths: ['/synthetic/a.pdf', '/synthetic/b.png'] }).en, 'Allow the Agent to drop "a.pdf", "b.png" onto "Drop zone"')
  assert.equal(ask('browser_handle_dialog', { accept: true }).zh, '允许智能体确认网页弹出的对话框')
  assert.equal(ask('browser_handle_dialog', { accept: true, promptText: `${'line '.repeat(20)}\nend` }).zh, `允许智能体在网页弹出的对话框中输入“${'line '.repeat(11)}line…”并确认`)
  assert.equal(ask('browser_navigate', { url: 'http://127.0.0.1:8080/' }).zh, '允许智能体打开本机或内网地址 http://127.0.0.1:8080/')
  assert.equal(ask('browser_tabs', { action: 'new', url: 'http://10.0.0.8/' }).zh, '允许智能体在新标签页打开本机或内网地址 http://10.0.0.8/')
  const save = (name, args) => browserPermission(ctx('read-only'), call(name, args), allow).displayReason.zh
  assert.equal(save('browser_snapshot', { filename: 'page.md' }), '允许智能体把网页数据保存到“page.md”')
  assert.equal(save('browser_take_screenshot', { filename: 'page.png' }), '允许智能体把网页截图保存为“page.png”')
  // An unfamiliar or malformed call still asks, then meets the server's validation.
  assert.equal(ask('browser_file_upload', { paths: 'a.pdf' }).zh, '允许智能体使用浏览器工具 browser_file_upload')
  assert.equal(ask('browser_future_interaction').en, 'Allow the Agent to use the browser tool browser_future_interaction')
})

test('final guard denies host code outside full access and direct local-file navigation', () => {
  for (const mode of ['read-only', 'workspace-write']) assert.match(browserGuard(ctx(mode), call('browser_run_code_unsafe')), /full access/)
  assert.equal(browserGuard(ctx('danger-full-access'), call('browser_run_code_unsafe')), undefined)
  assert.match(browserGuard(ctx('danger-full-access'), { ...call('browser_snapshot'), agent: undefined }), /Agent/)
  assert.match(browserGuard(ctx('workspace-write'), call('browser_navigate', { url: 'file:///synthetic' })), /HTTP/)
  assert.match(browserGuard(ctx('workspace-write'), call('browser_navigate', { url: 'https://user:secret@example.org/' })), /credentials/)
  assert.match(browserGuard(ctx('danger-full-access'), call('browser_tabs', { action: 'new', url: 'file:///synthetic' })), /HTTP/)
  assert.equal(browserGuard(ctx('workspace-write'), { name: 'web_search' }), undefined)
})
