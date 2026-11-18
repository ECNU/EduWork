import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startInstalledUpdates } from '../src/installed-updates.mjs'

test('installed updates without app-update.yml are unsupported and never check a feed', async t => {
  const resourcesPath = await mkdtemp(join(tmpdir(), 'eduwork-installed-update-'))
  t.after(() => rm(resourcesPath, { recursive: true, force: true }))
  let requests = 0
  class Coordinator {
    constructor() { assert.fail('must not start the updater') }
    state = { phase: 'idle' }
    check() { requests++; throw Error('must not check') }
    dispose() {}
  }
  const backend = startInstalledUpdates({ app: { isPackaged: true }, resourcesPath, version: '1.0.0',
    policy: 'stable', Coordinator, stopBeforeInstall: assert.fail })
  const status = await backend.action('status')
  assert.equal(status.update.enabled, false)
  assert.equal(status.update.canToggle, false)
  assert.equal(status.update.state, 'disabled')
  await backend.action('check-updates')
  assert.equal(requests, 0)
  await backend.close()
})
