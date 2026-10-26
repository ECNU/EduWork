import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { migratePortableToInstalled } from '../scripts/migrate-portable-to-installed.mjs'

const dshCommit = '1'.repeat(40)
const now = () => '2026-10-26T00:00:00.000Z'

async function writeJSON(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 2) + '\n')
}
async function missing(path) {
  try { await access(path); return false } catch { return true }
}

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'eduwork-installed-migration-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const source = join(base, 'source')
  const target = join(base, 'target')
  const writable = join(base, 'W')
  const external = join(base, 'external-workspace')
  const namespace = 'example-electron'
  const sourceDesktop = { schemaVersion: 1, shell: 'electron', appId: 'org.eduwork.example.electron',
    distribution: 'example', productVersion: '0.4.9', product: '../product', node: '../runtime/node.exe', configurationOwnership: 'user' }
  const targetDesktop = { ...sourceDesktop, productVersion: '0.4.9-dev.20261026.2', dataLayout: 'installed' }
  const sourceRelease = { version: '0.4.9', dshVersion: '0.2.1-rc.3', dshCommit }
  const targetRelease = { ...sourceRelease, version: '0.4.9-dev.20261026.2' }
  const manifest = version => ({ schemaVersion: 1, kind: 'eduwork-portable-release', version,
    distribution: 'example', shell: 'electron', platform: 'windows-x64',
    files: [{ path: 'resources/app/eduwork.desktop.json' }, { path: 'config/eduwork.jsonc' }] })
  await writeJSON(join(source, 'resources/app/eduwork.desktop.json'), sourceDesktop)
  await writeJSON(join(source, 'release.json'), sourceRelease)
  await writeJSON(join(source, 'RELEASE-MANIFEST.json'), manifest('0.4.9'))
  await writeJSON(join(target, 'resources/app/eduwork.desktop.json'), targetDesktop)
  await writeJSON(join(target, 'release.json'), targetRelease)
  await writeJSON(join(target, 'RELEASE-MANIFEST.json'), manifest('0.4.9-dev.20261026.2'))
  await mkdir(join(source, 'config/examples'), { recursive: true })
  await writeFile(join(source, 'config/eduwork.jsonc'), '{"desktop":{"closeAction":"exit","detailsPanelWidth":480}}\n')
  await writeFile(join(source, 'config/examples/README.md'), 'example\n')
  const data = join(source, 'data', namespace)
  await mkdir(join(data, 'dsh/sessions/project/session-1'), { recursive: true })
  await mkdir(join(data, 'dsh/storages/session_projcache/sessions'), { recursive: true })
  await mkdir(join(data, 'dsh/skills/synthetic'), { recursive: true })
  await mkdir(join(data, 'dsh/.skill-staging'), { recursive: true })
  await mkdir(join(data, 'browser'), { recursive: true })
  await mkdir(join(data, 'browser/Cache'), { recursive: true })
  await mkdir(join(data, 'logs'), { recursive: true })
  await mkdir(join(source, 'data/state'), { recursive: true })
  await mkdir(join(source, 'data/configuration'), { recursive: true })
  await mkdir(external, { recursive: true })
  await writeFile(join(external, 'README.txt'), 'external\n')
  await writeFile(join(data, 'dsh/sessions/project/session-1/session.v4.jsonl.zstd'), 'session\n')
  await writeJSON(join(data, 'dsh/storages/workspace.json'), {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['workspace-1'], archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: 'workspace-1' },
    tables: { workspaces: { 'workspace-1': { path: external, title: 'external', sessionIds: ['session-1'], createdAt: now(), updatedAt: now() } } },
  })
  await writeJSON(join(data, 'dsh/storages/session_projcache/sessions/session-1.json'), { version: 7 })
  await writeFile(join(data, 'dsh/memory.sqlite3'), 'memory\n')
  await writeFile(join(data, 'dsh/skills/synthetic/SKILL.md'), '---\nname: synthetic\ndescription: synthetic\n---\n')
  await writeFile(join(data, 'dsh/.skill-staging/old'), 'staging\n')
  await writeFile(join(data, 'browser/Local State'), '{"os_crypt":{}}\n')
  await writeFile(join(data, 'browser/credentials.encrypted'), 'vault\n')
  await writeFile(join(data, 'browser/Preferences'), 'preferences\n')
  await writeFile(join(data, 'browser/Cache/cache.bin'), 'cache\n')
  await writeFile(join(data, 'browser/lockfile'), '')
  await writeFile(join(data, 'logs/desktop-host.log'), 'log\n')
  await writeJSON(join(source, 'data/state/update-preferences.json'), { schemaVersion: 1, policy: 'stable', source: 'user' })
  await writeFile(join(source, 'data/configuration/eduwork.previous.jsonc'), 'previous\n')
  return { base, source, target, writable, external, namespace, sourceDesktop, targetDesktop }
}

