import assert from 'node:assert/strict'
import test from 'node:test'
import { browserGuard, browserPermission } from '../lib/permission.js'

const prefix = 'mcp__playwright-mcp__'
const ctx = mode => ({ sandboxPolicy: { resolve: () => ({ mode }) } })
const call = (name, args = {}) => ({ name: prefix + name, agent: { session: {} }, arguments: args })
const allow = () => ({ kind: 'allow' })

test('preserves read access and public interaction confirmations', () => {
  const context = ctx('workspace-write')
  for (const name of ['browser_snapshot', 'browser_find', 'browser_console_messages', 'browser_network_requests', 'browser_network_request', 'browser_wait_for']) {
    assert.equal(browserPermission(context, call(name), allow).kind, 'allow')
  }
  assert.equal(browserPermission(context, call('browser_navigate', { url: 'https://example.org/' }), allow).kind, 'allow')
  assert.equal(browserPermission(context, call('browser_navigate', { url: 'http://localhost/' }), allow).kind, 'ask')
  for (const name of ['browser_click', 'browser_type', 'browser_evaluate', 'browser_file_upload', 'browser_take_screenshot', 'browser_close', 'browser_future_interaction']) {
    const decision = browserPermission(context, call(name), allow)
    assert.equal(decision.kind, 'ask')
    assert.equal(decision.displayReason.en, decision.reason)
    assert.match(decision.displayReason.zh, /^允许智能体/)
    assert.equal(browserPermission(ctx('danger-full-access'), call(name), allow).kind, 'allow')
  }
  for (const args of [{ action: 'list' }, { action: 'select', index: 1 }, { action: 'new' }, { action: 'new', url: 'https://example.org/' }]) {
    assert.equal(browserPermission(context, call('browser_tabs', args), allow).kind, 'allow')
  }
  assert.equal(browserPermission(context, call('browser_tabs', { action: 'new', url: 'http://localhost:3000/' }), allow).kind, 'ask')
  assert.equal(browserPermission(context, call('browser_tabs', { action: 'close' }), allow).kind, 'ask')
  for (const name of ['browser_snapshot', 'browser_console_messages', 'browser_network_requests', 'browser_network_request']) {
    assert.equal(browserPermission(ctx('read-only'), call(name, { filename: 'capture.txt' }), allow).kind, 'ask')
  }
})

test('approvals name the action the Agent asks for', () => {
  const ask = (name, args) => browserPermission(ctx('workspace-write'), call(name, args), allow).displayReason
  assert.deepEqual(ask('browser_click', { element: 'Greet button', target: 'e3' }), { en: 'Allow the Agent to click "Greet button"', zh: '允许智能体点击“Greet button”' })
  assert.equal(ask('browser_click', { element: 'Row', target: 'e4', doubleClick: true }).zh, '允许智能体双击“Row”')
  assert.equal(ask('browser_type', { element: 'Name box', target: 'e2', text: 'EduWork', submit: true }).zh, '允许智能体在“Name box”中输入“EduWork”并提交')
  assert.equal(ask('browser_fill_form', { fields: [
    { name: 'Name', type: 'textbox', target: 'e2', value: 'EduWork' },
    { name: 'Agree', type: 'checkbox', target: 'e5', value: 'true' },
  ] }).zh, '允许智能体填写表单：“Name”填“EduWork”，选中“Agree”')
  assert.equal(ask('browser_select_option', { element: 'Letter', target: 'e6', values: ['A', 'B'] }).en, 'Allow the Agent to select "A", "B" in "Letter"')
  assert.equal(ask('browser_file_upload', { paths: ['/synthetic/a.pdf'] }).zh, '允许智能体上传“a.pdf”')
  assert.equal(ask('browser_file_upload', { paths: [] }).zh, '允许智能体清空已选择的文件')
  assert.equal(ask('browser_file_upload', {}).zh, '允许智能体取消选择文件')
  assert.equal(ask('browser_navigate', { url: 'http://127.0.0.1:8080/' }).zh, '允许智能体打开本机或内网地址 http://127.0.0.1:8080/')
  assert.equal(ask('browser_tabs', { action: 'close', index: 2 }).zh, '允许智能体关闭标签页')
  assert.equal(ask('browser_snapshot', { filename: 'page.md' }).zh, '允许智能体把网页数据保存到“page.md”')
  assert.equal(ask('browser_type', { element: 'Notes', target: 'e7', text: `${'line '.repeat(20)}\nend` }).zh,
    `允许智能体在“Notes”中输入“${'line '.repeat(11)}line…”`)
  // An unfamiliar or malformed call still asks, then meets the server's validation.
  assert.equal(ask('browser_fill_form', { fields: 'Name=EduWork' }).zh, '允许智能体使用浏览器工具 browser_fill_form')
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
