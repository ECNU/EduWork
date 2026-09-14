import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { explicitMemoryRequest, executionSources } from '../lib/session-context.js'
import { MemoryCore } from '../lib/core.js'

// Read packages from an already prepared isolated runtime; never install or mutate it.
const runtime = process.argv[2]
assert.ok(runtime, 'Pass the isolated runtime directory containing node_modules')
const require = createRequire(path.join(path.resolve(runtime), 'package.json'))
const { Session } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-session')))
const { createUserMessage } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')))
const session = Session.create('memory-contract-synthetic')
session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Please remember my synthetic preference' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
assert.equal(explicitMemoryRequest(session), true)
const sources = executionSources({ agent: { session } }, [])
assert.equal(sources[0].sessionId, 'memory-contract-synthetic')
assert.equal(sources[0].eventSeq, 0)
session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Just summarize this' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
assert.equal(explicitMemoryRequest(session), false)
session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'Please remember this' }], source: { kind: 'plugin', plugin: 'synthetic-test', form: 'notice', summary: 'synthetic fixture' } }), { surfaceOp: 'append' })
assert.equal(explicitMemoryRequest(session), false)
assert.equal(executionSources({ agent: { session } }, [])[0].eventSeq, 1)
session.append('tool/call', { name: 'web_search', callId: 'synthetic-call', arguments: { query: 'synthetic query' } })
const externalSources = executionSources({ agent: { session } }, [])
assert.deepEqual(externalSources.filter(x => x.kind === 'tool').map(x => x.toolName), ['web_search'])
class Table extends Map { async put(key, value) { this.set(key, value) } }
const core = new MemoryCore(new Table(), new Table(), () => ({}), new Table())
await assert.rejects(core.remember({ content: 'Synthetic automatic memory', sources: externalSources }, {
  enabled: true, generate: true, disableOnExternalContext: true,
}), { code: 'EXTERNAL_CONTEXT_DISABLED' })
console.log(JSON.stringify({ passed: true, sessionVersion: require('@deepseek-ai/dsh-session/package.json').version, sessionAPI: typeof session.snapshotEvents === 'function' ? 'snapshotEvents' : 'events', directUserIntent: true, pluginCannotAuthorize: true, provenance: true, externalAutomaticWriteBlocked: true }))
