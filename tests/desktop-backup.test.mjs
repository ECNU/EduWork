import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { backupDesktop, restoreDesktop } from '../scripts/backup-desktop.mjs'
import { ConfigurationFile } from '../dsh-host/configuration-file.mjs'

const script = fileURLToPath(new URL('../scripts/backup-desktop.mjs', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const write = async (path, value) => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
}
const options = { platform: 'win32', listProcesses: async () => [{ ProcessId: process.pid }] }
const home = 'data/eduwork-electron/dsh', browser = 'data/eduwork-electron/browser'
const noEntry = path => assert.rejects(readFile(path), { code: 'ENOENT' })

async function snapshot(root) {
  const files = {}
  const walk = async (directory, prefix = '') => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix + entry.name
      if (entry.isDirectory()) { files[path + '/'] = ''; await walk(join(directory, entry.name), path + '/') }
      else files[path] = hash(await readFile(join(directory, entry.name)))
    }
  }
  await walk(root)
  return files
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eduwork backup 中文 '))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source'), program = join(root, 'program'), backup = join(root, 'backup'), target = join(root, 'restored')
  const workspace = join(root, 'workspace')
  const identity = { schemaVersion: 1, version: '0.4.12', distribution: 'eduwork', dshVersion: '0.2.2-rc.1', dshCommit: 'a'.repeat(40) }
  const files = {
    'EduWork-Electron.exe': 'synthetic executable, never launched',
    'resources/runtime/node.exe': 'synthetic runtime, never launched',
    'resources/product/plugin.js': 'synthetic plugin bytes',
    'resources/product/assembly.json': { ...identity, kind: 'eduwork-web', externalPackages: [{ name: '@example/plugin', version: '1.0.0' }] },
    'resources/app/eduwork.desktop.json': { schemaVersion: 1, shell: 'electron', distribution: 'eduwork', appId: 'org.eduwork.eduwork.electron',
      productVersion: identity.version, product: '../product', node: '../runtime/node.exe', configurationOwnership: 'user' },
    'release.json': { ...identity, shell: 'electron' },
    'config/eduwork.jsonc': '{"schemaVersion":1,"organizations":[]}',
  }
  for (const [path, value] of Object.entries(files)) await write(join(program, path), value)
  const seal = async directory => write(join(directory, 'RELEASE-MANIFEST.json'), {
    schemaVersion: 1, kind: 'eduwork-portable-release', shell: 'electron', platform: 'windows-x64',
    version: identity.version, distribution: 'eduwork',
    files: await Promise.all(Object.keys(files).map(async path => {
      const bytes = await readFile(join(directory, path))
      return { path, bytes: bytes.length, sha256: hash(bytes) }
    })),
  })
  await seal(program)
  await cp(program, source, { recursive: true })
  await write(join(source, 'config/eduwork.jsonc'), '// synthetic personal preference\n{"schemaVersion":1,"features":{"maxConcurrentRequests":2}}')
  await write(join(source, 'config/custom.json'), { keep: true })
  await write(join(source, home, 'sessions/project/session/log.jsonl'), '{"seq":0,"type":"synthetic"}\n')
  await write(join(source, home, 'attachments/v1/objects/blob'), Buffer.from([0, 255, 1, 2]))
  await write(join(source, home, 'attachments/v1/tmp/unfinished'), 'temporary')
  await write(join(source, home, 'profiles/desktop-017/cordis.patch.yml'), '- id: synthetic\n  disabled: true\n')
  await write(join(source, home, 'profiles/desktop-017/node_modules/user-plugin/index.js'), 'synthetic user plugin')
  await write(join(source, home, '.skill-trash/old.md'), 'temporary')
  await mkdir(join(source, home, 'skills/empty'), { recursive: true })
  await write(join(workspace, 'document.txt'), 'external workspace stays in place')
  await write(join(source, home, 'storages/workspace.json'), { unit: { name: 'workspace', version: 2 },
    tables: { workspaces: { sample: { path: workspace, sessionIds: ['session'] } } } })
  const database = new DatabaseSync(join(source, home, 'memory.sqlite3'))
  database.exec("CREATE TABLE records(id TEXT, content TEXT); INSERT INTO records VALUES('retained','synthetic memory'); CREATE TABLE tombstones(id TEXT); INSERT INTO tombstones VALUES('forgotten'); CREATE TABLE session_policies(id TEXT, enabled INTEGER); INSERT INTO session_policies VALUES('private-session',0)")
  database.close()
  await write(join(source, browser, 'credentials.encrypted'), 'synthetic encrypted bytes, no real credential')
  await write(join(source, browser, 'Local State'), { synthetic: true })
  await write(join(source, browser, 'Local Storage/kept'), 'browser preference')
  await write(join(source, browser, 'Cache/ignored'), 'cache')
  await write(join(source, 'data/state/software-update-preferences.json'), { enabled: false })
  await write(join(source, 'data/state/update-channel-040.json'), { schemaVersion: 1, decision: 'kept' })
  await write(join(source, 'data/state/updates/downloads/ignored.zip'), 'download')
  await write(join(source, 'data/configuration/eduwork.previous.jsonc'), '{}')
  await write(join(source, 'data/configuration/state.json'), { schemaVersion: 1, configuration: '../config/eduwork.jsonc', initialized: true, trial: null, defaults: { revision: 2 } })
  await write(join(source, 'data/content-updates/synthetic-scope/state.json'), { schemaVersion: 1, active: { skills: 'synthetic-revision' }, highest: 2, trial: null, pending: null })
  await write(join(source, 'data/content-updates/synthetic-scope/synthetic-revision/skills/SKILL.md'), 'synthetic signed content fixture')
  await write(join(source, 'data/publisher-bootstrap/synthetic-scope/eduwork.jsonc'), '{}')
  await write(join(source, 'data/eduwork-electron/logs/synthetic.log'), 'synthetic log')
  const create = extra => backupDesktop({ ...options, source, output: backup, ...extra })
  const restore = extra => restoreDesktop({ ...options, backup, program, target, ...extra })
  return { root, source, program, backup, target, workspace, seal, create, restore }
}