const options = (fixture, extra = {}) => ({
  sourceRoot: fixture.source, targetRoot: fixture.target, writableRoot: fixture.writable,
  listProcesses: async () => [], now, ...extra,
})

async function writeSlowMigration(f, name = 'slow-migration.mjs') {
  const wrapper = join(f.base, name)
  const moduleUrl = new URL('../scripts/migrate-portable-to-installed.mjs', import.meta.url).href
  await writeFile(wrapper, `
import { writeFile } from 'node:fs/promises'
import { migratePortableToInstalled } from ${JSON.stringify(moduleUrl)}
const marker = process.argv[2]
await migratePortableToInstalled({
  sourceRoot: ${JSON.stringify(f.source)},
  targetRoot: ${JSON.stringify(f.target)},
  writableRoot: ${JSON.stringify(f.writable)},
  statfsImpl: async () => {
    await new Promise(resolve => setTimeout(resolve, 400))
    return { bsize: 1, bavail: Number.MAX_SAFE_INTEGER }
  },
  copyFileImpl: async () => {
    await writeFile(marker, 'started\\n')
    await new Promise(resolve => setTimeout(resolve, 60000))
  },
})
`)
  return wrapper
}

async function writePreJournalMigration(f, name = 'pre-journal.mjs') {
  const wrapper = join(f.base, name)
  const moduleUrl = new URL('../scripts/migrate-portable-to-installed.mjs', import.meta.url).href
  await writeFile(wrapper, `
import { writeFile } from 'node:fs/promises'
import { migratePortableToInstalled } from ${JSON.stringify(moduleUrl)}
const marker = process.argv[2]
await migratePortableToInstalled({
  sourceRoot: ${JSON.stringify(f.source)},
  targetRoot: ${JSON.stringify(f.target)},
  writableRoot: ${JSON.stringify(f.writable)},
  statfsImpl: async () => {
    await writeFile(marker, 'statfs-started\\n')
    await new Promise(resolve => setTimeout(resolve, 60000))
  },
})
`)
  return wrapper
}

async function waitForPath(path, timeout = 5000) {
  for (let i = 0; i < timeout / 25; i++) {
    if (existsSync(path)) return true
    await delay(25)
  }
  return false
}

async function waitForExit(child, timeout = 5000) {
  if (child.exitCode !== null) return
  let timer
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('child did not exit')), timeout) }),
  ]).finally(() => clearTimeout(timer))
}

