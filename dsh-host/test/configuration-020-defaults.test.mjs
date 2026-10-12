import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configurationDocumentationOptions } from '../configuration-documentation.mjs'

test('0.2 documented subagent defaults agree with the qualified profile and preserve explicit values', async t => {
  const product = await mkdtemp(join(tmpdir(), 'eduwork-020-defaults-'))
  t.after(() => rm(product, { recursive: true, force: true }))
  const identity = { dshVersion: '0.2.0-rc.2', dshCommit: '639ed015397290b3745d163aafe02ffee4aa3f84' }
  await writeFile(join(product, 'assembly.json'), JSON.stringify(identity))
  assert.equal((await configurationDocumentationOptions(product)).defaults.features.maxActiveSubagents, 2)
  assert.equal((await configurationDocumentationOptions(product, { defaults: { features: { maxActiveSubagents: 5 } } })).defaults.features.maxActiveSubagents, 5)
  await writeFile(join(product, 'assembly.json'), JSON.stringify({ ...identity, dshCommit: 'unqualified' }))
  assert.equal((await configurationDocumentationOptions(product)).defaults.features.maxActiveSubagents, undefined)
})