test('offline round trip preserves data, empty directories and memory policies without copying external files or caches', async t => {
  const f = await fixture(t), before = await snapshot(f.source)
  const plan = await f.create({ dryRun: true })
  assert.equal(plan.dryRun, true)
  assert.equal(plan.externalWorkspaces, 'references-only')
  await noEntry(join(f.backup, 'BACKUP-MANIFEST.json'))
  await f.create()
  const manifest = await json(join(f.backup, 'BACKUP-MANIFEST.json'))
  assert.equal(manifest.components.externalPackages[0].version, '1.0.0')
  assert(!manifest.files.some(file => file.path.includes('Cache/') || file.path.includes('/tmp/') || file.path.includes('.skill-trash') || file.path.includes('downloads/')))
  assert(manifest.directories.includes(`${home}/skills/empty`))
  await write(join(f.program, browser, 'must-not-copy'), 'other installation data')
  const programBefore = await snapshot(f.program), backupBefore = await snapshot(f.backup)
  await mkdir(f.target)
  await f.restore({ dryRun: true })
  assert.deepEqual(await readdir(f.target), [])
  await f.restore()
  for (const file of manifest.files) assert.equal(hash(await readFile(join(f.target, file.path))), file.sha256, file.path)
  assert.deepEqual(await readdir(join(f.target, home, 'skills/empty')), [])
  assert.equal((await json(join(f.target, 'data/configuration/state.json'))).initialized, true)
  assert.equal((await json(join(f.target, 'data/content-updates/synthetic-scope/state.json'))).highest, 2)
  await noEntry(join(f.target, browser, 'must-not-copy'))
  await noEntry(join(f.target, 'document.txt'))
  const database = new DatabaseSync(join(f.target, home, 'memory.sqlite3'), { readOnly: true })
  try {
    assert.equal(database.prepare('SELECT id FROM tombstones').get().id, 'forgotten')
    assert.equal(database.prepare('SELECT enabled FROM session_policies').get().enabled, 0)
  } finally { database.close() }
  const configuration = await new ConfigurationFile(join(f.target, 'config/eduwork.jsonc'), join(f.target, 'data')).open()
  assert.equal(configuration.state.initialized, true)
  assert.equal(configuration.state.defaults.revision, 2)
  assert.deepEqual(await snapshot(f.source), before)
  assert.deepEqual(await snapshot(f.program), programBefore)
  assert.deepEqual(await snapshot(f.backup), backupBefore)
  assert.equal(await readFile(join(f.workspace, 'document.txt'), 'utf8'), 'external workspace stays in place')
  await backupDesktop({ ...options, source: f.target, output: join(f.root, 'round-trip-backup') })
})