test('migrates the selected portable data into an activated installed writable root', async t => {
  const f = await fixture(t)
  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.files.length > 0, true)
  assert.ok(result.sourceHandoffRoot)
  assert.equal(result.source, f.source)
  assert.equal(await missing(f.source), true)
  const marker = JSON.parse(await readFile(join(f.writable, '.eduwork-writable-root.json'), 'utf8'))
  assert.deepEqual(marker, { schemaVersion: 1, layout: 'installed', distribution: 'example',
    productVersion: '0.4.9-dev.20261026.2', createdAt: now() })
  const receipt = JSON.parse(await readFile(join(f.writable, '.eduwork-migration-receipt.json'), 'utf8'))
  assert.equal(receipt.state, 'activated')
  assert.equal(receipt.source.root, f.source)
  assert.equal(receipt.source.handoffRoot, result.sourceHandoffRoot)
  assert.equal(receipt.source.handoffAt, now())
  assert.equal(receipt.source.distribution, 'example')
  assert.equal(receipt.target.dataLayout, 'installed')
  assert.ok(receipt.files.some(file => file.target === `data/${f.namespace}/dsh/storages/session_projcache/sessions/session-1.json`))
  assert.ok(receipt.files.some(file => file.target === `data/${f.namespace}/browser/credentials.encrypted`))
  assert.equal(await readFile(join(f.writable, 'config/eduwork.jsonc'), 'utf8'), '{"desktop":{"closeAction":"exit","detailsPanelWidth":480}}\n')
  assert.equal(await readFile(join(f.writable, `data/${f.namespace}/dsh/sessions/project/session-1/session.v4.jsonl.zstd`), 'utf8'), 'session\n')
  assert.equal(await readFile(join(f.writable, `data/${f.namespace}/browser/Local State`), 'utf8'), '{"os_crypt":{}}\n')
  assert.equal(await readFile(join(f.writable, `data/${f.namespace}/browser/credentials.encrypted`), 'utf8'), 'vault\n')
  assert.equal(await missing(join(f.writable, `data/${f.namespace}/browser/Cache/cache.bin`)), true)
  assert.equal(await missing(join(f.writable, `data/${f.namespace}/dsh/.skill-staging/old`)), true)
  assert.equal(await missing(join(f.writable, 'data/state/updates')), true)
  assert.equal(await readFile(join(result.sourceHandoffRoot, 'config/eduwork.jsonc'), 'utf8'), '{"desktop":{"closeAction":"exit","detailsPanelWidth":480}}\n')
})

test('restores the old program path when the copy fails', async t => {
  const f = await fixture(t)
  let count = 0, handoffs = 0
  await assert.rejects(migratePortableToInstalled(options(f, {
    handoffImpl: async (from, to) => { handoffs++; await rename(from, to) },
    copyFileImpl: async (from, to) => {
      count++
      if (count === 2) throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
      await writeFile(to, await readFile(from))
    },
  })), /no space left/)
  assert.equal(handoffs, 1)
  assert.equal(await missing(f.source), false)
  assert.equal(await readFile(join(f.source, 'config/eduwork.jsonc'), 'utf8'), '{"desktop":{"closeAction":"exit","detailsPanelWidth":480}}\n')
  assert.deepEqual((await readdir(f.base)).filter(name => name.includes('.handoff-')), [])
  assert.equal(existsSync(f.source + '.handoff.json'), false)
  assert.equal(await missing(f.writable), true)
})

test('restores the old program path when a process appears after handoff', async t => {
  const f = await fixture(t)
  let checks = 0, handoffs = 0
  await assert.rejects(migratePortableToInstalled(options(f, {
    handoffImpl: async (from, to) => { handoffs++; await rename(from, to) },
    listProcesses: async () => {
      checks++
      return checks === 1 ? [] : [{ ProcessId: 9, ExecutablePath: join(f.source, 'EduWork-Electron.exe') }]
    },
  })), /still running/)
  assert.equal(handoffs, 1)
  assert.equal(checks, 2)
  assert.equal(await missing(f.source), false)
  assert.deepEqual((await readdir(f.base)).filter(name => name.includes('.handoff-')), [])
  assert.equal(existsSync(f.source + '.handoff.json'), false)
  assert.equal(await missing(f.writable), true)
})

test('refuses a non-empty target and leaves it unchanged', async t => {
  const f = await fixture(t)
  await mkdir(f.writable)
  await writeFile(join(f.writable, 'keep.txt'), 'keep\n')
  await assert.rejects(migratePortableToInstalled(options(f)), /not empty/)
  assert.equal(await readFile(join(f.writable, 'keep.txt'), 'utf8'), 'keep\n')
  assert.equal(await missing(join(f.writable, '.eduwork-writable-root.json')), true)
})

