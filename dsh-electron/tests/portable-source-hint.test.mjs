import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { portableSourceHintPath, portableSourceSuggestion, readPortableSourceHint } from '../src/portable-source-hint.mjs'

test('portable source hint is read beside, never inside, the installed data directory', async t => {
  const localAppData = await mkdtemp(join(tmpdir(), 'eduwork-portable-hint-'))
  t.after(() => rm(localAppData, { recursive: true, force: true }))
  const program = join(localAppData, 'Programs', 'EduWork')
  await mkdir(join(localAppData, 'EduWork'), { recursive: true })
  await writeFile(portableSourceHintPath(localAppData, 'eduwork'), JSON.stringify({ schemaVersion: 1, distribution: 'eduwork',
    root: program, version: '0.4.14', updatedAt: '2026-11-19T00:00:00.000Z' }))
  assert.equal(await readPortableSourceHint({ localAppData, distribution: 'eduwork' }).then(value => value.root), program)
  assert.equal(await portableSourceSuggestion({ localAppData, distribution: 'eduwork', validate: async root => ({ root }) }), program)
  assert.equal(await portableSourceSuggestion({ localAppData, distribution: 'eduwork', validate: async () => { throw Error('stale source') } }), undefined)
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