test('restore rejects changed plugins or program bytes even when application and DSH versions match', async t => {
  for (const path of ['resources/product/assembly.json', 'resources/product/plugin.js']) await t.test(path, async t => {
    const f = await fixture(t)
    await f.create()
    if (path.endsWith('.json')) {
      const value = await json(join(f.program, path)); value.externalPackages[0].version = '2.0.0'
      await write(join(f.program, path), value)
    } else await write(join(f.program, path), 'changed implementation with the same version')
    await f.seal(f.program)
    await assert.rejects(f.restore(), /exactly the same/)
    await noEntry(join(f.target, 'EduWork-Electron.exe'))
  })
})

test('changed product or DSH identity and unlisted program files are refused', async t => {
  for (const change of ['version', 'dshCommit', 'dataLayout', 'unlisted']) await t.test(change, async t => {
    const f = await fixture(t)
    await f.create()
    if (change === 'unlisted') await write(join(f.program, 'extra.dll'), 'unlisted')
    else {
      const path = change === 'dataLayout' ? 'resources/app/eduwork.desktop.json' : 'release.json'
      const value = await json(join(f.program, path)); value[change] = change === 'dataLayout' ? 'installed' : change === 'version' ? '0.4.13' : 'b'.repeat(40)
      await write(join(f.program, path), value); await f.seal(f.program)
    }
    await assert.rejects(f.restore(), /identities|manifest/)
  })
})

test('damaged, incomplete, extra and unsafe backup entries fail before creating a target', async t => {
  for (const change of ['hash', 'missing', 'extra', 'traversal', 'drive', 'device', 'case', 'program-file', 'directory']) await t.test(change, async t => {
    const f = await fixture(t)
    await f.create()
    const path = join(f.backup, 'BACKUP-MANIFEST.json'), manifest = await json(path)
    if (change === 'hash') await write(join(f.backup, 'payload/config/custom.json'), 'damaged')
    if (change === 'missing') await rm(join(f.backup, 'payload/config/custom.json'))
    if (change === 'extra') await write(join(f.backup, 'payload/config/extra.json'), '{}')
    if (['traversal', 'drive', 'device', 'program-file'].includes(change)) manifest.files[0].path = {
      traversal: '../outside', drive: 'C:/outside', device: 'config/NUL.txt', 'program-file': 'resources/app/injected.js',
    }[change]
    if (change === 'case') manifest.files.push({ ...manifest.files[0], path: manifest.files[0].path.toUpperCase() })
    if (change === 'directory') manifest.directories.push('../outside')
    await write(path, manifest)
    await assert.rejects(f.restore(), /payload|Unsafe|duplicate/)
    await noEntry(join(f.target, 'EduWork-Electron.exe'))
    assert(!(await readdir(f.root)).some(name => name.startsWith('.eduwork-backup-')))
  })
})

