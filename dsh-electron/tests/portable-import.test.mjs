import test from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtemp, mkdir, writeFile, readFile, readdir, rm, rename, symlink, lstat } from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { importPortableData, inspectPortableSource, buildCopyPlan, sessionProjectKey, windowsSourceProcessLister } from '../src/portable-import.mjs'
import { softwareUpdateControl } from '../src/software-update-control.mjs'

const distribution = 'eduwork'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'eduwork-portable-import-'))
  const source = join(base, 'old-app'), target = join(base, 'user-root')
  const home = join(source, 'data/eduwork-electron/dsh')
  const put = async (rel, content) => { const path = join(source, rel); await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content) }
  await put('release.json', JSON.stringify({ schemaVersion: 1, shell: 'electron', version: '0.4.13', dshVersion: '0.2.2-rc.1', distribution }))
  await put('resources/app/eduwork.desktop.json', JSON.stringify({ schemaVersion: 1, shell: 'electron', distribution, productVersion: '0.4.13' }))
  const internalPath = join(source, 'sample-workspace-internal')
  const externalPath = join(base, 'sample-workspace-external')
  const registry = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['ws-internal', 'ws-external'], archivedSessionIds: [], pinnedSessionIds: [], defaultWorkspaceId: 'ws-external' },
    tables: { workspaces: {
      'ws-internal': { path: internalPath, title: 'internal', sessionIds: ['session-internal'], createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z' },
      'ws-external': { path: externalPath, title: 'external', sessionIds: ['session-external'], createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z' }
    } }
  }
  await put('data/eduwork-electron/dsh/storages/workspace.json', JSON.stringify(registry, null, 2))
  const projcache = sessionId => JSON.stringify({ version: 7, record: { identity: { formatVersion: 4, cwd: sessionId === 'session-internal' ? internalPath : externalPath }, rows: { workingDirectory: { ver: 1, seq: 1, val: sessionId === 'session-internal' ? internalPath : externalPath } } } }, null, 2)
  await put('data/eduwork-electron/dsh/storages/session_projcache/sessions/session-internal.json', projcache('session-internal'))
  await put('data/eduwork-electron/dsh/storages/session_projcache/sessions/session-external.json', projcache('session-external'))
  await put(`data/eduwork-electron/dsh/sessions/${sessionProjectKey(internalPath)}/session-internal/session.v4.jsonl.zstd`, 'internal-session-bytes')
  await put(`data/eduwork-electron/dsh/sessions/${sessionProjectKey(externalPath)}/session-external/session.v4.jsonl.zstd`, 'external-session-bytes')
  await put('data/eduwork-electron/dsh/memory.sqlite3', 'memory-db')
  await put('data/eduwork-electron/dsh/attachments/v1/ab/cd/abcd', 'attachment-bytes')
  await put('data/eduwork-electron/dsh/profiles/desktop-017/cordis.patch.yml', 'ui-theme:\n  fontSize: 15\n')
  await put('data/eduwork-electron/dsh/profiles/desktop-017/cordis.yml', 'generated-runtime: true\n')
  await put('data/eduwork-electron/dsh/profiles/desktop-017/package.json', '{"name":"eduwork-desktop-profile","dependencies":{"user-plugin":"link:D:/old/location/user-plugin"}}')
  await put('data/eduwork-electron/dsh/profiles/desktop-017/pnpm-workspace.yaml', 'packages: []\n')
  await put('data/eduwork-electron/dsh/profiles/desktop-017/pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      user-plugin:\n        specifier: link:D:/old/location/user-plugin\n        version: link:../../../old/location/user-plugin\n")
  await put('data/eduwork-electron/dsh/logs/desktop.log', 'log-line')
  await put('data/eduwork-electron/browser/credentials.encrypted', 'v10-encrypted-bytes')
  await put('data/eduwork-electron/browser/Local Storage/leveldb/000001.log', 'local-storage')
  await put('data/eduwork-electron/browser/Cache/index', 'regenerable')
  await put('data/eduwork-electron/browser/GPUCache/index', 'regenerable')
  await put('config/eduwork.jsonc', '{\n  "schemaVersion": 1\n}\n')
  await put('data/configuration/state.json', '{"initialized":true}')
  await put('data/state/update-preferences.json', '{"automaticUpdates":false}')
  await put('data/state/update-channel-040.json', '{}')
  await put('data/state/software-update-preferences.json', '{"schemaVersion":1,"enabled":false}\n')
  await put('data/state/updates/transactions/0.4.13/health.ok', 'ok\n')
  await put('sample-workspace-internal/README.md', '# internal workspace\n')
  await mkdir(externalPath, { recursive: true })
  await writeFile(join(externalPath, 'hello.md'), '# external workspace\n')
  return { base, source, target, home, internalPath, externalPath, registry }
}

async function treeSnapshot(root) {
  const entries = []
  async function walk(dir, rel) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), info = await lstat(path)
      if (info.isDirectory()) await walk(path, `${rel}/${name}`)
      else entries.push({ path: `${rel}/${name}`, sha256: sha256(await readFile(path)) })
    }
  }
  await walk(root, '')
  return entries
}

const noProcesses = async () => []
const ampleSpace = async () => ({ bavail: 2 ** 30, bsize: 4096 })
const run = (options, extra = {}) => importPortableData({ distribution, listProcesses: noProcesses, freeSpace: ampleSpace, ...options, ...extra })

