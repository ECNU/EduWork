import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm, readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import {discover, executable, probe} from '../src/discovery.js'

test('passive discovery finds executable candidates without running them', async () => {
  const home = await mkdtemp(join(tmpdir(), 'agent-discovery-'))
  try {
    await mkdir(join(home, '.local/bin'), {recursive: true})
    const marker = join(home, 'executed')
    await writeFile(join(home, '.local/bin/agent'), `#!/bin/sh\ntouch '${marker}'\n`, {mode: 0o755})
    const rows = await discover({home, path: '', platform: 'linux'})
    assert.equal(rows[1].command, join(home, '.local/bin/agent'))
    assert.deepEqual(rows[1].args, ['acp'])
    assert.equal(rows[0].installed, false)
    assert.equal(await executable('.local/bin/agent'), false)
    assert.equal(await executable(home), false)
    await assert.rejects(readFile(marker), {code: 'ENOENT'})
  } finally { await rm(home, {recursive: true, force: true}) }
})

async function withRuntime(fn) {
  const ctx = new Context()
  const fiber = ctx.plugin(LocalSubprocess)
  await fiber
  const handles = []
  const subprocess = {spawn(spec) {const handle = ctx.subprocess.spawn(spec); handles.push(handle); return handle}}
  try { await fn(subprocess) }
  finally {
    // A successful probe must return only after its managed range is gone.
    for (const handle of handles) await handle.waitForExit()
    await fiber.dispose()
  }
}
const response = `process.stdin.once('data', d => {const r=JSON.parse(d); if(r.method!=='initialize')process.exit(2); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result:{protocolVersion:1,agentCapabilities:{}}})+'\\n')});`

test('ACP sends initialize only, filters host credentials and reaps the process', async () => {
  await withRuntime(async subprocess => {
    const old = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'synthetic-secret-for-test'
    try {
      const script = `if(process.env.OPENAI_API_KEY)process.exit(4); ${response}`
      assert.deepEqual(await probe(subprocess, process.execPath, ['-e', script], {acp: true}), {ok: true, message: 'handshake'})
    } finally {if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old}
  })
})

test('probe rejects missing executable, invalid protocol, excessive output and timeout', async () => {
  await withRuntime(async subprocess => {
    assert.equal((await probe(subprocess, '/nonexistent/agent', [], {acp: true})).ok, false)
    for (const script of [response.replace('protocolVersion:1', 'protocolVersion:99'), `process.stdout.write('x'.repeat(70000));setInterval(()=>{},1000)`]) {
      assert.equal((await probe(subprocess, process.execPath, ['-e', script], {acp: true})).ok, false)
    }
    assert.equal((await probe(subprocess, process.execPath, ['-e', 'setInterval(()=>{},1000)'], {acp: true, timeout: 80})).message, 'timeout')
    assert.equal((await probe(subprocess, process.execPath, ['-e', 'process.exit(0)'])).message, 'connected')
    assert.equal((await probe(subprocess, process.execPath, ['-e', 'process.exit(1)'])).ok, false)
  })
})

test('cleanup failure cannot be reported as a successful login check', async () => {
  const subprocess = {spawn: () => ({done: Promise.resolve({exitCode: 0}), terminate() {}, waitForExit: async () => {throw Error('unproven')}})}
  assert.deepEqual(await probe(subprocess, '/fixture', []), {ok: false, message: 'cleanup_failed'})
})