test('existing targets and overlapping paths remain untouched', async t => {
  const f = await fixture(t)
  await f.create()
  const saved = await snapshot(f.backup)
  await assert.rejects(f.create(), /empty real directory/)
  assert.deepEqual(await snapshot(f.backup), saved)
  await write(join(f.target, 'keep.txt'), 'existing personal data')
  await assert.rejects(f.restore(), /empty real directory/)
  assert.equal(await readFile(join(f.target, 'keep.txt'), 'utf8'), 'existing personal data')
  await assert.rejects(f.create({ output: join(f.source, 'new-backup') }), /overlap/)
  await assert.rejects(f.restore({ target: join(f.program, 'new-target') }), /overlap/)
  await symlink(f.source, join(f.root, 'source-alias'), 'junction')
  await assert.rejects(f.create({ output: join(f.root, 'source-alias/new-backup') }), /overlap|link/)
})

test('links in data and backup payload, and internal workspace paths, are refused', async t => {
  for (const change of ['data-link', 'backup-link', 'internal-workspace', 'workspace-alias', 'credential-context']) await t.test(change, async t => {
    const f = await fixture(t)
    if (change === 'data-link') await symlink(f.workspace, join(f.source, home, 'linked'), 'junction')
    if (change === 'credential-context') await rm(join(f.source, browser, 'Local State'))
    if (change.includes('workspace')) {
      const registry = join(f.source, home, 'storages/workspace.json'), value = await json(registry)
      if (change === 'workspace-alias') await symlink(f.source, join(f.root, 'alias'), 'junction')
      value.tables.workspaces.sample.path = change === 'workspace-alias' ? join(f.root, 'alias/workspace') : join(f.source, 'workspace')
      await write(registry, value)
    }
    if (change === 'backup-link') {
      await f.create()
      await symlink(f.workspace, join(f.backup, 'payload', home, 'linked'), 'junction')
      await assert.rejects(f.restore(), /links/)
    } else await assert.rejects(f.create(), /links|link|Workspace|Local State/)
  })
})

test('process inspection, pending updates and available space are required for preflight too', async t => {
  const f = await fixture(t)
  for (const process of [{ ProcessId: 42, ExecutablePath: join(f.source, 'EduWork-Electron.exe') },
    { ProcessId: 42, Name: 'node.exe', CommandLine: `node "${join(f.source, 'worker.js')}"` },
    { ProcessId: 42, Name: 'EduWork-Electron.exe' }, { ProcessId: 42, Name: 'node.exe' }]) {
    await assert.rejects(f.create({ dryRun: true, listProcesses: async () => [process] }), /Close EduWork/)
  }
  await assert.rejects(f.create({ listProcesses: async () => [] }), /Could not verify/)
  await assert.rejects(f.create({ listProcesses: async () => { throw new Error('process inspection denied') } }), /denied/)
  await assert.rejects(f.create({ statfsImpl: async () => ({ bsize: 4096n, bavail: 0n }) }), /Insufficient/)
  await assert.rejects(f.create({ statfsImpl: async () => ({ bsize: -4096n, bavail: -1024n }) }), /verify available disk space/)
  await write(join(f.source, 'data/state/updates/pending-update.json'), '{}')
  await assert.rejects(f.create({ dryRun: true }), /pending update/)
  await rm(join(f.source, 'data/state/updates/pending-update.json'))
  await write(join(f.source, 'data/state/updates/transactions/unfinished/journal.json'), '{}')
  await assert.rejects(f.create(), /pending update/)
})

test('copy failures leave original directories and existing empty targets intact', async t => {
  const f = await fixture(t), before = await snapshot(f.source)
  const fail = async () => { throw new Error('synthetic copy failure') }
  await mkdir(f.backup)
  await assert.rejects(f.create({ copyFileImpl: fail }), /synthetic copy failure/)
  assert.deepEqual(await readdir(f.backup), [])
  await f.create()
  const saved = await snapshot(f.backup)
  await mkdir(f.target)
  let copied = 0
  await assert.rejects(f.restore({ copyFileImpl: async (...args) => {
    if (++copied === 3) throw new Error('synthetic copy failure')
    await copyFile(...args)
  } }), /synthetic copy failure/)
  assert.deepEqual(await readdir(f.target), [])
  assert.deepEqual(await snapshot(f.source), before)
  assert.deepEqual(await snapshot(f.backup), saved)
  assert(!(await readdir(f.root)).some(name => name.startsWith('.eduwork-backup-')))
})

