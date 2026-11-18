import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { portableMigrationNotice, portableMigrationNoticeForBuild, portableSourceHintPath, portableSourceSuggestion, readPortableSourceHint, writePortableSourceHint, writePortableSourceHintBestEffort } from '../src/portable-source-hint.mjs'

test('portable migration notice uses the public release or signed edition release URL', () => {
  assert.deepEqual(portableMigrationNotice({ distribution: 'eduwork', version: '0.4.14', releasesURL: 'https://ignored.example/releases' }),
    { installerURL: 'https://github.com/ecnu/EduWork/releases/tag/v0.4.14' })
  assert.deepEqual(portableMigrationNotice({ distribution: 'school', version: '0.4.14', releasesURL: 'https://example.edu/downloads' }),
    { installerURL: 'https://example.edu/downloads' })
  assert.equal(portableMigrationNotice({ distribution: 'school', version: '0.4.14' }), undefined)
  assert.throws(() => portableMigrationNotice({ distribution: 'school', version: '0.4.14', releasesURL: 'http://example.edu/downloads' }), /HTTPS/)
})

test('migration notice is Windows-portable only and reads publisher releases URL from updates', () => {
  assert.equal(portableMigrationNoticeForBuild({ platform: 'darwin', dataLayout: 'portable', distribution: 'eduwork', version: '0.4.14' }), undefined)
  assert.equal(portableMigrationNoticeForBuild({ platform: 'win32', dataLayout: 'installed', distribution: 'school', version: '0.4.14',
    trustedUpdates: { updates: { releasesURL: 'https://example.edu/downloads' } } }), undefined)
  assert.deepEqual(portableMigrationNoticeForBuild({ platform: 'win32', dataLayout: 'portable', distribution: 'school', version: '0.4.14',
    trustedUpdates: { updates: { releasesURL: 'https://example.edu/downloads' } } }), { installerURL: 'https://example.edu/downloads' })
  assert.equal(portableMigrationNoticeForBuild({ platform: 'win32', dataLayout: 'portable', distribution: 'school', version: '0.4.14',
    trustedUpdates: { releasesURL: 'https://wrong-level.example' } }), undefined)
})

test('portable hint write failures are logged and do not reject startup preparation', async () => {
  let logged
  const result = await writePortableSourceHintBestEffort({}, error => { logged = error })
  assert.equal(result, undefined)
  assert.equal(logged.message, 'Portable source hint requires absolute paths')
})

test('portable source hint is written beside, never inside, the installed data directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-portable-hint-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const localAppData = join(root, 'LocalAppData'), program = join(root, 'Programs', 'EduWork')
  const path = await writePortableSourceHint({ localAppData, distribution: 'eduwork', root: program,
    version: '0.4.14', now: () => new Date('2026-11-19T00:00:00.000Z') })
  assert.equal(path, join(localAppData, 'EduWork', 'eduwork.portable-source.json'))
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), {
    schemaVersion: 1, distribution: 'eduwork', root: program, version: '0.4.14', updatedAt: '2026-11-19T00:00:00.000Z',
  })
  assert.equal(await readPortableSourceHint({ localAppData, distribution: 'eduwork' }).then(value => value.root), program)
  assert.equal(await portableSourceSuggestion({ localAppData, distribution: 'eduwork', validate: async root => ({ root }) }), program)
  assert.equal(await portableSourceSuggestion({ localAppData, distribution: 'eduwork', validate: async () => { throw Error('stale source') } }), undefined)
  await assert.rejects(readFile(join(localAppData, 'EduWork', 'eduwork', 'data')), { code: 'ENOENT' })
})

test('missing, mismatched and malformed portable source hints are ignored', async t => {
  const localAppData = await mkdtemp(join(tmpdir(), 'eduwork-portable-hint-invalid-'))
  t.after(() => rm(localAppData, { recursive: true, force: true }))
  assert.equal(await readPortableSourceHint({ localAppData, distribution: 'eduwork' }), null)
  const path = portableSourceHintPath(localAppData, 'eduwork')
  await mkdir(join(localAppData, 'EduWork'), { recursive: true })
  await writeFile(path, JSON.stringify({ schemaVersion: 1, distribution: 'other', root: localAppData,
    version: '1.0.0', updatedAt: new Date().toISOString() }))
  assert.equal(await readPortableSourceHint({ localAppData, distribution: 'eduwork' }), null)
})
