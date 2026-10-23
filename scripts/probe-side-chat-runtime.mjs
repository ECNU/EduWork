// Exercise the real locked Runtime in an isolated synthetic home. This is a
// compatibility probe, not a model/provider or desktop end-to-end acceptance.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export async function probeSideChatRuntime({ runtime, output }) {
  runtime = resolve(runtime)
  output = resolve(output)
  await mkdir(output) // Never reuse a profile or overwrite previous evidence.
  const require = createRequire(join(runtime, 'package.json'))
  const load = name => import(pathToFileURL(require.resolve(name)).href)
  const plugin = async name => { const module = await load(name); return module.default ?? module }
  const { Context } = await load('@deepseek-ai/cordis')
  const sessionModule = await load('@deepseek-ai/dsh-session')
  const { SessionId, buildForkSeed } = sessionModule
  const { createUserMessage } = await load('@deepseek-ai/dsh-llm')
  const context = new Context()
  const result = {
    schemaVersion: 1,
    kind: 'eduwork-side-chat-runtime-compatibility',
    synthetic: true,
    modelRequests: 0,
    runtimeVersion: require('@deepseek-ai/dsh-agent-loop/package.json').version,
    runtimeReceiptSHA256: null,
    checks: {},
    scope: 'session-lifecycle-only',
    lifecycleCompatibility: false,
  }
  const receipt = await readFile(join(runtime, '.chatecnu-dsh-runtime.json')).catch(() => null)
  if (receipt) result.runtimeReceiptSHA256 = createHash('sha256').update(receipt).digest('hex')
  try {
    for (const name of [
      '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-system-prompt',
      '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-agent',
    ]) await context.plugin(await plugin(name))
    await context.plugin(await plugin('@deepseek-ai/dsh-session-persistence-jsonl'), { root: join(output, 'sessions') })
    await context.plugin(await plugin('@deepseek-ai/dsh-agent-loop'), { agents: [] })

    const source = context.sessions.create(SessionId('side-probe-source'), { meta: { cwd: output } })
    source.append('turn/start', { turn: 1 })
    const selected = source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'SYNTHETIC_SELECTED_MESSAGE' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const seed = buildForkSeed(source.snapshotEvents(), selected.seq)
    source.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    source.append('turn/start', { turn: 2 })
    source.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'SYNTHETIC_FUTURE_MESSAGE' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const childId = SessionId('side-probe-child')
    const handle = await context.agents.create({
      sessionId: childId,
      seed,
      inheritedEventCount: selected.seq + 1,
      // Deliberately exercise this option against the unchanged published
      // factory: an ignored option must not be reported as supported.
      ephemeral: true,
      meta: { cwd: output, parentSession: source.id, isSeeded: true },
    })
    try {
      const child = handle.agent.session
      const snapshot = child.snapshotEvents()
      assert.equal(snapshot.some(event => JSON.stringify(event).includes('SYNTHETIC_FUTURE_MESSAGE')), false)
      assert.equal(snapshot.find(event => event.type === 'session/end-seed')?.seq, selected.seq + 1)
      assert.equal(snapshot.some(event => event.type === 'turn/end' && event.data.reason.kind === 'forked'), true)
      assert.notEqual(child.id, source.id)
      result.checks.exactIndependentFork = true
      result.checks.openTurnRepair = true
      await context.sessionPersistence.flush()
      result.checks.ephemeralSkipsPersistence = (await context.sessionPersistence.stat(childId)) === undefined
      result.checks.ephemeralExcludedFromCorpus = !context.sessions.list().some(session => session.id === childId)
      result.checks.explicitEphemeralLifecycle = child.header.ephemeral === true
      result.checks.noModelRequest = !snapshot.some(event => event.type === 'request/header')
    } finally {
      await handle.dispose()
    }
    result.checks.disposalRemovesLiveSession = context.sessions.get(childId) === undefined
    result.checks.disposalLeavesNoStoredSession = (await context.sessionPersistence.stat(childId)) === undefined
    result.lifecycleCompatibility = Object.values(result.checks).every(value => value === true)
  } catch (error) {
    result.error = { name: error.name, message: error.message }
    throw error
  } finally {
    await context.fiber.dispose()
    result.finishedAt = new Date().toISOString()
    await writeFile(join(output, 'compatibility.json'), JSON.stringify(result, null, 2) + '\n')
  }
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { runtime: { type: 'string' }, output: { type: 'string' } } })
  if (!values.runtime || !values.output) throw new Error('Usage: node scripts/probe-side-chat-runtime.mjs --runtime <locked-runtime> --output <new-evidence-directory>')
  console.log(JSON.stringify(await probeSideChatRuntime(values), null, 2))
}