test('incomplete configuration/content updates and an external effective configuration are refused', async t => {
  const f = await fixture(t)
  for (const [path, changed] of [
    ['data/configuration/state.json', { trial: { key: 'unfinished' } }],
    ['data/content-updates/synthetic-scope/state.json', { pending: 'unfinished' }],
    ['data/content-updates/synthetic-scope/state.json', { retryable: 'unfinished' }],
    ['data/configuration/state.json', { configuration: '../../external.jsonc' }],
  ]) {
    const file = join(f.source, path), original = await json(file)
    await write(file, { ...original, ...changed })
    await assert.rejects(f.create({ dryRun: true }), /configuration\/content update|default portable configuration/)
    await write(file, original)
  }
  await noEntry(join(f.backup, 'BACKUP-MANIFEST.json'))
})

test('source changes and late target conflicts never activate a partial result', async t => {
  const f = await fixture(t)
  let changed = false
  await assert.rejects(f.create({ copyFileImpl: async (...args) => {
    await copyFile(...args)
    if (!changed) { changed = true; await write(join(f.source, 'config/new-during-copy.json'), '{}') }
  } }), /Source changed/)
  await noEntry(join(f.backup, 'BACKUP-MANIFEST.json'))
  await f.create()
  changed = false
  await assert.rejects(f.restore({ copyFileImpl: async (...args) => {
    await copyFile(...args)
    if (!changed) { changed = true; await write(join(f.target, 'keep.txt'), 'created during restore') }
  } }), /empty real directory/)
  assert.equal(await readFile(join(f.target, 'keep.txt'), 'utf8'), 'created during restore')
  await noEntry(join(f.target, 'EduWork-Electron.exe'))
})

test('a changing backup or a process restarted during copying prevents activation', async t => {
  for (const change of ['backup', 'process']) await t.test(change, async t => {
    const f = await fixture(t)
    await f.create()
    let changed = false, inspections = 0
    await assert.rejects(f.restore({
      listProcesses: async () => change === 'process' && ++inspections > 1
        ? [{ ProcessId: 42, ExecutablePath: join(f.program, 'EduWork-Electron.exe') }] : [{ ProcessId: process.pid }],
      copyFileImpl: async (...args) => {
        await copyFile(...args)
        if (change === 'backup' && !changed) {
          changed = true
          await write(join(f.backup, 'payload/config/added-during-restore.json'), '{}')
        }
      },
    }), /changed during restore|Close EduWork/)
    await noEntry(join(f.target, 'EduWork-Electron.exe'))
    assert(!(await readdir(f.root)).some(name => name.startsWith('.eduwork-backup-')))
  })
})

test('CLI validates its platform and runs the file-only workflow on Windows', async t => {
  const f = await fixture(t)
  const run = args => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: 'pipe' })
  assert.throws(() => run(['backup', '--source', f.source]), /Use backup/)
  if (process.platform !== 'win32') {
    assert.throws(() => run(['backup', '--source', f.source, '--output', f.backup]), /Windows portable builds only/)
    return
  }
  assert.equal(JSON.parse(run(['backup', '--source', f.source, '--output', f.backup])).action, 'backup')
  assert.equal(JSON.parse(run(['restore', '--backup', f.backup, '--program', f.program, '--target', f.target, '--dry-run'])).dryRun, true)
  run(['restore', '--backup', f.backup, '--program', f.program, '--target', f.target])
  assert.equal(await readFile(join(f.target, 'EduWork-Electron.exe'), 'utf8'), 'synthetic executable, never launched')
})