test('refuses a running old client', async t => {
  const f = await fixture(t)
  await assert.rejects(migratePortableToInstalled(options(f, {
    listProcesses: async () => [{ ProcessId: 42, ExecutablePath: join(f.source, 'EduWork-Electron.exe') }],
  })), /still running/)
  assert.equal(await missing(f.writable), true)
})

test('refuses when the old program directory cannot be moved aside', async t => {
  const f = await fixture(t)
  await assert.rejects(migratePortableToInstalled(options(f, {
    handoffImpl: async () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }) },
  })), /cannot be moved aside/)
  assert.equal(await missing(f.source), false)
  assert.equal(existsSync(f.source + '.handoff.json'), false)
  assert.equal(await missing(f.writable), true)
})

test('refuses a pending update transaction', async t => {
  const f = await fixture(t)
  await mkdir(join(f.source, 'data/state/updates'), { recursive: true })
  await writeFile(join(f.source, 'data/state/updates/pending-update.json'), '{}\n')
  await assert.rejects(migratePortableToInstalled(options(f)), /pending update/)
  assert.equal(await missing(f.writable), true)
})

test('rechecks update transactions after handoff', async t => {
  const f = await fixture(t)
  await assert.rejects(migratePortableToInstalled(options(f, {
    handoffImpl: async (from, to) => {
      await mkdir(join(from, 'data/state/updates'), { recursive: true })
      await writeFile(join(from, 'data/state/updates/pending-update.json'), '{}\n')
      await rename(from, to)
    },
  })), /pending update/)
  assert.equal(await missing(f.source), false)
  assert.equal(await missing(f.writable), true)
  assert.deepEqual((await readdir(f.base)).filter(name => name.includes('.handoff-')), [])
  assert.equal(existsSync(f.source + '.handoff.json'), false)
})

test('rechecks update transactions before activation', async t => {
  const f = await fixture(t)
  let handoffPath, injected = false
  await assert.rejects(migratePortableToInstalled(options(f, {
    handoffImpl: async (from, to) => { handoffPath = to; await rename(from, to) },
    copyFileImpl: async (from, to) => {
      await writeFile(to, await readFile(from))
      if (!injected) {
        injected = true
        await mkdir(join(handoffPath, 'data/state/updates'), { recursive: true })
        await writeFile(join(handoffPath, 'data/state/updates/pending-update.json'), '{}\n')
      }
    },
  })), /pending update/)
  assert.equal(await missing(f.source), false)
  assert.equal(existsSync(f.source + '.handoff.json'), false)
  assert.equal(await missing(f.writable), true)
})

test('ignores an empty legacy lock and retries', async t => {
  const f = await fixture(t)
  await writeFile(f.source + '.handoff.json.lock', '')
  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
})

test('retries after termination before journal publication', async t => {
  const f = await fixture(t)
  const marker = join(f.base, 'statfs-started')
  const wrapper = await writePreJournalMigration(f)
  const child = spawn(process.execPath, [wrapper, marker], { stdio: 'ignore' })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  assert.equal(await waitForPath(marker), true, 'migration did not reach statfs')
  assert.equal(existsSync(f.source + '.handoff.json'), false)
  child.kill('SIGKILL')
  await waitForExit(child)
  await delay(100)

  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
})

test('recognizes an activated target when journal cleanup was interrupted', async t => {
  const f = await fixture(t)
  const handoff = f.source + '.handoff-test'
  await rename(f.source, handoff)
  await mkdir(f.writable)
  await writeFile(f.source + '.handoff.json.lock', '{}')
  await writeFile(join(f.writable, '.eduwork-migration-receipt.json'), JSON.stringify({
    schemaVersion: 1, kind: 'eduwork-portable-to-installed-v1', state: 'activated',
    source: { root: f.source, handoffRoot: handoff },
    target: { root: f.writable, programRoot: f.target },
  }, null, 2) + '\n')
  await assert.rejects(migratePortableToInstalled(options(f)), /already activated/)
  assert.equal(await missing(f.source), true)
  assert.equal(existsSync(handoff), true)
})

