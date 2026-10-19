import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { packages, selectPackage, changedGroups, needsProductBuild } from '../scripts/packages/catalog.mjs'
import { inspectArchive } from '../scripts/packages/archive.mjs'
import { verifyPublicationSource } from '../scripts/packages/publication-source.mjs'

test('npm publication requires the reviewed main commit without package tags', () => {
  const commit = 'a'.repeat(40)
  const env = { GITHUB_REPOSITORY: 'ECNU/EduWork', GITHUB_REF: 'refs/heads/main', SOURCE_COMMIT: commit, GITHUB_SHA: commit }
  assert.doesNotThrow(() => verifyPublicationSource(commit, env))
  assert.throws(() => verifyPublicationSource(commit, { ...env, SOURCE_COMMIT: '' }), /full source commit/)
  assert.throws(() => verifyPublicationSource(commit, { ...env, SOURCE_COMMIT: 'b'.repeat(40) }), /Reviewed and checked-out/)
  assert.throws(() => verifyPublicationSource(commit, { ...env, GITHUB_SHA: 'b'.repeat(40) }), /Workflow and checked-out/)
  assert.throws(() => verifyPublicationSource(commit, { ...env, GITHUB_REF: 'refs/tags/dsh-oidc-v1.2.3' }), /from main/)
  assert.throws(() => verifyPublicationSource(commit, { ...env, GITHUB_REF: 'refs/heads/feature' }), /from main/)
  assert.throws(() => verifyPublicationSource(commit, { ...env, GITHUB_REPOSITORY: 'someone/EduWork' }), /Only the source repository/)
})

test('shared-service changes select Studio integration; unrelated packages and docs do not rebuild', () => {
  assert.deepEqual(changedGroups(['packages/dsh-knowledge-studio/packages/artifact-services/lib/speech.js']), ['dsh-knowledge-studio'])
  assert.deepEqual(changedGroups(['packages/dsh-oidc/src/host/model-provider.ts']), ['dsh-oidc'])
  assert.deepEqual(changedGroups(['packages/dsh-mail/README.md', 'README.md']), [])
  assert.equal(changedGroups(['scripts/packages/release.mjs']).length, 6)
  assert.equal(needsProductBuild(['packages/dsh-oidc/src/host/model-provider.ts', 'docs/PACKAGES.md']), false)
  assert.equal(needsProductBuild(['third_party/npm-015-rc1/dsh-oidc/LOCK.json']), true)
  assert.equal(needsProductBuild(['dsh-host/entry.mjs']), true)
  assert.throws(() => selectPackage('../../private'), /Unknown package/)
})
test('seven separate package identities retain registry dependency contracts and product npm locks', async () => {
  assert.equal(new Set(packages.map(p => p.name)).size, 7)
  for (const selected of packages) {
    const pkg = JSON.parse(await readFile(new URL(`../${selected.directory}/package.json`, import.meta.url)))
    assert.equal(pkg.name, selected.name)
    assert.equal(pkg.repository.directory, selected.directory)
    assert.equal(pkg.repository.url, 'git+https://github.com/ECNU/EduWork.git')
    assert.equal(pkg.publishConfig.access, 'public')
    for (const version of Object.values(pkg.dependencies || {})) assert.ok(!/^(file:|link:|workspace:)/.test(version))
  }
  const assembly = JSON.parse(await readFile(new URL('../config/assembly.eduwork.json', import.meta.url)))
  for (const selected of packages) {
    const declaration = assembly.externalPackages.find(p => p.name === selected.name)
    if (selected.id === 'dsh-desktop-pet') {
      // Electron-only DSH 0.2 package; never add it to the legacy 0.1.x product.
      assert.equal(declaration, undefined)
      continue
    }
    if (selected.id === 'dsh-literature') {
      // The DSH 0.2 fork is independent of the current 0.1.7 client assembly.
      // Publishing it must not replace an incompatible legacy release dependency.
      assert.equal(declaration, undefined)
      assert.ok(assembly.externalPackages.some(p => p.name === '@shlv/dsh-literature'))
      continue
    }
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
  const selected = selectPackage('dsh-oidc')
  const manifest = { name: selected.name, version: '1.2.3', repository: { url: 'git+https://github.com/ECNU/EduWork.git', directory: selected.directory }, exports: { '.': './lib/index.js' } }
  const files = { 'package/package.json': JSON.stringify(manifest), 'package/lib/index.js': 'export default {}' }
  assert.equal(inspectArchive(tarball(files), selected, '1.2.3').manifest.name, selected.name)
  const wrongCasing = { ...manifest, repository: { ...manifest.repository, url: 'git+https://github.com/ecnu/EduWork.git' } }
  assert.throws(() => inspectArchive(tarball({ ...files, 'package/package.json': JSON.stringify(wrongCasing) }), selected, '1.2.3'))
  assert.throws(() => inspectArchive(tarball(files), selectPackage('dsh-mail'), '1.2.3'))
  assert.throws(() => inspectArchive(tarball(files), selected, '9.9.9'))
  assert.throws(() => inspectArchive(tarball({ 'package/package.json': files['package/package.json'] }), selected, '1.2.3'), /Missing packed export/)
  assert.throws(() => inspectArchive(tarball({ ...files, 'package/../escape.js': 'bad' }), selected, '1.2.3'), /Unsafe archive path/)
  assert.throws(() => inspectArchive(tarball({ ...files, 'package/node_modules/dependency.js': 'bad' }), selected, '1.2.3'), /Unexpected packed file/)
})

test('desktop pet publication rejects a package missing a referenced character image', () => {
  const selected = selectPackage('dsh-desktop-pet')
  const manifest = { name: selected.name, version: '0.1.0', repository: { url: 'git+https://github.com/ECNU/EduWork.git', directory: selected.directory }, exports: { '.': './lib/index.js' } }
  const files = Object.fromEntries(['LICENSE', 'skins/LICENSE', 'README.md', 'README_EN.md', 'cordis.patch.yml',
    'lib/index.js', 'lib/client.js', 'lib/page/pet.html', 'lib/page/pet.js', 'lib/page/pet.css', 'lib/pet-state.js', 'lib/skin-files.js']
    .map(file => ['package/' + file, 'fixture']))
  files['package/package.json'] = JSON.stringify(manifest)
  for (const id of ['eduwork-page', 'eduwork-page-blue', 'dafeiyu', 'ecnu-huashi']) {
    files[`package/skins/${id}/skin.json`] = JSON.stringify({ animations: { idle: { image: 'idle.svg' } } })
    files[`package/skins/${id}/idle.svg`] = '<svg/>'
  }
  assert.doesNotThrow(() => inspectArchive(tarball(files), selected, '0.1.0'))
  delete files['package/skins/dafeiyu/idle.svg']
  assert.throws(() => inspectArchive(tarball(files), selected, '0.1.0'), /Missing packed character image dafeiyu\/idle.svg/)
})
