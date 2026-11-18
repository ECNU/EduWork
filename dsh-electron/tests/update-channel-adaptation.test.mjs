import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { execFileSync } from 'node:child_process'
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

test('the locked upstream coordinator cancels its active download token on dispose', async () => {
  const file = 'apps/desktop/src/update-coordinator.ts'
  const upstream = execFileSync('git', ['-C', 'D:/Workspace/EduWork/upstream/dsh', 'show', `38a6a5c965aa99ab525161efb7cc5cf1fe62fced:${file}`])
  const lock = JSON.parse(await readFile(new URL('../upstream-inputs-pinned-source.json', import.meta.url), 'utf8'))
  assert.equal(createHash('sha256').update(upstream).digest('hex'), lock[file])
  const original = upstream.toString('utf8')
  assert.match(original, /downloadUpdate\(this\.cancellation\)/)
  assert.match(original, /this\.cancellation\?\.cancel\(\)/)
  const source = adaptNativeDesktopSource(file, original)
  assert.match(source, /await this\.updater\.downloadUpdate\(this\.cancellation\)/)
  assert.match(source, /dispose\(\): void \{\s*this\.disposed = true\s*this\.cancellation\?\.cancel\(\)/)
  assert.match(source, /downloadedBytes: progress\.transferred, totalBytes: progress\.total/)
})

test('the desktop update contract exposes real download byte counts', async () => {
  const file = 'apps/desktop/src/ipc.ts'
  const upstream = execFileSync('git', ['-C', 'D:/Workspace/EduWork/upstream/dsh', 'show', `38a6a5c965aa99ab525161efb7cc5cf1fe62fced:${file}`]).toString('utf8')
  const lock = JSON.parse(await readFile(new URL('../upstream-inputs-pinned-source.json', import.meta.url), 'utf8'))
  assert.equal(createHash('sha256').update(upstream).digest('hex'), lock[file])
  const source = adaptNativeDesktopSource(file, upstream)
  assert.match(source, /readonly downloadedBytes\?: number\s+readonly totalBytes\?: number/)
})