test('serializes two recoveries of the same interrupted state', async t => {
  const f = await fixture(t)
  const handoff = f.source + '.handoff-test'
  await rename(f.source, handoff)
  const staging = join(f.base, '.eduwork-migration-test.staging')
  await mkdir(staging)
  await writeFile(f.source + '.handoff.json', JSON.stringify({
    schemaVersion: 1, kind: 'eduwork-handoff-v1', sourceRoot: f.source, handoffRoot: handoff,
    staging, targetRoot: f.target, writableRoot: f.writable, targetWasEmptyAtHandoff: false,
    createdAt: now(), pid: 0,
  }, null, 2) + '\n')
  const markerA = join(f.base, 'recover-a')
  const markerB = join(f.base, 'recover-b')
  const wrapper = await writeSlowMigration(f, 'slow-recovery.mjs')
  const childA = spawn(process.execPath, [wrapper, markerA], { stdio: 'ignore' })
  const childB = spawn(process.execPath, [wrapper, markerB], { stdio: 'ignore' })
  t.after(() => {
    for (const child of [childA, childB]) if (child.exitCode === null) child.kill('SIGKILL')
  })
  let winner
  for (let i = 0; i < 200 && !winner; i++) {
    if (existsSync(markerA)) winner = markerA
    else if (existsSync(markerB)) winner = markerB
    else await delay(25)
  }
  assert.ok(winner, 'neither recovery reached copy')
  await delay(300)
  const win = winner === markerA ? childA : childB
  const lose = winner === markerA ? childB : childA
  win.kill('SIGKILL')
  await waitForExit(win)
  await waitForExit(lose)
  assert.equal(Number(existsSync(markerA)) + Number(existsSync(markerB)), 1)

  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
  assert.equal(existsSync(f.source + '.handoff.json'), false)
})

test('refuses while another migration owns the handoff journal', async t => {
  const f = await fixture(t)
  const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  t.after(() => { if (owner.exitCode === null) owner.kill('SIGKILL') })
  await delay(100)
  const journal = {
    schemaVersion: 1, kind: 'eduwork-handoff-v1', sourceRoot: f.source,
    handoffRoot: f.source + '.handoff-live', staging: join(f.base, '.eduwork-migration-live.staging'),
    targetRoot: f.target, writableRoot: f.writable, createdAt: now(), pid: owner.pid,
  }
  await writeFile(f.source + '.handoff.json', JSON.stringify(journal, null, 2) + '\n')
  await assert.rejects(migratePortableToInstalled(options(f)), /Another migration is in progress/)
  assert.equal(await missing(f.source), false)
  assert.equal(await missing(f.writable), true)
})

test('serializes two migrations started together', async t => {
  const f = await fixture(t)
  const markerA = join(f.base, 'started-a')
  const markerB = join(f.base, 'started-b')
  const wrapper = await writeSlowMigration(f, 'slow-shared.mjs')
  const childA = spawn(process.execPath, [wrapper, markerA], { stdio: 'ignore' })
  const childB = spawn(process.execPath, [wrapper, markerB], { stdio: 'ignore' })
  t.after(() => {
    for (const child of [childA, childB]) if (child.exitCode === null) child.kill('SIGKILL')
  })
  let winner
  for (let i = 0; i < 200 && !winner; i++) {
    if (existsSync(markerA)) winner = markerA
    else if (existsSync(markerB)) winner = markerB
    else await delay(25)
  }
  assert.ok(winner, 'neither migration reached copy')
  await delay(300)
  const win = winner === markerA ? childA : childB
  const lose = winner === markerA ? childB : childA
  win.kill('SIGKILL')
  await waitForExit(win)
  await waitForExit(lose)
  assert.equal(Number(existsSync(markerA)) + Number(existsSync(markerB)), 1)

  const journalPath = f.source + '.handoff.json'
  assert.equal(existsSync(journalPath), true)
  const journal = JSON.parse(await readFile(journalPath, 'utf8'))
  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
  assert.equal(existsSync(journalPath), false)
  assert.equal(existsSync(journal.handoffRoot), false)
})

