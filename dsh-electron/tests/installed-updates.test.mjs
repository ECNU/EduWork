import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startInstalledUpdates } from '../src/installed-updates.mjs'
import { softwareUpdateControl } from '../src/software-update-control.mjs'

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

test('installed download requests return immediately and close cancels the active operation', async t => {
  const resourcesPath = await mkdtemp(join(tmpdir(), 'eduwork-installed-download-'))
  t.after(() => rm(resourcesPath, { recursive: true, force: true }))
  await writeFile(join(resourcesPath, 'app-update.yml'), 'provider: github\nowner: example\nrepo: product\n')
  let cancel, downloadStarted
  const started = new Promise(resolve => { downloadStarted = resolve })
  class Coordinator {
    state = { phase: 'available', version: '1.1.0' }
    check() {}
    async download() {
      this.state = { phase: 'downloading', version: '1.1.0', percent: 20, downloadedBytes: 2048, totalBytes: 10240 }
      downloadStarted()
      await new Promise(resolve => { cancel = resolve })
      this.state = { phase: 'idle' }
    }
    dispose() { cancel?.() }
  }
  const backend = startInstalledUpdates({ app: { isPackaged: true }, resourcesPath, version: '1.0.0',
    policy: 'stable', Coordinator, stopBeforeInstall: assert.fail })
  const status = await Promise.race([
    backend.action('download-update'),
    new Promise((_, reject) => setTimeout(() => reject(Error('download request blocked')), 100)),
  ])
  await started
  assert.equal(status.update.state, 'downloading')
  assert.equal(status.update.downloadedBytes, 2048)
  assert.equal(status.update.totalBytes, 10240)
  await Promise.race([
    backend.close(),
    new Promise((_, reject) => setTimeout(() => reject(Error('close waited for download')), 500)),
  ])
})

test('installed updates report scheduling as unsupported and reject the action', async t => {
  const resourcesPath = await mkdtemp(join(tmpdir(), 'eduwork-installed-schedule-'))
  t.after(() => rm(resourcesPath, { recursive: true, force: true }))
  await writeFile(join(resourcesPath, 'app-update.yml'), 'provider: github\nowner: example\nrepo: product\n')
  class Coordinator {
    state = { phase: 'ready', version: '1.1.0' }
    dispose() {}
  }
  const backend = startInstalledUpdates({ app: { isPackaged: true }, resourcesPath, version: '1.0.0',
    policy: 'stable', Coordinator, stopBeforeInstall: assert.fail })
  const status = await backend.action('status')
  assert.equal(status.message, '软件更新：ready')
  assert.equal(status.update.canSchedule, false)
  await assert.rejects(backend.action('schedule-update'), /不支持预约/)
  await backend.close()
})

test('installed package verification blocks software opt-out and channel changes', async t => {
  const resourcesPath = await mkdtemp(join(tmpdir(), 'eduwork-installed-verify-'))
  t.after(() => rm(resourcesPath, { recursive: true, force: true }))
  await writeFile(join(resourcesPath, 'app-update.yml'), 'provider: github\nowner: example\nrepo: product\n')
  const state = { phase: 'verifying', version: '1.1.0', percent: 100 }
  const policies = []
  class Coordinator {
    state = state
    async switchChannel(channel, persist) { await persist() }
    dispose() {}
  }
  const control = await softwareUpdateControl({ dataRoot: resourcesPath, version: '1.0.0',
    start: ({ policy }) => startInstalledUpdates({ app: { isPackaged: true }, resourcesPath, version: '1.0.0',
      policy, Coordinator, stopBeforeInstall: assert.fail, onPolicy: next => policies.push(next) }) })
  t.after(() => control.close())
  assert.equal((await control.action('status')).update.state, 'verifying')
  await assert.rejects(control.action('disable-software-updates'), /正在处理/)
  await assert.rejects(control.action('use-development-updates'), /正在处理/)
  assert.equal((await control.action('status')).update.userEnabled, true)
  assert.deepEqual(policies, [])
  state.phase = 'ready'
  assert.equal((await control.action('status')).update.state, 'ready')
  state.phase = 'error'
  assert.equal((await control.action('use-development-updates')).update.policy, 'development')
  assert.equal((await control.action('disable-software-updates')).update.userEnabled, false)
  assert.deepEqual(policies, ['development'])
})
