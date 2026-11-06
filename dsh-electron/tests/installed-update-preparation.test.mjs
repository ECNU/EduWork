import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function preparation({ approve = true, active = false, locked = active, replace = false, failClose = false } = {}) {
  const source = readFileSync(new URL('../src/native-desktop.mjs', import.meta.url), 'utf8')
  const start = source.indexOf('setInstalledUpdatePreparation('), end = source.indexOf('\n})', start)
  assert.ok(start >= 0 && end > start)
  const calls = [], host = { async updateTasks(action) { calls.push(action); return action === 'lock' ? locked : active } }
  const backend = { host }
  let prepare
  runInNewContext(source.slice(start, end + 3), { backend,
    setInstalledUpdatePreparation: callback => { prepare = callback },
    quit: { async confirm(value) { calls.push('confirm'); if (replace) backend.host = {}; return approve } },
    async closeBackend() { calls.push('close'); if (failClose) throw new Error('Host did not stop'); backend.host = undefined },
  })
  return { prepare, calls }
}

test('official installer handoff confirms tasks, locks new work and stops the exact Host before quitting', async () => {
  const f = preparation({ active: true })
  assert.equal(await f.prepare(), true)
  assert.deepEqual(f.calls, ['inspect', 'confirm', 'lock', 'close'])
})

test('cancelled or changed Host cannot start an installer', async () => {
  const cancelled = preparation({ approve: false })
  assert.equal(await cancelled.prepare(), false)
  assert.deepEqual(cancelled.calls, ['inspect', 'confirm'])
  const replaced = preparation({ replace: true })
  await assert.rejects(replaced.prepare(), /客户端状态已变化/)
  assert.deepEqual(replaced.calls, ['inspect', 'confirm'])
})

test('newly admitted tasks or shutdown failure unlock admission and refuse installer handoff', async () => {
  const changed = preparation({ active: false, locked: true })
  await assert.rejects(changed.prepare(), /新任务/)
  assert.deepEqual(changed.calls, ['inspect', 'confirm', 'lock', 'unlock'])
  const failure = preparation({ failClose: true })
  await assert.rejects(failure.prepare(), /Host did not stop/)
  assert.deepEqual(failure.calls, ['inspect', 'confirm', 'lock', 'close', 'unlock'])
})
