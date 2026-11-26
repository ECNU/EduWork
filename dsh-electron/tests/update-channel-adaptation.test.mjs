import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { adaptNativeDesktopSource } from '../scripts/native-desktop-source.mjs'

const upstreamRoot = process.env.EDUWORK_TEST_UPSTREAM ?? 'D:/Workspace/EduWork/upstream/dsh'

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

test('the locked upstream coordinator shows install progress and cancels its active download token on dispose', async () => {
  const file = 'apps/desktop/src/update-coordinator.ts'
  const upstream = execFileSync('git', ['-C', upstreamRoot, 'show', `38a6a5c965aa99ab525161efb7cc5cf1fe62fced:${file}`])
  const lock = JSON.parse(await readFile(new URL('../upstream-inputs-pinned-source.json', import.meta.url), 'utf8'))
  assert.equal(createHash('sha256').update(upstream).digest('hex'), lock[file])
  const original = upstream.toString('utf8')
  assert.match(original, /downloadUpdate\(this\.cancellation\)/)
  const source = adaptNativeDesktopSource(file, original)
  assert.match(source, /this\.updater\.quitAndInstall\(false, true\)/)
  assert.doesNotMatch(source, /this\.updater\.quitAndInstall\(true, true\)/)
  assert.throws(() => adaptNativeDesktopSource(file, original.replace('quitAndInstall(true, true)', 'quitAndInstall(true, false)')),
    /Native desktop anchor changed in .*: .*quitAndInstall/)
  assert.match(source, /await this\.updater\.downloadUpdate\(this\.cancellation\)/)
  assert.match(source, /downloadedBytes: progress\.transferred, totalBytes: progress\.total/)
  const methodBody = value => {
    const start = value.indexOf('  dispose(): void {')
    assert.notEqual(start, -1)
    const opening = value.indexOf('{', start)
    let depth = 0
    for (let index = opening; index < value.length; index++) {
      if (value[index] === '{') depth++
      else if (value[index] === '}' && --depth === 0) return value.slice(start, index + 1)
    }
    assert.fail('dispose method is not closed')
  }
  const originalDispose = methodBody(original), adaptedDispose = methodBody(source)
  assert.doesNotMatch(originalDispose, /cancellation\?\.cancel/)
  assert.match(adaptedDispose, /this\.cancellation\?\.cancel\(\)/)
  const javascript = stripTypeScriptTypes(`class TestCoordinator { ${adaptedDispose} }`)
  const { TestCoordinator } = await import(`data:text/javascript,${encodeURIComponent(javascript + '\nexport { TestCoordinator }')}`)
  let cancelled = 0
  const removed = []
  const coordinator = Object.assign(new TestCoordinator(), {
    disposed: false, cancellation: { cancel() { cancelled++ } },
    updater: { off(event) { removed.push(event) } },
    checkOperation: undefined, downloadOperation: undefined, installOperation: undefined, switchTail: Promise.resolve(),
  })
  coordinator.dispose()
  assert.equal(coordinator.disposed, true)
  assert.equal(cancelled, 1)
  assert.deepEqual(removed, ['download-progress', 'update-downloaded'])
})

test('the desktop update contract exposes real download byte counts', async () => {
  const file = 'apps/desktop/src/ipc.ts'
  const upstream = execFileSync('git', ['-C', upstreamRoot, 'show', `38a6a5c965aa99ab525161efb7cc5cf1fe62fced:${file}`]).toString('utf8')
  const lock = JSON.parse(await readFile(new URL('../upstream-inputs-pinned-source.json', import.meta.url), 'utf8'))
  assert.equal(createHash('sha256').update(upstream).digest('hex'), lock[file])
  const source = adaptNativeDesktopSource(file, upstream)
  assert.match(source, /readonly downloadedBytes\?: number\s+readonly totalBytes\?: number/)
})
