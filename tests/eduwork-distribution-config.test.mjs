import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const validator = fileURLToPath(new URL('../scripts/validate-distribution-config.mjs', import.meta.url))
test('institution overlays accept GitHub, static, disabled and inherited update defaults without logging deployment IDs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-config-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'eduwork.jsonc')
  const base = { schemaVersion: 1, organizations: [{ id: 'example', oidc: { issuer: 'https://identity.example.org', clientId: 'synthetic-overlay-client' } }] }
  const run = async updates => {
    await writeFile(path, JSON.stringify({ ...base, ...(updates === undefined ? {} : { updates }) }))
    return execFileSync(process.execPath, [validator, path], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' })
  }
  for (const updates of [undefined, {provider:'github',repository:'ecnu/EduWork'}, {provider:'github',repository:'ecnu/EduWork',defaultPolicy:'development'}, {provider:'static',manifestURL:'https://updates.example.org/stable/latest-windows-amd64.json',defaultPolicy:'stable'}, {provider:'disabled'}]) {
    const output = await run(updates)
    assert.deepEqual(JSON.parse(output), { organizations: 1, defaultPolicy: updates?.defaultPolicy ?? null })
    assert.equal(output.includes('synthetic-overlay-client'), false)
  }
  await assert.rejects(() => run({provider:'static'}), /manifestURL/)
  await assert.rejects(() => run({provider:'github',repository:'https://github.com/ecnu/EduWork'}), /owner\/repo/)
  await assert.rejects(() => run({provider:'github',manifestURL:'https://updates.example.org/latest.json'}), /manifestURL/)
  await assert.rejects(() => run({defaultPolicy:'unsupported'}), /defaultPolicy/)
})