test('recovers a killed migration with an originally empty writable root', async t => {
  const f = await fixture(t)
  await mkdir(f.writable)
  const marker = join(f.base, 'copy-started-empty-w')
  const wrapper = await writeSlowMigration(f, 'slow-empty-w.mjs')
  const child = spawn(process.execPath, [wrapper, marker], { stdio: 'ignore' })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  assert.equal(await waitForPath(marker), true, 'migration copy did not start')
  child.kill('SIGKILL')
  await waitForExit(child)
  await delay(100)
  const journal = JSON.parse(await readFile(f.source + '.handoff.json', 'utf8'))
  assert.equal(journal.targetWasEmptyAtHandoff, true)

  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
  assert.equal(existsSync(f.source + '.handoff.json'), false)
})

test('dry-run reports pending handoff recovery without changing it', async t => {
  const f = await fixture(t)
  const handoff = f.source + '.handoff-test'
  await rename(f.source, handoff)
  const staging = join(f.base, '.eduwork-migration-test.staging')
  await mkdir(staging)
  const journalPath = f.source + '.handoff.json'
  await writeFile(journalPath, JSON.stringify({
    schemaVersion: 1, kind: 'eduwork-handoff-v1', sourceRoot: f.source, handoffRoot: handoff,
    staging, targetRoot: f.target, writableRoot: f.writable, createdAt: now(), pid: 0,
    targetWasEmptyAtHandoff: false,
  }, null, 2) + '\n')

  const result = await migratePortableToInstalled(options(f, { dryRun: true }))
  assert.equal(result.dryRun, true)
  assert.equal(result.recovery.action, 'restore')
  assert.equal(await missing(f.source), true)
  assert.equal(existsSync(handoff), true)
  assert.equal(existsSync(staging), true)
  assert.equal(existsSync(journalPath), true)
})

test('recovers a handoff left by a killed migration and retries', async t => {
  const f = await fixture(t)
  const marker = join(f.base, 'copy-started')
  const wrapper = await writeSlowMigration(f)
  const child = spawn(process.execPath, [wrapper, marker], { stdio: 'ignore' })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  assert.equal(await waitForPath(marker), true, 'migration copy did not start')
  assert.equal(child.exitCode, null, 'migration child exited before termination')
  child.kill('SIGKILL')
  await waitForExit(child)
  await delay(100)

  const journalPath = f.source + '.handoff.json'
  const journal = JSON.parse(await readFile(journalPath, 'utf8'))
  assert.equal(await missing(f.source), true)
  assert.equal(await missing(f.writable), true)
  assert.equal(existsSync(journal.handoffRoot), true)

  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
  assert.equal(existsSync(journalPath), false)
  assert.equal(existsSync(journal.handoffRoot), false)
  assert.ok(existsSync(result.sourceHandoffRoot))
  assert.deepEqual((await readdir(f.base)).filter(name => name.includes('.eduwork-migration-')), [])
})

test('refuses a workspace inside the old program directory', async t => {
  const f = await fixture(t)
  await writeJSON(join(f.source, `data/${f.namespace}/dsh/storages/workspace.json`), {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['internal'], archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: 'internal' },
    tables: { workspaces: { internal: { path: join(f.source, 'workspace-internal'), title: 'internal', sessionIds: [], createdAt: now(), updatedAt: now() } } },
  })
  await assert.rejects(migratePortableToInstalled(options(f)), /Program-directory workspaces/)
  assert.equal(await missing(f.writable), true)
})

