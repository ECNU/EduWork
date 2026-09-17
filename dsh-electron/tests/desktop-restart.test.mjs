import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { desktopRelaunchOptions } from '../src/desktop-restart.mjs'
import { readMigrationLaunch, writeMigrationHealth, importLegacyData } from '../src/legacy-migration.mjs'

test('startup retries retain an unfinished updater handshake and unrelated arguments', () => {
  const args = ['app path', '--update-health-file', 'transaction path/health.ok', '--eduwork-migration', 'transaction path/migration.json', '--lang=zh-CN']
  assert.deepEqual(desktopRelaunchOptions(args).args, args)
  assert.notEqual(desktopRelaunchOptions(args).args, args)
  assert.deepEqual(desktopRelaunchOptions(args, true).args, ['app path', '--lang=zh-CN'])
})

for (const migration of [false, true]) {
  test(`content restart after ${migration ? 'Go migration' : 'Electron update'} does not reuse a removed transaction`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'eduwork-restart-中文 空格-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const settings = { productVersion: '0.3.6-dev.20990101.1', distribution: 'eduwork' }
    const transaction = join(root, 'data/state/updates/transactions', settings.productVersion)
    const health = join(transaction, 'health.ok'), file = join(transaction, 'migration.json')
    const sourceHome = join(root, 'data/dsh'), targetHome = join(root, 'data/eduwork-electron/dsh')
    await mkdir(transaction, { recursive: true })
    await mkdir(join(sourceHome, 'sessions'), { recursive: true })
    await writeFile(join(sourceHome, 'sessions/history.json'), 'keep history')
    if (migration) await writeFile(file, JSON.stringify({ schemaVersion: 1, kind: 'legacy-wails-v1', version: settings.productVersion, distribution: settings.distribution, sourceHome }))
    const args = ['app path', '--lang=zh-CN', ...(migration ? ['--eduwork-migration', file] : []), '--update-health-file', health]
    const launch = await readMigrationLaunch({ root, settings, argv: args })
    await importLegacyData({ root, targetHome, launch })
    await writeMigrationHealth(launch, 'ready')
    assert.equal(await readFile(health, 'utf8'), 'ok\n')
    // The real installer removes this transaction after consuming health.ok.
    await rm(transaction, { recursive: true })
    if (!migration) {
      const stale = await readMigrationLaunch({ root, settings, argv: args })
      await assert.rejects(writeMigrationHealth(stale, 'starting'), { code: 'ENOENT' })
    } else {
      await assert.rejects(readMigrationLaunch({ root, settings, argv: args }), { code: 'ENOENT' })
    }
    const restart = desktopRelaunchOptions(args, true)
    assert.deepEqual(restart.args, ['app path', '--lang=zh-CN'])
    const next = await readMigrationLaunch({ root, settings, argv: restart.args })
    assert.equal(next, null)
    await writeMigrationHealth(next, 'starting')
    await writeMigrationHealth(next, 'ready')
    assert.equal(await readFile(join(sourceHome, 'sessions/history.json'), 'utf8'), 'keep history')
    if (migration) assert.equal(await readFile(join(targetHome, 'sessions/history.json'), 'utf8'), 'keep history')
    await assert.rejects(readFile(health), { code: 'ENOENT' })
  })
}

test('ordinary restarts retain configuration and shell arguments', () => {
  const args = ['app path', '--lang=zh-CN', '--user-data-dir=user profile']
  assert.deepEqual(desktopRelaunchOptions(args, true).args, args)
})
