import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { validateNpmRuntimeLock } from '../../dsh-desktop/scripts/prepare-dsh-runtime.mjs'
import { projectRuntime, omittedRoots } from '../project-eduwork-runtime.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = join(root, 'third_party/dsh/release-v0.1.5-rc.2')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const readJSON = async path => JSON.parse(await readFile(path, 'utf8'))
const writeJSON = async (path, value) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value, null, 2) + '\n') }
async function contract(contractDirectory = directory) {
  const manifest = await readJSON(join(contractDirectory, 'npm-runtime/package.json'))
  const lock = await readJSON(join(contractDirectory, 'LOCK.json'))
  const packageLockBytes = await readFile(join(contractDirectory, 'npm-runtime/package-lock.json'))
  return { manifest, lock, packageLockBytes, packageLock: JSON.parse(packageLockBytes) }
}
function relock(input) {
  input.packageLockBytes = Buffer.from(JSON.stringify(input.packageLock))
  input.lock.runtime.npm.packageLockSHA256 = hash(input.packageLockBytes)
  return input
}
async function temporary(t) {
  await mkdir(join(root, 'dist'), { recursive: true })
  const dir = await mkdtemp(join(root, 'dist/npm-runtime-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('approved npm lock is complete registry-only, exact DSH and excludes product plugins', async () => {
  const input = await contract()
  assert.equal(validateNpmRuntimeLock(input), input.lock.runtime.npm.packageLockSHA256)
  for (const name of omittedRoots) assert.equal(input.manifest.dependencies[name], undefined)
  for (const path of Object.keys(input.packageLock.packages)) assert.ok(!path.includes('node_modules/@eduwork/'))
})

test('0.1.7 candidate has an independent exact registry lock and no retired DSH packages', async () => {
  const input = await contract(join(root, 'third_party/dsh/candidate-v0.1.7-rc.1'))
  assert.equal(validateNpmRuntimeLock(input), input.lock.runtime.npm.packageLockSHA256)
  assert.equal(input.lock.packageVersion, '0.1.7-rc.1')
  assert.equal(input.lock.qualification.status, 'migration-candidate')
  assert.equal(input.lock.qualification.desktop, false)
  const dsh = input.packageLock.packages['node_modules/@deepseek-ai/dsh']
  assert.equal(dsh.integrity, input.lock.runtime.npm.dshIntegrity)
  for (const name of ['agent-presets', 'code-runtime', 'code-runtime-worker-thread', 'settings-file', 'e2b', 'fs-e2b', 'subprocess-e2b', 'workflow-worker-thread']) {
    assert.equal(input.packageLock.packages[`node_modules/@deepseek-ai/dsh-${name}`], undefined)
  }
  const current = await contract()
  assert.notEqual(input.lock.commit, current.lock.commit)
  assert.notEqual(input.lock.runtime.npm.packageLockSHA256, current.lock.runtime.npm.packageLockSHA256)
})

test('refuses altered lock bytes and non-registry tarballs even if newly hashed', async () => {
  const input = await contract()
  input.packageLockBytes = Buffer.concat([input.packageLockBytes, Buffer.from(' ')])
  assert.throws(() => validateNpmRuntimeLock(input), /hash mismatch/)
  for (const resolved of ['file:../sibling.tgz', 'https://example.com/dsh.tgz', 'https://user:password@registry.npmjs.org/dsh.tgz']) {
    const changed = await contract()
    changed.packageLock.packages['node_modules/@deepseek-ai/dsh'].resolved = resolved
    assert.throws(() => validateNpmRuntimeLock(relock(changed)), /registry runtime dependency/)
  }
})

test('refuses DSH family drift, missing integrity and unpinned direct dependencies', async () => {
  const drift = await contract()
  drift.packageLock.packages['node_modules/@deepseek-ai/dsh-agent'].version = '0.1.5'
  assert.throws(() => validateNpmRuntimeLock(relock(drift)), /Mixed DSH runtime versions/)
  const missing = await contract()
  delete missing.packageLock.packages['node_modules/@deepseek-ai/dsh'].integrity
  assert.throws(() => validateNpmRuntimeLock(relock(missing)), /Unverified registry/)
  const range = await contract()
  range.manifest.dependencies.react = '^18.3.1'
  assert.throws(() => validateNpmRuntimeLock(range), /Unpinned/)
})

test('npm preparation refuses to replace an existing directory', async t => {
  const output = await temporary(t)
  await writeFile(join(output, 'user-content.txt'), 'keep')
  const child = spawnSync(process.execPath, [join(root, 'dsh-desktop/scripts/prepare-dsh-runtime.mjs'), '--source', 'npm', '--lock', join(directory, 'LOCK.json'), '--output', output], { encoding: 'utf8', windowsHide: true })
  assert.notEqual(child.status, 0)
  assert.match(child.stderr, /Refusing to overwrite/)
  assert.equal(await readFile(join(output, 'user-content.txt'), 'utf8'), 'keep')
})

async function fixture(t, sourceKind) {
  const base = await temporary(t), source = join(base, 'input'), output = join(base, 'output')
  const npm = sourceKind === 'npm-lock'
  const dependencies = { '@deepseek-ai/dsh': '0.1.5-rc.1', mediabunny: npm ? '1.55.5' : '1.51.0', ...Object.fromEntries(omittedRoots.map(name => [name, '0.1.5-rc.1'])) }
  if (!npm) dependencies['@remotion/media-utils'] = '4.0.520'
  const manifest = { name: 'fixture', version: '0.0.0', private: true, dependencies }
  const proof = { lockfileVersion: 3, packages: { '': manifest } }
  const mediaIntegrity = 'sha512-m0v6y8FGXiK+HKOc3AZqU+kJPLYsSKaLitmQNQIIHZKIGlTwQ34OF+X6Ul0K8iV4b03oPse10apwuoqbvmKeAA=='
  for (const [name, version] of Object.entries(dependencies)) {
    const path = `node_modules/${name}`
    proof.packages[path] = { version, integrity: mediaIntegrity }
    await writeJSON(join(source, path, 'package.json'), { name, version, ...(name === '@remotion/media-utils' ? { dependencies: { mediabunny: '1.55.5' } } : {}) })
    await writeFile(join(source, path, 'index.js'), 'export default true')
    await writeFile(join(source, path, 'index.js.map'), 'debug')
  }
  if (!npm) {
    const path = 'node_modules/@remotion/media-utils/node_modules/mediabunny'
    proof.packages[path] = { version: '1.55.5', integrity: mediaIntegrity }
    await writeJSON(join(source, path, 'package.json'), { name: 'mediabunny', version: '1.55.5' })
  }
  await writeJSON(join(source, 'package.json'), manifest)
  await mkdir(join(source, 'node_modules/.bin'), { recursive: true })
  const proofFile = npm ? '.chatecnu-dsh-npm-install-lock.json' : '.chatecnu-dsh-source-install-lock.json'
  await writeJSON(join(source, proofFile), proof)
  const proofBytes = await readFile(join(source, proofFile))
  const identity = { source: sourceKind, [npm ? 'packageLockSHA256' : 'sourceInstallLockSHA256']: hash(proofBytes) }
  await writeJSON(join(source, '.chatecnu-dsh-runtime.json'), identity)
  if (!npm) await writeJSON(join(source, '.chatecnu-dsh-source-pack.json'), { schemaVersion: 1 })
  return { source, output, proofFile, identity, proofBytes }
}

for (const kind of ['npm-lock', 'source-release-pack']) test(`${kind} projection preserves proof, removes disabled agents/debug and shares mediabunny`, async t => {
  const input = await fixture(t, kind)
  const receipt = await projectRuntime(input)
  assert.equal(receipt.source, kind)
  assert.equal(receipt.mediabunny, '1.55.5')
  assert.deepEqual(await readFile(join(input.output, input.proofFile)), input.proofBytes)
  assert.deepEqual(await readFile(join(input.source, input.proofFile)), input.proofBytes)
  assert.equal((await readJSON(join(input.output, 'package.json'))).dependencies.mediabunny, '1.55.5')
  for (const path of [...omittedRoots.map(name => `node_modules/${name}`), 'node_modules/@deepseek-ai/dsh/index.js.map', 'node_modules/@remotion/media-utils/node_modules/mediabunny']) await assert.rejects(access(join(input.output, path)), { code: 'ENOENT' })
})

test('projection rejects corrupt receipt and dependency on an omitted agent', async t => {
  const input = await fixture(t, 'npm-lock')
  await writeFile(join(input.source, input.proofFile), input.proofBytes + ' ')
  await assert.rejects(projectRuntime(input), /differs from its frozen lock/)
  await writeFile(join(input.source, input.proofFile), input.proofBytes)
  await writeJSON(join(input.source, 'node_modules/@deepseek-ai/dsh/package.json'), { name: '@deepseek-ai/dsh', version: '0.1.5-rc.1', dependencies: { [omittedRoots[0]]: '0.1.5-rc.1' } })
  await assert.rejects(projectRuntime(input), /still needs omitted package/)
})
