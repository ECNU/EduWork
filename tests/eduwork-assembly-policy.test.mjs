import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
const root = fileURLToPath(new URL('../', import.meta.url))
const hash = data => createHash('sha256').update(data).digest('hex')
const put = (path, value) => writeFile(path, JSON.stringify(value))
async function fixture(t) {
  await mkdir(join(root, 'dist'), { recursive: true })
  const directory = await mkdtemp(join(root, 'dist/assembly-policy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const lock = JSON.parse(await readFile(join(root, 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json')))
  const proof = await readFile(join(root, 'third_party/dsh/release-v0.1.5-rc.2/npm-runtime/package-lock.json'))
  const runtime = join(directory, 'runtime'); await mkdir(runtime)
  const identity = { source: 'npm-lock', platform: process.platform, arch: process.arch, dshVersion: lock.packageVersion, dshCommit: lock.commit, packageLockSHA256: hash(proof) }
  const projectionProof = Buffer.from('{"packages":{}}')
  const projection = { ...identity, policySHA256: hash(await readFile(join(root, 'scripts/project-eduwork-runtime.mjs'))), distributionLockSHA256: hash(projectionProof) }
  await put(join(runtime, '.chatecnu-dsh-runtime.json'), identity)
  await writeFile(join(runtime, '.chatecnu-dsh-npm-install-lock.json'), proof)
  await put(join(runtime, '.eduwork-distribution-runtime.json'), projection)
  await writeFile(join(runtime, '.eduwork-distribution-lock.json'), projectionProof)
  const run = () => spawnSync('pwsh', ['-NoProfile', '-File', join(root, 'scripts/assemble-eduwork-web.ps1'), '-CoreRoot', root, '-RuntimeSource', runtime, '-Upstream', join(directory, 'unused-source'), '-Output', join(directory, 'output'), '-Version', '0.3.0-dev.test'], { encoding: 'utf8', windowsHide: true })
  return { runtime, identity, projection, run }
}
test('npm assembly rejects a source-runtime cache instead of silently changing mode', async t => {
  const f = await fixture(t)
  await put(join(f.runtime, '.chatecnu-dsh-runtime.json'), { ...f.identity, source: 'source-release-pack' })
  const result = f.run(); assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /npm mode requires the selected registry package lock/)
})
for (const field of ['arch', 'policySHA256']) test(`npm assembly rejects an existing projection with a different ${field}`, async t => {
  const f = await fixture(t)
  await put(join(f.runtime, '.eduwork-distribution-runtime.json'), { ...f.projection, [field]: 'other' })
  const result = f.run(); assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /another projection policy, platform or architecture/)
})
test('npm assembly checks the actual distribution lock, not only its receipt', async t => {
  const f = await fixture(t)
  await writeFile(join(f.runtime, '.eduwork-distribution-lock.json'), 'changed')
  const result = f.run(); assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /Distribution Runtime lock proof differs/)
})