test('cleans its staging on a copy failure and can retry', async t => {
  const f = await fixture(t)
  let count = 0
  await assert.rejects(migratePortableToInstalled(options(f, {
    copyFileImpl: async (from, to) => {
      count++
      if (count === 2) throw new Error('synthetic copy failure')
      await writeFile(to, await readFile(from))
    },
  })), /synthetic copy failure/)
  assert.equal(await missing(f.writable), true)
  assert.deepEqual((await readdir(f.base)).filter(name => name.includes('.eduwork-migration-')), [])
  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
})

test('refuses when the source changes during copy', async t => {
  const f = await fixture(t)
  let copied = false, handoffPath
  await assert.rejects(migratePortableToInstalled(options(f, {
    handoffImpl: async (from, to) => { handoffPath = to; await rename(from, to) },
    copyFileImpl: async (from, to) => {
      await writeFile(to, await readFile(from))
      if (!copied) {
        copied = true
        await writeFile(join(handoffPath, 'config/eduwork.jsonc'), '{"desktop":{"closeAction":"tray"}}\n')
      }
    },
  })), /Source data changed/)
  assert.equal(await missing(f.source), false)
  assert.equal(await missing(f.writable), true)
})

test('refuses identity mismatches and a source vault without Local State', async t => {
  const f = await fixture(t)
  await writeJSON(join(f.target, 'release.json'), { ...JSON.parse(await readFile(join(f.target, 'release.json'), 'utf8')), dshVersion: '0.9.0' })
  await assert.rejects(migratePortableToInstalled(options(f)), /DSH versions differ/)
  const f2 = await fixture(t)
  await rm(join(f2.source, `data/${f2.namespace}/browser/Local State`))
  await assert.rejects(migratePortableToInstalled(options(f2)), /Local State/)
  assert.equal(await missing(f2.writable), true)
})

test('refuses when the target volume lacks free space', async t => {
  const f = await fixture(t)
  const dry = await migratePortableToInstalled(options(f, {
    dryRun: true, statfsImpl: async () => ({ bsize: 1, bavail: Number.MAX_SAFE_INTEGER }),
  }))
  const requiredBytes = dry.space.requiredBytes
  assert.ok(requiredBytes > 0)
  await assert.rejects(migratePortableToInstalled(options(f, {
    statfsImpl: async () => ({ bsize: 1, bavail: requiredBytes - 1 }),
  })), /Insufficient free space/)
  assert.equal(await missing(f.source), false)
  assert.equal(await missing(f.writable), true)
})

test('records the space estimate and refuses when it cannot be read', async t => {
  const f = await fixture(t)
  await assert.rejects(migratePortableToInstalled(options(f, {
    statfsImpl: async () => { throw new Error('statfs unavailable') },
  })), /free space/)
  assert.equal(await missing(f.source), false)
  assert.equal(await missing(f.writable), true)

  const f2 = await fixture(t)
  const result = await migratePortableToInstalled(options(f2, {
    statfsImpl: async () => ({ bsize: 1, bavail: Number.MAX_SAFE_INTEGER }),
  }))
  assert.ok(result.space.freeBytes > result.space.requiredBytes)
  assert.equal(result.receipt.space.requiredBytes, result.space.requiredBytes)
  assert.equal(result.receipt.space.freeBytes, result.space.freeBytes)
})

test('dry-run inventories without writing a target', async t => {
  const f = await fixture(t)
  const result = await migratePortableToInstalled(options(f, { dryRun: true }))
  assert.equal(result.dryRun, true)
  assert.equal(result.sourceHandoffRoot, undefined)
  assert.ok(result.files.some(file => file.target.endsWith('session.v4.jsonl.zstd')))
  assert.equal(await missing(f.source), false)
  assert.equal(await missing(f.writable), true)
})

test('activates into an existing empty target root', async t => {
  const f = await fixture(t)
  await mkdir(f.writable)
  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
  assert.equal(await readFile(join(f.writable, '.eduwork-writable-root.json'), 'utf8').then(JSON.parse).then(marker => marker.layout), 'installed')
})

