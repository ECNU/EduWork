import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDevelopmentEnvironment } from '../scripts/lib/dev-environment.mjs'
import { assertBuildOutput, developmentPaths, resetDevelopmentOutput } from '../scripts/lib/dev-workspace.mjs'

test('development environment recovers a late Windows key without replacing an explicit key', async () => {
  const env = {}
  await loadDevelopmentEnvironment({ env, platform: 'win32', readWindowsKey: async () => 'synthetic-key' })
  assert.equal(env.DEEPSEEK_API_KEY, 'synthetic-key')
  await loadDevelopmentEnvironment({ env, platform: 'win32', readWindowsKey: async () => { throw new Error('must not read') } })
  const unix = {}
  await loadDevelopmentEnvironment({ env: unix, platform: 'linux', readWindowsKey: async () => { throw new Error('must not read') } })
  assert.deepEqual(unix, {})
})

test('overwriting development artifacts preserves sessions and configuration beside them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-dev-workflow-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = developmentPaths(root)
  await mkdir(paths.desktop, { recursive: true })
  await mkdir(paths.state, { recursive: true })
  await writeFile(join(paths.desktop, 'old-artifact'), 'old build')
  await writeFile(join(paths.state, 'session.json'), '{"synthetic":true}')
  await resetDevelopmentOutput(root, paths.desktop)
  await assert.rejects(readFile(join(paths.desktop, 'old-artifact')), { code: 'ENOENT' })
  assert.equal(await readFile(join(paths.state, 'session.json'), 'utf8'), '{"synthetic":true}')
  for (const target of [root, join(root, 'dist'), paths.state, join(root, '../other')]) {
    await assert.rejects(resetDevelopmentOutput(root, target), /Not a managed/)
  }
})

test('build output allows dist but rejects source and overlapping inputs', () => {
  const root = join(tmpdir(), 'eduwork-source')
  assertBuildOutput(root, join(root, 'dist/dev/desktop/source'), [join(root, 'dist/dev/desktop/runtime')])
  assertBuildOutput(root, join(tmpdir(), 'external-output'))
  for (const output of [root, join(root, '..'), join(root, 'dist'), join(root, 'packages/output')]) {
    assert.throws(() => assertBuildOutput(root, output), /Build output/)
  }
  assert.throws(() => assertBuildOutput(root, join(root, 'dist/runtime/output'), [join(root, 'dist/runtime')]), /Build output/)
})

test('output reset refuses a running Web host, workspace locks and redirected directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-dev-guards-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const paths = developmentPaths(root)
  await mkdir(paths.desktop, { recursive: true })
  await mkdir(join(paths.state, 'web/logs'), { recursive: true })
  const control = join(paths.state, 'web/logs/control.json')
  await writeFile(control, JSON.stringify({ pid: process.pid, assembly: join(paths.desktop, 'product') }))
  await assert.rejects(resetDevelopmentOutput(root, paths.desktop), /Stop the development Web/)
  await rm(control)
  const lock = join(paths.desktop, 'pipeline-checkpoint.json.lock')
  await mkdir(lock)
  await assert.rejects(resetDevelopmentOutput(root, paths.desktop), /workspace lock/)
  await rm(lock, { recursive: true })
  await rm(paths.desktop, { recursive: true })
  await symlink(paths.state, paths.desktop, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(resetDevelopmentOutput(root, paths.desktop), /directory links/)
})
