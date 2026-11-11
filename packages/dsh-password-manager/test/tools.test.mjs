import test from 'node:test'
import assert from 'node:assert/strict'
import { registerPasswordTools } from '../src/tools.mjs'
import { defineTool } from '@deepseek-ai/dsh-tools'
const apply = ctx => registerPasswordTools(ctx, defineTool)

test('real DSH tool definition binds conversation identity from execution context', async () => {
  let tool, body
  apply({ tools: { register(value) { tool = value } }, desktopServices: { async passwordManager(value) { body = value; return { status: 'session-ready' } } } })
  const exec = { agent: { session: { id: 'actual-session', header: { origin: 'user' } } }, signal: new AbortController().signal }
  const result = await tool.execute({ action: 'login', provider: 'builtin', url: 'https://example.test/login' }, exec)
  assert.equal(result.status, 'session-ready')
  assert.deepEqual(body, { action: 'login', provider: 'builtin', url: 'https://example.test/login', sessionId: 'actual-session' })
  assert.equal((await tool.execute({ action: 'login', provider: 'builtin', url: 'https://example.test/login', sessionId: 'other-session' }, exec)).status, 'invalid-request')
  assert.equal((await tool.execute({ action: 'status' }, { ...exec, agent: undefined })).status, 'desktop-session-required')
  assert.equal((await tool.execute({ action: 'status' }, { ...exec, agent: { session: { header: { origin: 'subagent' } } } })).status, 'desktop-session-required')
})
test('tool errors are sanitized and unavailable native seam remains optional', async () => {
  let tool
  const exec = { agent: { session: { id: 'session', header: {} } } }
  apply({ tools: { register(value) { tool = value } }, desktopServices: {} })
  assert.equal((await tool.execute({ action: 'status' }, exec)).status, 'not-supported')
  apply({ tools: { register(value) { tool = value } }, desktopServices: { passwordManager() { throw Error('synthetic-secret') } } })
  assert.deepEqual(await tool.execute({ action: 'status' }, exec), { status: 'operation-failed' })
})
test('builtin tool passes trusted session and strips every non-status response field', async () => {
  let tool, body
  const exec = { agent: { session: { id: 'real-conversation', header: {} } } }
  apply({ tools: { register(value) { tool = value } }, desktopServices: { async passwordManager(request) {
    body = request; return { status: 'session-ready', password: 'secret', message: 'secret', cookies: ['secret'] }
  } } })
  const args = { action: 'login', provider: 'builtin', url: 'https://example.test/login' }
  assert.deepEqual(await tool.execute(args, exec), { status: 'session-ready' })
  assert.deepEqual(body, { ...args, sessionId: 'real-conversation' })
  apply({ tools: { register(value) { tool = value } }, desktopServices: { async passwordManager() { return { status: 'secret' } } } })
  assert.deepEqual(await tool.execute(args, exec), { status: 'operation-failed' })
})
