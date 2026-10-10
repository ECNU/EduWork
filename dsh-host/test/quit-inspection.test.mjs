import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectDesktopQuit } from '../quit-inspection.mjs'

test('legacy quit inspects all agents, queued input and per-agent jobs using the legacy owner contract', async () => {
  const agent = { id: 'synthetic', status: 'idle', inbox: { nextTurn: [], nextStep: [] }, session: { ownEvents: () => [] } }
  const jobs = []
  const ctx = { get: name => ({ agents: { list: () => [agent] }, jobs: { list: owner => {
    assert.ok(owner === undefined || owner === agent, '0.1.5 jobs expects the Agent, not its ID')
    return owner === agent ? jobs : []
  } } })[name] }
  assert.deepEqual(await inspectDesktopQuit(ctx), { activeTasks: false, scheduledTasks: false })
  agent.status = 'running'; assert.equal((await inspectDesktopQuit(ctx)).activeTasks, true)
  agent.status = 'idle'; agent.inbox.nextStep.push({ id: 'queued' })
  assert.equal((await inspectDesktopQuit(ctx)).activeTasks, true)
  agent.inbox.nextStep.length = 0; jobs.push({ status: 'stopping' })
  assert.equal((await inspectDesktopQuit(ctx)).activeTasks, true)
  jobs[0].status = 'completed'; assert.equal((await inspectDesktopQuit(ctx)).activeTasks, false)
})

test('missing legacy task services cannot report a safe idle state', async () => {
  await assert.rejects(inspectDesktopQuit({ get: () => undefined }), /unavailable/)
})
