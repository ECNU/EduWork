import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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
  assert.match(result.stdout + result.stderr, /another projection policy,[\s\S]*platform or[\s\S]*architecture/)
})
test('npm assembly checks the actual distribution lock, not only its receipt', async t => {
  const f = await fixture(t)
  await writeFile(join(f.runtime, '.eduwork-distribution-lock.json'), 'changed')
  const result = f.run(); assert.notEqual(result.status, 0)
  assert.match(result.stdout + result.stderr, /Distribution Runtime lock proof differs/)
})

test('web package and skill staging use portable paths and commands', async () => {
  for (const name of ['install-locked-dsh-package.ps1', 'copy-dsh-package-payload.ps1', 'install-bundled-dsh-skills.ps1']) {
    const script = await readFile(join(root, 'scripts', name), 'utf8')
    assert.match(script, /\[IO\.Path\]::DirectorySeparatorChar/, name)
    assert.doesNotMatch(script, /TrimEnd\('\\\\'\)/, name)
    assert.doesNotMatch(script, /\+ '\\\\'/, name)
    assert.doesNotMatch(script, /npm\.cmd|tar\.exe/, name)
  }
  for (const name of ['client-ui-branding', 'client-ui-conversation-brand', 'client-ui-skill-live', 'client-ui-component-inventory', 'client-ui-agent-preset-product', 'client-ui-media-artifacts']) {
    const script = await readFile(join(root, 'dsh-plugins', name, 'build-client.ps1'), 'utf8')
    assert.match(script, /\[IO\.Path\]::DirectorySeparatorChar/, name)
    assert.doesNotMatch(script, /\+ '\\\\'/, name)
  }
  for (const name of ['client-ui-branding', 'client-ui-component-inventory', 'client-ui-media-artifacts', 'workbench-native', 'activity-insights-native']) {
    const script = await readFile(join(root, 'dsh-plugins', name, 'build-client.ps1'), 'utf8')
    assert.match(script, /\$IsWindows[\s\S]*tsdown\.cmd[\s\S]*tsdown/, name)
  }
  for (const name of ['workbench-native', 'activity-insights-native']) {
    const script = await readFile(join(root, 'dsh-plugins', name, 'build-client.ps1'), 'utf8')
    assert.match(script, /\$IsWindows[\s\S]*Junction[\s\S]*SymbolicLink/, name)
    assert.doesNotMatch(script, /-ItemType Junction/, name)
  }
  const assembly = await readFile(join(root, 'scripts/assemble-eduwork-web.ps1'), 'utf8')
  assert.match(assembly, /foreach \(\$packageName in \$local\.Keys\).*\$bundleDependencies\[\$packageName\]/s)
  assert.match(assembly, /dependencies=\$bundleDependencies/)
  const product = await readFile(join(root, 'scripts/prepare-desktop-product.ps1'), 'utf8')
  assert.match(product, /copy-desktop-tree\.ps1/)
})

test('desktop tree copy merges into an existing directory without following links', { skip: process.platform === 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-copy-tree-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source')
  const destination = join(directory, 'destination')
  await mkdir(join(source, 'lib'), { recursive: true })
  await mkdir(join(destination, 'lib'), { recursive: true })
  await writeFile(join(source, 'lib/index.js'), 'new')
  await writeFile(join(source, '.hidden'), 'included')
  await writeFile(join(destination, 'lib/index.js'), 'old')
  await writeFile(join(destination, 'lib/keep.js'), 'keep')
  const runCopy = (from, to) => spawnSync('pwsh', ['-NoProfile', '-Command', '. $env:EDUWORK_COPY_HELPER; Copy-Tree $env:EDUWORK_COPY_SOURCE $env:EDUWORK_COPY_DESTINATION'], {
    encoding: 'utf8',
    env: { ...process.env, EDUWORK_COPY_HELPER: join(root, 'scripts/copy-desktop-tree.ps1'), EDUWORK_COPY_SOURCE: from, EDUWORK_COPY_DESTINATION: to }
  })
  const result = runCopy(source, destination)
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  assert.equal(await readFile(join(destination, 'lib/index.js'), 'utf8'), 'new')
  assert.equal(await readFile(join(destination, 'lib/keep.js'), 'utf8'), 'keep')
  assert.equal(await readFile(join(destination, '.hidden'), 'utf8'), 'included')
  await assert.rejects(readFile(join(destination, 'source/lib/index.js')))
  await assert.rejects(readFile(join(destination, 'lib/lib/index.js')))

  const outside = join(directory, 'outside.txt')
  await writeFile(outside, 'outside')
  await symlink(outside, join(source, 'linked.txt'))
  const linkedSource = runCopy(source, destination)
  assert.notEqual(linkedSource.status, 0)
  assert.match(linkedSource.stderr, /does not follow links/)
  await symlink(outside, join(destination, 'lib/target.js'))
  await writeFile(join(source, 'lib/target.js'), 'replacement')
  const linkedTarget = runCopy(source, destination)
  assert.notEqual(linkedTarget.status, 0)
  assert.match(linkedTarget.stderr, /target must be a real file/)
  assert.equal(await readFile(outside, 'utf8'), 'outside')
})
