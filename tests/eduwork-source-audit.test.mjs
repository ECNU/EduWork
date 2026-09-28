import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { auditDistribution } from '../scripts/audit-eduwork-distribution.mjs'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const probe = join(here, 'fixtures', 'audit-stack-probe.mjs')

// A generated tree large enough to overflow the old spread aggregate, written
// in one directory so the per-file cost stays the only cost. Opt in because a
// faithful reproduction needs well over a hundred thousand files.
const stress = process.env.EDUWORK_AUDIT_STRESS === '1' ? test : test.skip

async function bundle(root, directories, filesPerDirectory) {
  let count = 0
  for (let directory = 0; directory < directories; directory += 1) {
    const target = join(root, 'vendor-big', `package-${directory}`)
    await mkdir(target, { recursive: true })
    for (let file = 0; file < filesPerDirectory; file += 1) {
      await writeFile(join(target, `entry-${file}.txt`), 'synthetic\n')
      count += 1
    }
  }
  return count
}

// The stack limit is where the old aggregate blew up, not the reported size.
test('source audit survives an aggregate past the argument limit', async () => {
  const { stdout } = await run(process.execPath, ['--stack-size=100', probe, '7000'], { timeout: 120000 })
  const result = JSON.parse(stdout)
  assert.equal(result.spreadFails, true, 'the probe no longer reproduces the over-limit aggregate')
  assert.equal(result.reported, result.files)
  assert.deepEqual(result.errors, [])
})

stress('source audit walks a full-size generated tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-audit-stress-'))
  try {
    const written = await bundle(root, 400, 400)
    const report = auditDistribution({ root })
    assert.equal(report.files, written)
    assert.deepEqual(report.errors, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('source audit prunes generated directories instead of reporting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-audit-generated-'))
  try {
    await writeFile(join(root, 'kept.mjs'), 'export const kept = true\n')
    for (const generated of ['node_modules', 'dist', 'logs']) {
      await mkdir(join(root, generated, 'nested'), { recursive: true })
      await writeFile(join(root, generated, 'nested', 'artifact.txt'), 'generated\n')
    }
    const report = auditDistribution({ root })
    assert.equal(report.files, 1)
    assert.deepEqual(report.skipped, ['dist', 'logs', 'node_modules'])
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('source audit still reports a real violation inside a kept directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-audit-violation-'))
  try {
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'leak.mjs'), 'export const leak = "/Users/example/private/tree"\n')
    const report = auditDistribution({ root })
    assert.ok(report.errors.some(error => error.includes('developer-specific absolute path')), JSON.stringify(report.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})
