import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
      this.state = { phase: 'downloading', version: '1.1.0', percent: 20 }
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
  assert.equal(status.update.downloadedBytes, undefined)
  assert.equal(status.update.totalBytes, undefined)
  await Promise.race([
    backend.close(),
    new Promise((_, reject) => setTimeout(() => reject(Error('close waited for download')), 500)),
  ])
})
