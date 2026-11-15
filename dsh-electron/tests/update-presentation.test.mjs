import test from 'node:test'
import assert from 'node:assert/strict'
import { desktopUpdatePresentation } from '../src/update-presentation.mjs'

const snapshot = (state, update = {}, extra = {}) => ({
  shell: 'electron', version: '0.4.10', phase: state, message: 'internal detail',
  update: { enabled: true, state, ...update },
  contentUpdate: { enabled: true, state: 'current' },
  ...extra,
})

test('idle states hide the software indicator, including installed and disabled', () => {
  for (const state of ['idle', 'up_to_date', 'current', 'installed', 'disabled']) {
    assert.deepEqual(desktopUpdatePresentation(snapshot(state)), { phase: 'idle' }, state)
  }
  assert.deepEqual(desktopUpdatePresentation(snapshot('installed', { relaunchedVersion: '0.4.11', installOnNextStart: true })), { phase: 'idle' })
})

test('no backend yet is idle, but an existing unclassified backend error is unreadable', () => {
  assert.deepEqual(desktopUpdatePresentation(null), { phase: 'idle' })
  assert.deepEqual(desktopUpdatePresentation(undefined), { phase: 'idle' })
  assert.equal(desktopUpdatePresentation(snapshot('error', { error: 'start failed', enabled: false })), null)
})

test('macOS outer ready never becomes the ready phase; the inner addon state decides', () => {
  assert.deepEqual(desktopUpdatePresentation(snapshot('ready', { state: 'idle' })), { phase: 'idle' })
  assert.deepEqual(desktopUpdatePresentation(snapshot('ready', { state: 'downloading', downloadStage: 'extracting', totalBytes: 100, downloadedBytes: 100 })), { phase: 'verifying' })
  assert.deepEqual(desktopUpdatePresentation(snapshot('ready', { state: 'available', latestVersion: '0.4.11' })), { phase: 'available', version: '0.4.11' })
})

test('checking stays observational and does not advertise a stale version', () => {
  assert.deepEqual(desktopUpdatePresentation(snapshot('checking', { latestVersion: '0.4.11' })), { phase: 'checking' })
})

test('available uses only a valid latestVersion, never currentVersion', () => {
  assert.deepEqual(desktopUpdatePresentation(snapshot('available', { latestVersion: '0.4.11', currentVersion: '0.4.10' })), { phase: 'available', version: '0.4.11' })
  assert.deepEqual(desktopUpdatePresentation(snapshot('available', { currentVersion: '0.4.10' })), { phase: 'available' })
  for (const latestVersion of ['', '   ', 'x'.repeat(65), 'bad\u0000version', 42, null]) {
    assert.deepEqual(desktopUpdatePresentation(snapshot('available', { latestVersion })), { phase: 'available' }, String(latestVersion))
  }
})

test('downloading percent comes only from finite positive byte totals', () => {
  assert.deepEqual(desktopUpdatePresentation(snapshot('downloading', { totalBytes: 200, downloadedBytes: 100 })), { phase: 'downloading', percent: 50 })
  assert.deepEqual(desktopUpdatePresentation(snapshot('downloading', { totalBytes: 3, downloadedBytes: 1 })), { phase: 'downloading', percent: 33 })
  assert.deepEqual(desktopUpdatePresentation(snapshot('downloading', { totalBytes: 100, downloadedBytes: 0 })), { phase: 'downloading', percent: 0 })
  assert.deepEqual(desktopUpdatePresentation(snapshot('downloading', { totalBytes: 100, downloadedBytes: 150 })), { phase: 'downloading', percent: 100 })
  for (const progress of [
    { totalBytes: 0, downloadedBytes: 1 }, { totalBytes: -1, downloadedBytes: 1 },
    { totalBytes: 100, downloadedBytes: -1 }, { totalBytes: Number.NaN, downloadedBytes: 1 },
    { totalBytes: Number.POSITIVE_INFINITY, downloadedBytes: 1 }, { totalBytes: '100', downloadedBytes: 50 },
    { totalBytes: 100, downloadedBytes: Number.NaN }, { totalBytes: 100 },
  ]) assert.deepEqual(desktopUpdatePresentation(snapshot('downloading', progress)), { phase: 'downloading' }, JSON.stringify(progress))
  assert.deepEqual(desktopUpdatePresentation(snapshot('downloading', { busy: true, checkedFiles: 9, totalFiles: 10 })), { phase: 'downloading' })
})