function mockFs(t, name, replacement) {
  const mocked = t.mock.method(fs, name, replacement)
  syncBuiltinESMExports()
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports() })
}

test('projectKey matches the runtime encoding observed in the shipped sample', () => {
  assert.equal(sessionProjectKey('D:\\Workspace\\EduWork\\wm13\\EduWork\\sample-workspace-internal'), '--D-Workspace-EduWork-wm13-EduWork-sample-workspace-internal--')
  assert.equal(sessionProjectKey('C:\\Users\\测试\\proj'), '--C-Users-~6D4B~8BD5-proj--')
  assert.equal(sessionProjectKey('D:\\a//b\\\\c'), '--D-a-b-c--')
  assert.throws(() => sessionProjectKey(''))
})

test('normal import copies the allowlist, remaps the internal workspace and never touches the source', async () => {
  const { base, source, target, internalPath, externalPath } = await fixture()
  try {
    const pendingUpdate = 'data/state/updates/pending-update.json'
    await writeFile(join(source, pendingUpdate), JSON.stringify({ installDir: source }))
    const before = await treeSnapshot(source)
    const progress = []
    const receipt = await run({ sourceRoot: source, targetRoot: target, onProgress: update => progress.push(update) })
    assert.equal(receipt.state, 'imported')
    assert.equal(receipt.sourceRoot, source)
    assert.ok(progress.length >= 1 && progress.at(-1).copied === receipt.files)
    const read = rel => readFile(join(target, rel), 'utf8')
    assert.equal(await read('data/eduwork-electron/dsh/memory.sqlite3'), 'memory-db')
    assert.equal(await read('data/eduwork-electron/dsh/profiles/desktop-017/cordis.patch.yml'), 'ui-theme:\n  fontSize: 15\n')
    assert.equal(await read('data/eduwork-electron/dsh/profiles/desktop-017/package.json'), '{"name":"eduwork-desktop-profile","dependencies":{"user-plugin":"link:D:/old/location/user-plugin"}}')
    assert.equal(await read('data/eduwork-electron/dsh/profiles/desktop-017/pnpm-workspace.yaml'), 'packages: []\n')
    assert.equal(await read('data/eduwork-electron/browser/credentials.encrypted'), 'v10-encrypted-bytes')
    assert.equal(await read('config/eduwork.jsonc'), '{\n  "schemaVersion": 1\n}\n')
    assert.equal(await read('data/state/update-preferences.json'), '{"automaticUpdates":false}')
    assert.equal(await read('data/state/update-channel-040.json'), '{}')
    assert.equal(await read('data/state/software-update-preferences.json'), '{"schemaVersion":1,"enabled":false}\n')
    await assert.rejects(lstat(join(target, pendingUpdate)), { code: 'ENOENT' })
    await assert.rejects(lstat(join(target, 'data/state/updates')), { code: 'ENOENT' })
    assert.equal(await read('data/configuration/state.json'), '{"initialized":true}')
    assert.equal(await read('workspaces/sample-workspace-internal/README.md'), '# internal workspace\n')
    for (const absent of ['data/eduwork-electron/dsh/logs', 'data/eduwork-electron/dsh/profiles/desktop-017/cordis.yml', 'data/eduwork-electron/dsh/profiles/desktop-017/pnpm-lock.yaml', 'data/eduwork-electron/browser/Cache', 'data/eduwork-electron/browser/GPUCache']) {
      await assert.rejects(lstat(join(target, absent)), { code: 'ENOENT' })
    }
    const registry = JSON.parse(await read('data/eduwork-electron/dsh/storages/workspace.json'))
    const newPath = join(target, 'workspaces', 'sample-workspace-internal')
    assert.equal(registry.tables.workspaces['ws-internal'].path, newPath)
    assert.equal(registry.tables.workspaces['ws-external'].path, externalPath)
    const sessions = await readdir(join(target, 'data/eduwork-electron/dsh/sessions'))
    assert.ok(sessions.includes(sessionProjectKey(newPath)))
    assert.ok(sessions.includes(sessionProjectKey(externalPath)))
    assert.ok(!sessions.includes(sessionProjectKey(internalPath)))
    const cache = JSON.parse(await read('data/eduwork-electron/dsh/storages/session_projcache/sessions/session-internal.json'))
    assert.equal(cache.record.identity.cwd, newPath)
    assert.equal(cache.record.rows.workingDirectory.val, newPath)
    const externalCache = JSON.parse(await read('data/eduwork-electron/dsh/storages/session_projcache/sessions/session-external.json'))
    assert.equal(externalCache.record.identity.cwd, externalPath)
    assert.deepEqual(receipt.workspacesMoved, [{ id: 'ws-internal', from: internalPath, to: newPath }])
    assert.deepEqual(await treeSnapshot(source), before)
    assert.equal(await readFile(join(source, 'sample-workspace-internal/README.md'), 'utf8'), '# internal workspace\n')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('a second import with an unchanged source reuses the receipt', async () => {
  const { base, source, target } = await fixture()
  try {
    const first = await run({ sourceRoot: source, targetRoot: target })
    const second = await run({ sourceRoot: source, targetRoot: target })
    assert.deepEqual(second, first)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('workspace directories survive import even when they contain no files', async () => {
  const { base, source, target, internalPath, registry, home } = await fixture()
  try {
    const empty = join(source, 'empty-workspace')
    await mkdir(empty)
    await mkdir(join(internalPath, 'empty-child'))
    registry.tables.workspaces['ws-empty'] = { path: empty, sessionIds: [] }
    const registryPath = 'storages/workspace.json'
    await writeFile(join(home, registryPath), JSON.stringify(registry))
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    const imported = JSON.parse(await readFile(join(target, 'data/eduwork-electron/dsh', registryPath), 'utf8'))
    const emptyTarget = join(target, 'workspaces', 'empty-workspace')
    const nonEmptyTarget = join(target, 'workspaces', 'sample-workspace-internal')
    assert.deepEqual(await readdir(emptyTarget), [])
    assert.deepEqual(await readdir(join(nonEmptyTarget, 'empty-child')), [])
    assert.deepEqual(receipt.workspacesMoved, [
      { id: 'ws-internal', from: internalPath, to: nonEmptyTarget },
      { id: 'ws-empty', from: empty, to: emptyTarget },
    ])
    assert.deepEqual(receipt.workspacesMissing, [])
    for (const move of receipt.workspacesMoved) assert.equal(imported.tables.workspaces[move.id].path, move.to)
    await rm(emptyTarget, { recursive: true })
    await assert.rejects(run({ sourceRoot: source, targetRoot: target }), /工作区目录/)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('changes to empty workspace directories invalidate the staged copy', async () => {
  const { base, source, target, internalPath } = await fixture()
  try {
    const emptyChild = join(internalPath, 'empty-child')
    await mkdir(emptyChild)
    await assert.rejects(run({ sourceRoot: source, targetRoot: target, onProgress: async ({ copied }) => {
      if (copied === 1) await rm(emptyChild, { recursive: true })
    } }), /仍在被写入/)
    await assert.rejects(lstat(target), { code: 'ENOENT' })
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('an existing target with other data is refused, and a changed source invalidates the receipt', async () => {
  const { base, source, target } = await fixture()
  try {
    await mkdir(target, { recursive: true })
    await writeFile(join(target, 'existing.txt'), 'user data')
    await assert.rejects(run({ sourceRoot: source, targetRoot: target }), /已有数据/)
    assert.equal(await readFile(join(target, 'existing.txt'), 'utf8'), 'user data')
    await rm(target, { recursive: true, force: true })
    await run({ sourceRoot: source, targetRoot: target })
    await writeFile(join(source, 'data/eduwork-electron/dsh/memory.sqlite3'), 'changed-after-import')
    await assert.rejects(run({ sourceRoot: source, targetRoot: target }), /发生变化/)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('identity mismatch, non-Electron shells and installed-layout sources are refused', async () => {
  const { base, source, target } = await fixture()
  try {
    await assert.rejects(run({ sourceRoot: source, targetRoot: target, distribution: 'other-edition' }), /发行标识不符/)
    const releasePath = join(source, 'release.json')
    const release = JSON.parse(await readFile(releasePath, 'utf8'))
    await writeFile(releasePath, JSON.stringify({ ...release, shell: 'wails' }))
    await assert.rejects(run({ sourceRoot: source, targetRoot: target }), /Wails/)
    await writeFile(releasePath, JSON.stringify(release))
    const desktopPath = join(source, 'resources/app/eduwork.desktop.json')
    const desktop = JSON.parse(await readFile(desktopPath, 'utf8'))
    await writeFile(desktopPath, JSON.stringify({ ...desktop, dataLayout: 'installed' }))
    await assert.rejects(run({ sourceRoot: source, targetRoot: target }), /安装形态/)
    await writeFile(desktopPath, JSON.stringify(desktop))
    await assert.rejects(run({ sourceRoot: join(base, 'does-not-exist'), targetRoot: target }), /release\.json/)
    await assert.rejects(run({ sourceRoot: 'relative/path', targetRoot: target }), /绝对路径/)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('source and target must be separate, and link paths are refused', async t => {
  const { base, source, target } = await fixture()
  try {
    await assert.rejects(run({ sourceRoot: source, targetRoot: source }), /separate/)
    await assert.rejects(run({ sourceRoot: source, targetRoot: join(source, 'data/nested-target') }), /separate/)
    await assert.rejects(run({ sourceRoot: source, targetRoot: join(base, 'wrapper', '..') }), /越界|链接|separate/)
    let linked = true
    const linkPath = join(base, 'source-link')
    try { await symlink(source, linkPath, 'junction') } catch { linked = false }
    if (linked) {
      await assert.rejects(run({ sourceRoot: linkPath, targetRoot: target }), /链接/)
      const ancestorAlias = join(base, 'ancestor-alias')
      await symlink(base, ancestorAlias, 'junction')
      await assert.rejects(run({ sourceRoot: join(ancestorAlias, 'old-app'), targetRoot: target }), /链接/)
      await rm(ancestorAlias, { force: true })
      const dataLink = join(source, 'data/eduwork-electron/dsh/skills')
      await symlink(join(base, 'elsewhere'), dataLink, 'junction')
      await mkdir(join(base, 'elsewhere'), { recursive: true })
      await assert.rejects(run({ sourceRoot: source, targetRoot: target }), /链接/)
      await rm(dataLink, { force: true })
    } else t.skip('symlink creation unavailable')
  } finally { await rm(base, { recursive: true, force: true }) }
})

for (const relativeDir of ['data/eduwork-electron', 'data/eduwork-electron/dsh/profiles/desktop-017', 'config', 'resources/app']) {
  test(`an intermediate junction at ${relativeDir} prevents activation`, async () => {
    const { base, source, target } = await fixture()
    try {
      const path = join(source, relativeDir), outside = join(base, 'outside')
      await rename(path, outside)
      await symlink(outside, path, 'junction')
      await assert.rejects(run({ sourceRoot: source, targetRoot: target }), /链接|越界/)
      await assert.rejects(lstat(target), { code: 'ENOENT' })
    } finally { await rm(base, { recursive: true, force: true }) }
  })
}

test('a source still being written aborts before activation and keeps the source intact', async () => {
  const { base, source, target } = await fixture()
  try {
    const memoryPath = join(source, 'data/eduwork-electron/dsh/memory.sqlite3')
    await assert.rejects(run({ sourceRoot: source, targetRoot: target, onProgress: async update => {
      if (update.copied === 1) await writeFile(memoryPath, 'written-during-import')
    } }), /仍在被写入|校验失败/)
    await assert.rejects(lstat(target), { code: 'ENOENT' })
    const leftovers = (await readdir(base)).filter(name => name.startsWith('.eduwork-import-'))
    assert.deepEqual(leftovers, [])
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('insufficient disk space refuses before any copy', async () => {
  const { base, source, target } = await fixture()
  try {
    await assert.rejects(run({ sourceRoot: source, targetRoot: target, freeSpace: async () => ({ bavail: 1, bsize: 512 }) }), /空间不足/)
    await assert.rejects(lstat(target), { code: 'ENOENT' })
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('a copy failure cleans the stage and a retry succeeds', async () => {
  const { base, source, target } = await fixture()
  try {
    const memoryPath = join(source, 'data/eduwork-electron/dsh/memory.sqlite3')
    const original = await readFile(memoryPath)
    let failed = false
    await assert.rejects(run({ sourceRoot: source, targetRoot: target, onProgress: async update => {
      if (!failed && update.copied === 1) { failed = true; await rm(memoryPath, { force: true }) }
    } }), /ENOENT|校验失败|仍在被写入/)
    await assert.rejects(lstat(target), { code: 'ENOENT' })
    assert.deepEqual((await readdir(base)).filter(name => name.startsWith('.eduwork-import-')), [])
    await writeFile(memoryPath, original)
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    assert.equal(receipt.state, 'imported')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('running source processes block the import', async () => {
  const { base, source, target } = await fixture()
  try {
    await assert.rejects(run({ sourceRoot: source, targetRoot: target, listProcesses: async () => [{ pid: 4242, name: 'EduWork-Electron.exe' }] }), /仍在运行/)
    await assert.rejects(lstat(target), { code: 'ENOENT' })
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('retry reclaims only confirmed interrupted stages for the current target', async () => {
  const { base, source, target } = await fixture()
  try {
    const child = spawn(process.execPath, ['-e', ''])
    await once(child, 'close')
    const stage = async (root, edition, ownerPid, suffix, marker = {}) => {
      const key = sha256(JSON.stringify([edition, root])).slice(0, 16)
      const name = `.eduwork-import-${key}-00000000-0000-4000-8000-00000000000${suffix}`
      const path = join(base, name)
      await mkdir(path)
      await writeFile(join(path, '.eduwork-import-progress.json'), JSON.stringify({ schemaVersion: 1, state: 'copying',
        target: root, distribution: edition, ownerPid, stage: name, ...marker }))
      await writeFile(join(path, 'partial.txt'), 'partial')
      return path
    }
    const orphan = await stage(target, distribution, child.pid, 1)
    const otherEdition = await stage(join(base, 'other-edition'), 'other-edition', child.pid, 2)
    const otherActive = await stage(join(base, 'other-target'), distribution, process.pid, 3)
    const active = await stage(target, distribution, process.pid, 4)
    const wrongOwner = await stage(target, distribution, child.pid, 5, { target: join(base, 'other-target') })
    const legacy = join(base, '.eduwork-import-legacy')
    await mkdir(legacy)
    await writeFile(join(legacy, '.eduwork-import-progress.json'), '{"state":"copying"}')
    await writeFile(join(legacy, 'partial.txt'), 'partial')
    const preserved = [otherEdition, otherActive, active, wrongOwner, legacy]
    const before = await Promise.all(preserved.map(treeSnapshot))
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    assert.equal(receipt.state, 'imported')
    await assert.rejects(lstat(orphan), { code: 'ENOENT' })
    assert.deepEqual(await Promise.all(preserved.map(treeSnapshot)), before)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('targets that differ only by case have distinct stage prefixes and cannot reclaim each other', async () => {
  const { base, source, target } = await fixture()
  try {
    const alternate = join(base, 'USER-ROOT')
    const hold = Error('stop after observing the stage')
    const child = spawn(process.execPath, ['-e', ''])
    await once(child, 'close')
    const observe = async targetRoot => {
      let marker
      await assert.rejects(run({ sourceRoot: source, targetRoot, onProgress: async () => {
        for (const name of (await readdir(base)).filter(name => name.startsWith('.eduwork-import-'))) {
          const candidate = JSON.parse(await readFile(join(base, name, '.eduwork-import-progress.json'), 'utf8'))
          if (candidate.ownerPid === process.pid) marker = candidate
        }
        throw hold
      } }), hold)
      return marker
    }
    const first = await observe(target)
    const firstStage = join(base, first.stage)
    await mkdir(firstStage)
    await writeFile(join(firstStage, '.eduwork-import-progress.json'), JSON.stringify({ ...first, ownerPid: child.pid }))
    const second = await observe(alternate)
    assert.notEqual(first.stage.slice(0, -36), second.stage.slice(0, -36))
    assert.ok((await lstat(firstStage)).isDirectory())

    const mismatched = join(base, first.stage)
    await writeFile(join(mismatched, '.eduwork-import-progress.json'), JSON.stringify({ ...first, target: alternate, ownerPid: child.pid }))
    assert.equal((await run({ sourceRoot: source, targetRoot: target })).state, 'imported')
    assert.ok((await lstat(mismatched)).isDirectory())
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('an existing workspace in a case-distinct sibling is external', async t => {
  const { base, source, target, home, registry, externalPath } = await fixture()
  try {
    const sibling = join(base, 'OLD-APP', 'empty-workspace')
    const { realpath } = fs
    mockFs(t, 'realpath', path => path === sibling ? realpath(externalPath).then(() => sibling) : realpath(path))
    registry.tables.workspaces['ws-external'].path = sibling
    await writeFile(join(home, 'storages/workspace.json'), JSON.stringify(registry))
    const plan = await buildCopyPlan(await inspectPortableSource({ sourceRoot: source, distribution }), target)
    assert.deepEqual(plan.moves.map(move => move.id), ['ws-internal'])
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('the copy plan excludes generated runtime state and keeps external workspaces in place', async () => {
  const { base, source, target, externalPath } = await fixture()
  try {
    const inspected = await inspectPortableSource({ sourceRoot: source, distribution })
    const plan = await buildCopyPlan(inspected, target)
    const targets = plan.files.map(file => file.target.replaceAll('\\', '/'))
    assert.ok(targets.includes('data/eduwork-electron/dsh/memory.sqlite3'))
    assert.ok(targets.includes('data/eduwork-electron/browser/Local Storage/leveldb/000001.log'))
    assert.ok(targets.includes('data/eduwork-electron/dsh/profiles/desktop-017/package.json'))
    assert.ok(!targets.some(path => path.includes('logs/') || path.includes('Cache/') || path.endsWith('cordis.yml') || path.includes('node_modules')))
    assert.ok(!targets.some(path => path.startsWith('workspaces/') && path.includes('external')))
    assert.ok(targets.some(path => path.startsWith('workspaces/sample-workspace-internal/')))
    assert.equal(plan.moves.length, 1)
    assert.equal(plan.moves[0].oldPath, join(source, 'sample-workspace-internal'))
    const externalSessions = plan.files.filter(file => file.sourcePath.startsWith(join(source, `data/eduwork-electron/dsh/sessions/${sessionProjectKey(externalPath)}`)))
    assert.equal(externalSessions.length, 1)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('the Windows process lister parses real system processes without matching unrelated ones', { skip: process.platform !== 'win32' }, async () => {
  const { base, source } = await fixture()
  try {
    const lister = windowsSourceProcessLister(source)
    assert.deepEqual(await lister(), [])
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('the Windows process lister detects command-line references, including Chinese paths, but not sibling directories', { skip: process.platform !== 'win32' }, async () => {
  const { base, source } = await fixture()
  const { spawn } = await import('node:child_process')
  const chineseRoot = join(base, '中文旧客户端')
  await mkdir(chineseRoot, { recursive: true })
  const children = []
  try {
    const referencing = spawn(process.execPath, ['-e', `setTimeout(()=>{},30000) /* ${source} */`], { stdio: 'ignore' })
    const sibling = spawn(process.execPath, ['-e', `setTimeout(()=>{},30000) /* ${source}-backup */`], { stdio: 'ignore' })
    const punctuation = spawn(process.execPath, ['-e', `setTimeout(()=>{},30000) /* ${source}; */`], { stdio: 'ignore' })
    const chinese = spawn(process.execPath, ['-e', `setTimeout(()=>{},30000) /* ${chineseRoot} */`], { stdio: 'ignore' })
    children.push(referencing, sibling, punctuation, chinese)
    const found = await windowsSourceProcessLister(source)()
    assert.ok(found.some(row => row.pid === referencing.pid), 'command-line reference under the source root must be detected')
    assert.ok(found.some(row => row.pid === punctuation.pid), 'punctuation right after the root must still match')
    assert.ok(!found.some(row => row.pid === sibling.pid), 'a sibling directory sharing the prefix must not match')
    const chineseFound = await windowsSourceProcessLister(chineseRoot)()
    assert.ok(chineseFound.some(row => row.pid === chinese.pid), 'Chinese paths must survive the PowerShell pipe encoding')
  } finally {
    for (const child of children) child.kill()
    await rm(base, { recursive: true, force: true })
  }
})

test('projcache entries are remapped by cached cwd even when the registry omits the session', async () => {
  const { base, source, target } = await fixture()
  try {
    const internalPath = join(source, 'sample-workspace-internal')
    const stray = JSON.stringify({ version: 7, record: { identity: { formatVersion: 4, cwd: internalPath }, rows: { workingDirectory: { ver: 1, seq: 1, val: internalPath } } } })
    await writeFile(join(source, 'data/eduwork-electron/dsh/storages/session_projcache/sessions/session-unlisted.json'), stray)
    await writeFile(join(source, 'data/eduwork-electron/dsh/storages/session_projcache/sessions/session-corrupt.json'), '{not json')
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    const cache = JSON.parse(await readFile(join(target, 'data/eduwork-electron/dsh/storages/session_projcache/sessions/session-unlisted.json'), 'utf8'))
    const newPath = receipt.workspacesMoved[0].to
    assert.equal(cache.record.identity.cwd, newPath)
    assert.equal(cache.record.rows.workingDirectory.val, newPath)
    assert.equal(await readFile(join(target, 'data/eduwork-electron/dsh/storages/session_projcache/sessions/session-corrupt.json'), 'utf8'), '{not json')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('a disconnected network workspace stays external instead of failing the import', async () => {
  const { base, source, target } = await fixture()
  try {
    const registryPath = join(source, 'data/eduwork-electron/dsh/storages/workspace.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    const disconnected = '\\\\eduwork-invalid-host\\share\\workspace'
    registry.tables.workspaces['ws-disconnected'] = { path: disconnected, title: 'disconnected', sessionIds: [], createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z' }
    registry.global.workspaceIds.push('ws-disconnected')
    await writeFile(registryPath, JSON.stringify(registry, null, 2))
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    assert.equal(receipt.state, 'imported')
    const after = JSON.parse(await readFile(join(target, 'data/eduwork-electron/dsh/storages/workspace.json'), 'utf8'))
    assert.equal(after.tables.workspaces['ws-disconnected'].path, disconnected)
    assert.ok(!receipt.workspacesMoved.some(move => move.id === 'ws-disconnected'))
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('a workspace registered through a junction spelling inside the source is still internal', async t => {
  const { base, source, target, internalPath } = await fixture()
  try {
    const alias = join(source, 'ws-alias')
    try { await symlink(internalPath, alias, 'junction') } catch { return t.skip('symlink creation unavailable') }
    const registryPath = join(source, 'data/eduwork-electron/dsh/storages/workspace.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    registry.tables.workspaces['ws-internal'].path = alias
    await writeFile(registryPath, JSON.stringify(registry, null, 2))
    const sessionsRoot = join(source, 'data/eduwork-electron/dsh/sessions')
    await rename(join(sessionsRoot, sessionProjectKey(internalPath)), join(sessionsRoot, sessionProjectKey(alias)))
    const cachePath = join(source, 'data/eduwork-electron/dsh/storages/session_projcache/sessions/session-internal.json')
    const cache = JSON.parse(await readFile(cachePath, 'utf8'))
    cache.record.identity.cwd = alias
    cache.record.rows.workingDirectory.val = alias
    await writeFile(cachePath, JSON.stringify(cache, null, 2))
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    assert.equal(receipt.workspacesMoved.length, 1)
    assert.equal(receipt.workspacesMoved[0].from, alias)
    const newPath = receipt.workspacesMoved[0].to
    assert.equal(newPath, join(target, 'workspaces', 'sample-workspace-internal'))
    const sessions = await readdir(join(target, 'data/eduwork-electron/dsh/sessions'))
    assert.ok(sessions.includes(sessionProjectKey(newPath)))
    assert.ok(!sessions.includes(sessionProjectKey(alias)))
    const movedCache = JSON.parse(await readFile(join(target, 'data/eduwork-electron/dsh/storages/session_projcache/sessions/session-internal.json'), 'utf8'))
    assert.equal(movedCache.record.identity.cwd, newPath)
    assert.equal(await readFile(join(target, 'workspaces/sample-workspace-internal/README.md'), 'utf8'), '# internal workspace\n')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('the imported session header cwd is remapped so the runtime identity check passes', async () => {
  const { base, source, target, internalPath } = await fixture()
  try {
    const checksum = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
    const frame = text => zstdCompressSync(Buffer.from(text, 'utf8'), checksum)
    const headerLine = cwd => JSON.stringify({ type: 'session', version: 4, id: 'session-internal', createdAt: 1794645447166, cwd, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }) + '\n'
    const eventFrame = frame('{"type":"event","seq":1,"kind":"message"}\n')
    const sessionRel = `data/eduwork-electron/dsh/sessions/${sessionProjectKey(internalPath)}/session-internal/session.v4.jsonl.zstd`
    await writeFile(join(source, sessionRel), Buffer.concat([frame(headerLine(internalPath)), eventFrame]))
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    const newPath = receipt.workspacesMoved[0].to
    const imported = await readFile(join(target, `data/eduwork-electron/dsh/sessions/${sessionProjectKey(newPath)}/session-internal/session.v4.jsonl.zstd`))
    const headerFrame = frame(headerLine(newPath))
    // Header frame now names the new workspace; the event frame is untouched.
    assert.equal(zstdDecompressSync(imported.subarray(0, headerFrame.length)).toString('utf8'), headerLine(newPath))
    assert.deepEqual(imported.subarray(headerFrame.length), eventFrame)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('colliding project keys split sessions by header cwd instead of giving all to the first workspace', async () => {
  const { base, source, target, internalPath } = await fixture()
  try {
    // The upstream encoding collapses separator runs, so these two distinct
    // internal workspaces share one session directory key.
    const pathA = join(source, 'Projects/Team/Code'), pathB = join(source, 'Projects/Team-Code')
    assert.equal(sessionProjectKey(pathA), sessionProjectKey(pathB))
    for (const [path, title] of [[pathA, 'A'], [pathB, 'B']]) {
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'README.md'), `# ${title}\n`)
    }
    const registryPath = join(source, 'data/eduwork-electron/dsh/storages/workspace.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    delete registry.tables.workspaces['ws-internal']
    const stamp = '2026-11-14T00:00:00.000Z'
    registry.tables.workspaces['ws-a'] = { path: pathA, title: 'A', sessionIds: ['session-a'], createdAt: stamp, updatedAt: stamp }
    registry.tables.workspaces['ws-b'] = { path: pathB, title: 'B', sessionIds: ['session-b'], createdAt: stamp, updatedAt: stamp }
    registry.global.workspaceIds = ['ws-a', 'ws-b', 'ws-external']
    await writeFile(registryPath, JSON.stringify(registry, null, 2))
    await rm(join(source, `data/eduwork-electron/dsh/sessions/${sessionProjectKey(internalPath)}`), { recursive: true, force: true })
    const checksum = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
    const frame = text => zstdCompressSync(Buffer.from(text, 'utf8'), checksum)
    const headerLine = (id, cwd) => JSON.stringify({ type: 'session', version: 4, id, createdAt: 1794645447166, cwd, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }) + '\n'
    const eventA = frame('{"type":"event","seq":1,"kind":"message","payload":"a"}\n')
    const eventB = frame('{"type":"event","seq":1,"kind":"message","payload":"b"}\n')
    const shared = join(source, `data/eduwork-electron/dsh/sessions/${sessionProjectKey(pathA)}`)
    await mkdir(join(shared, 'session-a'), { recursive: true })
    await writeFile(join(shared, 'session-a/session.v4.jsonl.zstd'), Buffer.concat([frame(headerLine('session-a', pathA)), eventA]))
    await mkdir(join(shared, 'session-b'), { recursive: true })
    await writeFile(join(shared, 'session-b/session.v4.jsonl.zstd'), Buffer.concat([frame(headerLine('session-b', pathB)), eventB]))
    // A torn session cannot be classified; it must survive in place, not vanish.
    await mkdir(join(shared, 'session-corrupt'), { recursive: true })
    await writeFile(join(shared, 'session-corrupt/session.v4.jsonl.zstd'), 'torn bytes')
    const projcache = (id, cwd) => JSON.stringify({ version: 7, record: { identity: { formatVersion: 4, cwd }, rows: { workingDirectory: { ver: 1, seq: 1, val: cwd } } } }, null, 2)
    const cacheDir = join(source, 'data/eduwork-electron/dsh/storages/session_projcache/sessions')
    await writeFile(join(cacheDir, 'session-a.json'), projcache('session-a', pathA))
    await writeFile(join(cacheDir, 'session-b.json'), projcache('session-b', pathB))
    const before = await treeSnapshot(source)
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    assert.deepEqual(receipt.workspacesMoved.map(move => move.id).sort(), ['ws-a', 'ws-b'])
    const newA = join(target, 'workspaces', 'Code'), newB = join(target, 'workspaces', 'Team-Code')
    const sessionsRoot = join(target, 'data/eduwork-electron/dsh/sessions')
    const keyA = sessionProjectKey(newA), keyB = sessionProjectKey(newB)
    assert.notEqual(keyA, keyB)
    assert.deepEqual((await readdir(join(sessionsRoot, keyA))).sort(), ['session-a'])
    assert.deepEqual((await readdir(join(sessionsRoot, keyB))).sort(), ['session-b'])
    assert.deepEqual(await readdir(join(sessionsRoot, sessionProjectKey(pathA))), ['session-corrupt'])
    const importedA = await readFile(join(sessionsRoot, keyA, 'session-a/session.v4.jsonl.zstd'))
    const headerA = frame(headerLine('session-a', newA))
    assert.equal(zstdDecompressSync(importedA.subarray(0, headerA.length)).toString('utf8'), headerLine('session-a', newA))
    assert.deepEqual(importedA.subarray(headerA.length), eventA)
    const importedB = await readFile(join(sessionsRoot, keyB, 'session-b/session.v4.jsonl.zstd'))
    const headerB = frame(headerLine('session-b', newB))
    assert.equal(zstdDecompressSync(importedB.subarray(0, headerB.length)).toString('utf8'), headerLine('session-b', newB))
    assert.deepEqual(importedB.subarray(headerB.length), eventB)
    assert.equal(await readFile(join(sessionsRoot, sessionProjectKey(pathA), 'session-corrupt/session.v4.jsonl.zstd'), 'utf8'), 'torn bytes')
    const after = JSON.parse(await readFile(join(target, 'data/eduwork-electron/dsh/storages/workspace.json'), 'utf8'))
    assert.equal(after.tables.workspaces['ws-a'].path, newA)
    assert.equal(after.tables.workspaces['ws-b'].path, newB)
    for (const [id, newPath] of [['session-a', newA], ['session-b', newB]]) {
      const cache = JSON.parse(await readFile(join(target, `data/eduwork-electron/dsh/storages/session_projcache/sessions/${id}.json`), 'utf8'))
      assert.equal(cache.record.identity.cwd, newPath)
      assert.equal(cache.record.rows.workingDirectory.val, newPath)
    }
    assert.deepEqual(await treeSnapshot(source), before)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('the migrated software-update choice keeps the backend off even when defaults enable it', async () => {
  const { base, source, target } = await fixture()
  try {
    await run({ sourceRoot: source, targetRoot: target })
    // The channel preference alone must not stand in for the user's switch.
    const prefs = join(target, 'data/state/software-update-preferences.json')
    const before = await readFile(prefs, 'utf8')
    const starts = []
    const control = await softwareUpdateControl({ dataRoot: join(target, 'data'), version: '0.4.13', defaultEnabled: true, supported: true,
      start: async options => { starts.push(options); return {
        action: async () => ({ shell: 'electron', version: '0.4.13', phase: 'ready', update: { enabled: true, state: 'up_to_date' } }),
        close: async () => {},
      } } })
    assert.equal(starts.length, 0)
    const status = await control.action('status')
    assert.equal(status.update.userEnabled, false)
    assert.equal(status.phase, 'disabled')
    await assert.rejects(control.action('download-update'), /已关闭/)
    await control.close()
    assert.equal(await readFile(prefs, 'utf8'), before)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('an internal workspace sharing a key with an external workspace leaves the external sessions in place', async () => {
  const { base, source, target, internalPath, externalPath } = await fixture()
  try {
    // <base>/old-app/sample-workspace-internal and the sibling directory
    // <base>/old-app-sample-workspace-internal encode to the same project key.
    const externalCollide = join(base, 'old-app-sample-workspace-internal')
    assert.equal(sessionProjectKey(internalPath), sessionProjectKey(externalCollide))
    await mkdir(externalCollide, { recursive: true })
    await writeFile(join(externalCollide, 'hello.md'), '# external collide\n')
    const registryPath = join(source, 'data/eduwork-electron/dsh/storages/workspace.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    registry.tables.workspaces['ws-external'].path = externalCollide
    await writeFile(registryPath, JSON.stringify(registry, null, 2))
    await rm(join(source, `data/eduwork-electron/dsh/sessions/${sessionProjectKey(externalPath)}`), { recursive: true, force: true })
    const checksum = { params: { [constants.ZSTD_c_checksumFlag]: 1 } }
    const frame = text => zstdCompressSync(Buffer.from(text, 'utf8'), checksum)
    const headerLine = (id, cwd) => JSON.stringify({ type: 'session', version: 4, id, createdAt: 1794645447166, cwd, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }) + '\n'
    const eventInternal = frame('{"type":"event","seq":1,"kind":"message","payload":"internal"}\n')
    const eventExternal = frame('{"type":"event","seq":1,"kind":"message","payload":"external"}\n')
    const shared = join(source, `data/eduwork-electron/dsh/sessions/${sessionProjectKey(internalPath)}`)
    await writeFile(join(shared, 'session-internal/session.v4.jsonl.zstd'), Buffer.concat([frame(headerLine('session-internal', internalPath)), eventInternal]))
    await mkdir(join(shared, 'session-external'), { recursive: true })
    await writeFile(join(shared, 'session-external/session.v4.jsonl.zstd'), Buffer.concat([frame(headerLine('session-external', externalCollide)), eventExternal]))
    const cacheDir = join(source, 'data/eduwork-electron/dsh/storages/session_projcache/sessions')
    await writeFile(join(cacheDir, 'session-external.json'), JSON.stringify({ version: 7, record: { identity: { formatVersion: 4, cwd: externalCollide }, rows: { workingDirectory: { ver: 1, seq: 1, val: externalCollide } } } }, null, 2))
    const before = await treeSnapshot(source)
    const receipt = await run({ sourceRoot: source, targetRoot: target })
    assert.deepEqual(receipt.workspacesMoved.map(move => move.id), ['ws-internal'])
    const newPath = join(target, 'workspaces', 'sample-workspace-internal')
    const sessionsRoot = join(target, 'data/eduwork-electron/dsh/sessions')
    assert.deepEqual(await readdir(join(sessionsRoot, sessionProjectKey(newPath))), ['session-internal'])
    const importedInternal = await readFile(join(sessionsRoot, sessionProjectKey(newPath), 'session-internal/session.v4.jsonl.zstd'))
    const headerInternal = frame(headerLine('session-internal', newPath))
    assert.equal(zstdDecompressSync(importedInternal.subarray(0, headerInternal.length)).toString('utf8'), headerLine('session-internal', newPath))
    assert.deepEqual(importedInternal.subarray(headerInternal.length), eventInternal)
    // The external workspace keeps its path, its key directory and its bytes.
    const externalKeyDir = join(sessionsRoot, sessionProjectKey(externalCollide))
    assert.deepEqual(await readdir(externalKeyDir), ['session-external'])
    assert.deepEqual(await readFile(join(externalKeyDir, 'session-external/session.v4.jsonl.zstd')), Buffer.concat([frame(headerLine('session-external', externalCollide)), eventExternal]))
    const after = JSON.parse(await readFile(join(target, 'data/eduwork-electron/dsh/storages/workspace.json'), 'utf8'))
    assert.equal(after.tables.workspaces['ws-external'].path, externalCollide)
    const cache = JSON.parse(await readFile(join(target, 'data/eduwork-electron/dsh/storages/session_projcache/sessions/session-external.json'), 'utf8'))
    assert.equal(cache.record.identity.cwd, externalCollide)
    assert.equal(cache.record.rows.workingDirectory.val, externalCollide)
    assert.deepEqual(await treeSnapshot(source), before)
  } finally { await rm(base, { recursive: true, force: true }) }
})
