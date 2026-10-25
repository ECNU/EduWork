import assert from 'node:assert/strict'
import test from 'node:test'
import { affectedAdvisories, auditInventory, collectInventory, validateSecurityBaseline } from '../scripts/bundled-dependencies.mjs'
import { readFile } from 'node:fs/promises'

const inventory = JSON.parse(await readFile(new URL('../lib/bundled-dependencies.json', import.meta.url), 'utf8'))
test('inventory matches all emitted modules, including nested dependencies and output hashes', async () => {
  assert.deepEqual(inventory, await collectInventory())
  assert.equal(inventory.package.version, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version)
})
test('an old nested parser fails even if the direct Nodemailer version is fixed', () => {
  const stale = structuredClone(inventory)
  stale.dependencies.push({ path: 'node_modules/mailparser/node_modules/nodemailer', name: 'nodemailer', version: '10.0.1' })
  assert.throws(() => validateSecurityBaseline(stale), /Vulnerable bundled Nodemailer/)
})
test('advisory lookup includes nested versions and rejects high severity in shipped code', async () => {
  const rows = inventory.dependencies
  const result = affectedAdvisories(rows, { nodemailer: [{ severity: 'high', vulnerable_versions: '<10.1.4' }] })
  assert.deepEqual(result, [])
  await assert.rejects(auditInventory(inventory, async (_url, options) => {
    assert.ok(JSON.parse(options.body).nodemailer.includes('10.2.1'))
    return { ok: true, json: async () => ({ nodemailer: [{ severity: 'high', vulnerable_versions: '*', title: 'Synthetic regression', url: 'https://example.invalid/advisory' }] }) }
  }), /High\/critical vulnerabilities/)
})
test('registry failure and malformed responses cannot silently pass security checks', async () => {
  await assert.rejects(auditInventory(inventory, async () => ({ ok: false, status: 503 })), /HTTP 503/)
  await assert.rejects(auditInventory(inventory, async () => ({ ok: true, json: async () => ({ error: 'unavailable' }) })), /Invalid advisory package/)
})
