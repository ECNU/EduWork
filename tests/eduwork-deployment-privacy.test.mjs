import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { auditDistribution } from '../scripts/audit-eduwork-distribution.mjs'

test('source audit rejects deployment client identifiers and permits placeholder examples', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-config-audit-'))
  try {
    for (const extension of ['json', 'jsonc']) {
      const file = join(root, `organization.${extension}`)
      await writeFile(file, JSON.stringify({ oidc: { clientId: 'synthetic-live-identifier-for-test' } }))
      const report = auditDistribution({ root })
      assert.ok(report.errors.some(error => error.includes('live OIDC client identifier')))
      assert.ok(report.errors.every(error => !error.includes('synthetic-live-identifier-for-test')))
      await writeFile(file, JSON.stringify({ oidc: { clientId: 'replace-with-desktop-public-client-id' } }))
      assert.deepEqual(auditDistribution({ root }).errors, [])
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