test('verification and extraction are preparation, not a downloaded package', () => {
  for (const downloadStage of ['verifying', 'extracting']) {
    assert.deepEqual(desktopUpdatePresentation(snapshot('downloading', { downloadStage, totalBytes: 100, downloadedBytes: 100, latestVersion: '0.4.11' })), { phase: 'verifying', version: '0.4.11' })
  }
  assert.deepEqual(desktopUpdatePresentation(snapshot('verifying', { latestVersion: '0.4.11' })), { phase: 'verifying', version: '0.4.11' })
})

test('ready means awaiting installation, not upgrade success', () => {
  for (const install of [{}, { installOnQuit: true }, { installOnNextStart: true }]) {
    assert.deepEqual(desktopUpdatePresentation(snapshot('ready', { latestVersion: '0.4.11', ...install })), { phase: 'ready', version: '0.4.11' })
  }
  assert.deepEqual(desktopUpdatePresentation(snapshot('ready', { latestVersion: '0.4.11', relaunchedVersion: '0.4.11' })), { phase: 'ready', version: '0.4.11' })
})

test('applying is installing, and a cancelled install follows the real state again', () => {
  assert.deepEqual(desktopUpdatePresentation(snapshot('applying', { latestVersion: '0.4.11' })), { phase: 'installing', version: '0.4.11' })
  assert.deepEqual(desktopUpdatePresentation(snapshot('ready', { latestVersion: '0.4.11' })), { phase: 'ready', version: '0.4.11' })
})

test('error uses only a provable failedOperation; unclassified errors are unreadable', () => {
  for (const operation of ['check', 'download', 'install']) {
    assert.deepEqual(desktopUpdatePresentation(snapshot('error', { failedOperation: operation, error: 'private path' })), { phase: 'error', failure: operation })
  }
  for (const failedOperation of [undefined, '', 'network', 'apply', 'check-network', null]) {
    assert.equal(desktopUpdatePresentation(snapshot('error', { failedOperation })), null, String(failedOperation))
  }
  // Information-only appcast entries also arrive as state=error today, behind
  // the macOS outer phase=ready. They must never become available/downloadable.
  assert.equal(desktopUpdatePresentation(snapshot('ready', { state: 'error', error: '此更新需要前往发行页面查看说明。' })), null)
})

test('content-only facts never become a software indicator', () => {
  const contentOnly = {
    shell: 'electron', version: '0.4.10', phase: 'idle',
    update: { enabled: true, state: 'up_to_date' },
    contentUpdate: { enabled: true, state: 'available', latestRevision: 7 },
  }
  assert.deepEqual(desktopUpdatePresentation(contentOnly), { phase: 'idle' })
})

test('unknown or malformed snapshots are unreadable instead of ready or idle', () => {
  for (const value of [
    snapshot('cancelled'), { ...snapshot('idle'), update: null }, { ...snapshot('idle'), update: 'idle' },
    { ...snapshot('idle'), update: { state: 4 } }, 'update', 4, [],
  ]) assert.equal(desktopUpdatePresentation(value), null)
})

test('presentation exposes only the official whitelist fields', () => {
  const value = desktopUpdatePresentation(snapshot('downloading', {
    latestVersion: '0.4.11', totalBytes: 2, downloadedBytes: 1, fileName: 'C:\\private\\package.zip',
    error: 'stack at C:\\private', message: 'internal', releaseNotesURL: 'https://private.example/?token=1',
  }))
  assert.deepEqual(Object.keys(value).sort(), ['percent', 'phase', 'version'])
  assert.equal(JSON.stringify(value).includes('private'), false)
})
