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
