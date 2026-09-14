import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { explicitMemoryRequest, executionSources } from '../lib/session-context.js'

test('installed DSH Session preserves real user/tool authorization boundaries', () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const output = execFileSync(process.execPath, ['scripts/check-session-contract.mjs', process.env.MEMORY_RUNTIME || root], { cwd: root, encoding: 'utf8', windowsHide: true })
  const result = JSON.parse(output)
  assert.equal(result.passed, true)
  assert.equal(result.externalAutomaticWriteBlocked, true)
})

const user = (seq, text, kind = 'user') => ({ seq, type: 'user/message', data: {
  id: `message-${seq}`, source: { kind }, content: [{ type: 'text', text }],
} })
const tool = (seq, name) => ({ seq, type: 'tool/call', data: { name, callId: `call-${seq}` } })

for (const shape of ['legacy events', 'current snapshotEvents']) {
  test(`${shape}: direct-user intent and external-tool provenance stay bounded to the latest user turn`, () => {
    let events = [user(0, 'Remember the old preference'), tool(1, 'old_tool'), user(2, 'Summarize this'), tool(3, 'web_search'), user(4, 'Remember this', 'plugin'), tool(5, 'memory_recall')]
    const session = shape.startsWith('legacy') ? { id: 'synthetic-session', get events() { return events } }
      : { id: 'synthetic-session', snapshotEvents() { return Object.freeze([...events]) }, get events() { throw new Error('removed API must not be read') } }
    assert.equal(explicitMemoryRequest(session), false, 'plugin text cannot authorize a write')
    const sources = executionSources({ agent: { session } }, [])
    assert.deepEqual(sources.filter(x => x.kind === 'tool').map(x => x.toolName), ['web_search'])
    assert.equal(sources.find(x => x.kind === 'session').eventSeq, 2)
    assert.equal(sources.find(x => x.kind === 'session').messageId, 'message-2')
    events = [...events, user(6, '请记住这个偏好')]
    assert.equal(explicitMemoryRequest(session), true)
    assert.equal(executionSources({ agent: { session } }, []).filter(x => x.kind === 'tool').length, 0)
  })
}

test('unreadable or failing Session snapshots fail closed instead of dropping external provenance', () => {
  for (const session of [{ id: 'unreadable' }, { id: 'invalid', snapshotEvents: () => null }, { id: 'failed', snapshotEvents() { throw new Error('snapshot failed') }, events: [] }]) {
    assert.throws(() => explicitMemoryRequest(session))
    assert.throws(() => executionSources({ agent: { session } }, []))
  }
})