test('creates a missing writable root parent and checks the nearest existing volume', async t => {
  const f = await fixture(t)
  f.writable = join(f.base, 'nested', 'W')
  const result = await migratePortableToInstalled(options(f))
  assert.equal(result.receipt.state, 'activated')
  assert.equal(await readFile(join(f.writable, '.eduwork-writable-root.json'), 'utf8').then(JSON.parse).then(marker => marker.layout), 'installed')
  assert.ok(result.space.freeBytes > 0)
})

test('refuses a non-empty update transaction directory', async t => {
  const f = await fixture(t)
  await mkdir(join(f.source, 'data/state/updates/transactions/0.4.9'), { recursive: true })
  await writeFile(join(f.source, 'data/state/updates/transactions/0.4.9/backup'), 'backup\n')
  await assert.rejects(migratePortableToInstalled(options(f)), /unfinished update transaction/)
  assert.equal(await missing(f.writable), true)
})

test('leaves no W when the activated receipt cannot be written', async t => {
  const f = await fixture(t)
  let writes = 0
  await assert.rejects(migratePortableToInstalled(options(f, {
    writeReceiptImpl: async (path, data, opts) => {
      writes++
      if (writes === 2) throw new Error('receipt write failure')
      await writeFile(path, data, opts)
    },
  })), /receipt write failure/)
  assert.equal(await missing(f.writable), true)
  assert.equal(await readFile(join(f.source, 'config/eduwork.jsonc'), 'utf8'), '{"desktop":{"closeAction":"exit","detailsPanelWidth":480}}\n')
  assert.deepEqual((await readdir(f.base)).filter(name => name.includes('.eduwork-migration-')), [])
  assert.equal(existsSync(f.source + '.handoff.json'), false)
})

test('rechecks old processes before activation', async t => {
  const f = await fixture(t)
  let checks = 0, handoffs = 0
  await assert.rejects(migratePortableToInstalled(options(f, {
    handoffImpl: async (from, to) => { handoffs++; await rename(from, to) },
    listProcesses: async () => {
      checks++
      return checks === 3 ? [{ ProcessId: 7, ExecutablePath: join(f.source, 'EduWork-Electron.exe') }] : []
    },
  })), /still running/)
  assert.equal(handoffs, 1)
  assert.equal(checks, 3)
  assert.equal(await missing(f.source), false)
  assert.equal(existsSync(f.source + '.handoff.json'), false)
  assert.equal(await missing(f.writable), true)
})

test('refuses missing or contradictory identity fields and manifests', async t => {
  const f1 = await fixture(t)
  await writeJSON(join(f1.source, 'release.json'), { version: '0.4.9', dshVersion: '', dshCommit })
  await assert.rejects(migratePortableToInstalled(options(f1)), /DSH identity is missing/)

  const f2 = await fixture(t)
  await writeJSON(join(f2.source, 'resources/app/eduwork.desktop.json'), { ...f2.sourceDesktop, appId: 'org.example.bad.electron' })
  await assert.rejects(migratePortableToInstalled(options(f2)), /appId/)

  const f3 = await fixture(t)
  await writeJSON(join(f3.source, 'release.json'), { version: '0.4.8', dshVersion: '0.2.1-rc.3', dshCommit })
  await assert.rejects(migratePortableToInstalled(options(f3)), /desktop and release versions differ/)

  const f4 = await fixture(t)
  await rm(join(f4.target, 'RELEASE-MANIFEST.json'))
  await assert.rejects(migratePortableToInstalled(options(f4)), /RELEASE-MANIFEST.json is missing/)

  const f5 = await fixture(t)
  await writeJSON(join(f5.target, 'RELEASE-MANIFEST.json'), { schemaVersion: 1, kind: 'eduwork-portable-release',
    version: '0.4.8', distribution: 'example', shell: 'electron', platform: 'windows-x64',
    files: [{ path: 'resources/app/eduwork.desktop.json' }, { path: 'config/eduwork.jsonc' }] })
  await assert.rejects(migratePortableToInstalled(options(f5)), /manifest version differs/)
})
