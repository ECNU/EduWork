import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { packages, selectPackage, changedGroups, needsProductBuild } from '../scripts/packages/catalog.mjs'
import { inspectArchive } from '../scripts/packages/archive.mjs'

test('shared-service changes select Studio integration; unrelated packages and docs do not rebuild', () => {
  assert.deepEqual(changedGroups(['packages/dsh-knowledge-studio/packages/artifact-services/lib/speech.js']), ['dsh-knowledge-studio'])
  assert.deepEqual(changedGroups(['packages/dsh-oidc/src/host/model-provider.ts']), ['dsh-oidc'])
  assert.deepEqual(changedGroups(['packages/dsh-mail/README.md', 'README.md']), [])
  assert.equal(changedGroups(['scripts/packages/release.mjs']).length, 4)
  assert.equal(needsProductBuild(['packages/dsh-oidc/src/host/model-provider.ts', 'docs/PACKAGES.md']), false)
  assert.equal(needsProductBuild(['third_party/npm-015-rc1/dsh-oidc/LOCK.json']), true)
  assert.equal(needsProductBuild(['dsh-host/entry.mjs']), true)
  assert.throws(() => selectPackage('../../private'), /Unknown package/)
})
test('five separate package identities retain registry dependency contracts and product npm locks', async () => {
  assert.equal(new Set(packages.map(p => p.name)).size, 5)
  for (const selected of packages) {
    const pkg = JSON.parse(await readFile(new URL(`../${selected.directory}/package.json`, import.meta.url)))
    assert.equal(pkg.name, selected.name)
    assert.equal(pkg.repository.directory, selected.directory)
    assert.equal(pkg.repository.url, 'git+https://github.com/ecnu/EduWork.git')
    assert.equal(pkg.publishConfig.access, 'public')
    for (const version of Object.values(pkg.dependencies || {})) assert.ok(!/^(file:|link:|workspace:)/.test(version))
  }
  const assembly = JSON.parse(await readFile(new URL('../config/assembly.eduwork.json', import.meta.url)))
  for (const selected of packages) {
    const declaration = assembly.externalPackages.find(p => p.name === selected.name)
    assert.ok(declaration, `${selected.name} still uses the npm assembly boundary`)
    const lock = JSON.parse(await readFile(new URL(`../${declaration.lock}`, import.meta.url)))
    assert.equal(lock.publicationStatus, 'published')
    assert.ok(lock.npm.tarball.startsWith('https://registry.npmjs.org/'))
    assert.ok(lock.npm.integrity.startsWith('sha512-'))
  }
})
function tarball(files) {
  const records = []
  for (const [file, content] of Object.entries(files)) {
    const bytes = Buffer.from(content), header = Buffer.alloc(512)
    header.write(file)
    header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124)
    header[156] = 48
    records.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...records, Buffer.alloc(1024)]))
}
test('publication rejects the wrong package, missing entry points and archive traversal', () => {
  const selected = packages[0]
  const manifest = { name: selected.name, version: '1.2.3', repository: { url: 'git+https://github.com/ecnu/EduWork.git', directory: selected.directory }, exports: { '.': './lib/index.js' } }
  const files = { 'package/package.json': JSON.stringify(manifest), 'package/lib/index.js': 'export default {}' }
  assert.equal(inspectArchive(tarball(files), selected, '1.2.3').manifest.name, selected.name)
  assert.throws(() => inspectArchive(tarball(files), packages[1], '1.2.3'))
  assert.throws(() => inspectArchive(tarball(files), selected, '9.9.9'))
  assert.throws(() => inspectArchive(tarball({ 'package/package.json': files['package/package.json'] }), selected, '1.2.3'), /Missing packed export/)
  assert.throws(() => inspectArchive(tarball({ ...files, 'package/../escape.js': 'bad' }), selected, '1.2.3'), /Unsafe archive path/)
  assert.throws(() => inspectArchive(tarball({ ...files, 'package/node_modules/dependency.js': 'bad' }), selected, '1.2.3'), /Unexpected packed file/)
})
