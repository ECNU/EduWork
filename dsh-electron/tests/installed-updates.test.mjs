import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { editableInstalledUpdateConfiguration, installedUpdateSource, launchPortableInstaller, startInstalledUpdates } from '../src/installed-updates.mjs'

test('NSIS sources separate official metadata from portable JSON and match GitHub prerelease prefixes', () => {
  const defaults = { provider: 'github', repository: 'ECNU/EduWork' }
  assert.deepEqual(installedUpdateSource({ defaults }), { provider: 'github', owner: 'ECNU', repo: 'EduWork', channel: 'latest' })
  for (const prefix of ['alpha', 'beta', 'rc', 'dev']) assert.equal(installedUpdateSource({ defaults, policy: 'development', version: `0.4.13-${prefix}.1` }).channel, prefix)
  assert.equal(installedUpdateSource({ defaults, updates: { provider: 'disabled' } }), null)
  assert.equal(installedUpdateSource({ defaults: { provider: 'static', manifestURL: 'https://example.test/stable/latest-windows-amd64.json' } }), null)
  assert.deepEqual(installedUpdateSource({ defaults: { provider: 'static', windowsFeeds: { development: 'https://example.test/development/nightly.yml' } }, policy: 'development' }),
    { provider: 'generic', url: 'https://example.test/development/', channel: 'nightly' })
  for (const url of ['http://example.test/latest.yml', 'https://user@example.test/latest.yml', 'https://example.test/latest.yml?token=x', 'https://example.test/old.json']) {
    assert.throws(() => installedUpdateSource({ defaults: { windowsFeeds: { stable: url } } }), /HTTPS/)
  }
  assert.equal(installedUpdateSource({ defaults: { windowsFeeds: { stable: 'https://old.example.test/latest.yml' } }, updates: defaults }).provider, 'github')
})

test('a legacy self-hosted source is retained until an explicit NSIS source replaces it', () => {
  const defaults = { provider: 'github', repository: 'ECNU/EduWork' }
  const prior = { schemaVersion: 1, enabled: true, provider: 'static', manifestBaseURL: 'https://school.example.test/updates', defaultPolicy: 'stable', target: 'windows-amd64' }
  const saved = editableInstalledUpdateConfiguration({ defaults, prior, version: '0.4.12', distribution: 'eduwork' })
  assert.equal(saved.provider, 'static'); assert.equal(saved.manifestURL, 'https://school.example.test/updates/stable/latest-windows-amd64.json')
  assert.equal(installedUpdateSource({ defaults: saved }), null)
  const updates = { provider: 'static', windowsFeeds: { stable: 'https://school.example.test/nsis/latest.yml' } }
  const replacement = editableInstalledUpdateConfiguration({ defaults, updates, prior, version: '0.4.13', distribution: 'eduwork' })
  assert.equal(installedUpdateSource({ defaults: replacement }).url, 'https://school.example.test/nsis/')
})

function fixture(extra = {}) {
  const updater = new EventEmitter(), calls = [], tokens = []
  updater.setFeedURL = source => { calls.push(['source', source]); updater.source = source }
  updater.downloadUpdate = async token => { tokens.push(token); updater.emit('download-progress', { transferred: 7, total: 10 }) }
  updater.quitAndInstall = () => calls.push(['original-install'])
  class Coordinator {
    constructor(publish, beforeRestart, input, enabled, version, result, channel) {
      assert.equal(input, updater); assert.equal(enabled(), true); assert.equal(version(), '0.4.13-dev.20261107.1')
      this.publish = publish; this.beforeRestart = beforeRestart
      updater.channel = channel; updater.allowPrerelease = channel === 'nightly'
      this.onError = error => publish({ phase: 'error', failedOperation: 'install', message: error.message })
      updater.on('error', this.onError)
    }
    async check(manual) { calls.push(['check', manual]); return this.publish({ phase: 'available', version: '0.4.14-dev.20261107.1' }) }
    async download(version) { calls.push(['download', version]); await updater.downloadUpdate(); return this.publish({ phase: 'ready', version }) }
    async install(version) { if (await this.beforeRestart()) updater.quitAndInstall(true, true); return this.publish({ phase: 'installing', version }) }
    dispose() { calls.push(['dispose']); updater.off('error', this.onError) }
  }
  let cancelled = false
  const options = { updater, Coordinator, version: '0.4.13-dev.20261107.1', defaults: { provider: 'github', repository: 'ECNU/EduWork' },
    policy: 'development', onPolicy: async policy => calls.push(['policy', policy]), beforeRestart: async () => true,
    createCancellationToken: () => ({ cancel() { cancelled = true } }), ...extra }
  const originalDownload = updater.downloadUpdate, originalInstall = updater.quitAndInstall
  const control = startInstalledUpdates(options)
  return { control, updater, calls, tokens, originalDownload, originalInstall, cancelled: () => cancelled }
}

test('adapter delegates check/download/install, preserves product versions, and cancels before disposing', async () => {
  const f = fixture()
  assert.equal(f.updater.channel, 'dev'); assert.equal(f.updater.allowPrerelease, true); assert.equal(f.updater.allowDowngrade, false)
  assert.equal((await f.control.action('check-updates')).update.latestVersion, '0.4.14-dev.20261107.1')
  const ready = await f.control.action('download-update')
  assert.equal(ready.update.state, 'ready'); assert.equal(ready.update.downloadedBytes, 7)
  await f.control.action('install-update')
  assert.ok(f.calls.some(([call]) => call === 'original-install'))
  await f.control.close()
  assert.equal(f.cancelled(), true); assert.equal(f.updater.downloadUpdate, f.originalDownload); assert.equal(f.updater.quitAndInstall, f.originalInstall)
  assert.equal(f.updater.listenerCount('download-progress'), 0)
  await assert.rejects(f.control.action('check-updates'), /关闭/)
})

test('changing policy recreates the official coordinator and keeps downgrade disabled', async () => {
  const f = fixture()
  await f.control.action('use-stable-updates')
  assert.equal(f.updater.source.channel, 'latest'); assert.equal(f.updater.allowPrerelease, false)
  assert.ok(f.calls.some(([call, value]) => call === 'policy' && value === 'stable'))
  await f.control.close()
})

test('portable handoff uses the verified installer with the source path as one argument and reports spawn failure', async () => {
  const installer = join(tmpdir(), 'verified setup.exe'), sourceRoot = join(tmpdir(), '旧版 有空格')
  let invocation, unref = false
  await launchPortableInstaller({ installer, sourceRoot, spawnProcess: (...args) => {
    invocation = args; const child = new EventEmitter(); child.unref = () => { unref = true }; queueMicrotask(() => child.emit('spawn')); return child
  } })
  assert.deepEqual(invocation[1], ['--updated', '--force-run', `/MIGRATE_FROM=${sourceRoot}`]); assert.equal(unref, true)
  await assert.rejects(launchPortableInstaller({ installer, sourceRoot, spawnProcess: () => {
    const child = new EventEmitter(); queueMicrotask(() => child.emit('error', new Error('blocked'))); return child
  } }), /blocked/)
  let failure
  const f = fixture({ installFromPortable: async () => { throw new Error('installer denied') }, onInstallFailure: message => { failure = message } })
  await f.control.action('check-updates'); await f.control.action('download-update'); await f.control.action('install-update')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(failure, 'installer denied'); assert.ok(!f.calls.some(([call]) => call === 'original-install'))
  await f.control.close()
})
