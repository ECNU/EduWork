import assert from 'node:assert/strict'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { adaptNativeDesktopSource } from '../scripts/native-desktop-source.mjs'

test('Windows channel adaptation uses the release metadata names without permitting downgrades', async () => {
  const file = 'apps/desktop/src/updates/electron-updater/channel.ts'
  const upstream = `export function selectUpdateChannel(updater: AppUpdater, channel: 'nightly' | 'stable'): void {
  updater.channel = channel
  updater.allowDowngrade = false
  updater.allowPrerelease = true
}`
  const source = stripTypeScriptTypes(adaptNativeDesktopSource(file, upstream))
  const { selectUpdateChannel } = await import(`data:text/javascript,${encodeURIComponent(source)}`)
  const updater = {
    set channel(value) { this.selected = value; this.allowDowngrade = true },
  }
  for (const [channel, metadata, allowPrerelease] of [['stable', 'latest', false], ['nightly', 'dev', true]]) {
    selectUpdateChannel(updater, channel)
    assert.deepEqual([updater.selected, updater.allowPrerelease, updater.allowDowngrade], [metadata, allowPrerelease, false])
  }
})

test('the upstream update coordinator passes a cancellation token to downloads and cancels it on dispose', async () => {
  const file = 'apps/desktop/src/update-coordinator.ts'
  const upstream = `import { gt, valid } from 'semver'
class DesktopUpdateCoordinator {
  private disposed = false
  private downloadOperation: Promise<DesktopUpdateState> | undefined
  private installOperation: Promise<DesktopUpdateState> | undefined
  private readonly updater = { downloadUpdate: async () => {}, off: () => {} }
  private readonly onProgress = () => {}
  async download() {
    this.installOperation ??= Promise.resolve().then(async () => {
      await this.updater.downloadUpdate()
      this.installOperation = undefined
    })
    return this.installOperation
  }
  dispose(): void {
    this.disposed = true
    this.updater.off('download-progress', this.onProgress)
  }
}`
  const source = stripTypeScriptTypes(adaptNativeDesktopSource(file, upstream))
  assert.match(source, /CancellationToken/)
  assert.match(source, /downloadUpdate\(this\.downloadCancellation\)/)
  assert.match(source, /this\.downloadCancellation\?\.cancel\(\)/)
})
