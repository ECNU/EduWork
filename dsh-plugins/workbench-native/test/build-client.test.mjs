import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { buildClient } from '../build-client.mjs'

test('an explicit native target refuses mismatched Runtime bytes before creating a compiler stage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workbench-target-lock-'))
  try {
    const runtimePackages = join(root, 'node_modules')
    await mkdir(join(runtimePackages, '@deepseek-ai/dsh'), { recursive: true })
    await writeFile(join(runtimePackages, '@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '0.2.0-rc.2' }))
    const dshLockPath = join(root, 'lock.json')
    await writeFile(dshLockPath, JSON.stringify({ packageVersion: '0.2.1-alpha.4' }))
    await assert.rejects(buildClient({ upstream: join(root, 'no-compiler'), output: join(root, 'output'), runtimePackages, dshLockPath }), /target Runtime and DSH lock differ/)
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    await rm(root, { recursive: true, force: true })
  }
})
