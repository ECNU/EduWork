import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'

export function archiveFiles(bytes) {
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 }), files = new Map()
  const string = buffer => buffer.toString('utf8').replace(/\0.*$/s, '')
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const prefix = string(header.subarray(345, 500))
    const name = (prefix ? prefix + '/' : '') + string(header.subarray(0, 100))
    const size = parseInt(string(header.subarray(124, 136)).trim() || '0', 8)
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, 'Invalid tar entry')
    const type = header[156]
    // npm produces ordinary files plus optional PAX metadata; never follow archive links.
    if (type === 0 || type === 48) {
      assert.ok(name.startsWith('package/') && !name.split('/').includes('..'), `Unsafe archive path: ${name}`)
      assert.ok(!files.has(name.slice(8)), `Duplicate archive file: ${name}`)
      files.set(name.slice(8), tar.subarray(offset + 512, offset + 512 + size))
    } else assert.ok([53, 120, 103].includes(type), `Unsupported tar entry type: ${type}`)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

export function inspectArchive(bytes, selected, expectedVersion) {
  const files = archiveFiles(bytes)
  assert.ok(files.has('package.json'), 'Missing packed manifest')
  const manifest = JSON.parse(files.get('package.json'))
  assert.equal(manifest.name, selected.name)
  assert.equal(manifest.version, expectedVersion)
  assert.equal(manifest.repository.url, 'git+https://github.com/ECNU/EduWork.git')
  assert.equal(manifest.repository.directory, selected.directory)
  for (const entry of Object.values(manifest.exports || {})) {
    assert.equal(typeof entry, 'string', 'Review new conditional exports before publishing')
    assert.ok(files.has(entry.replace(/^\.\//, '')), `Missing packed export ${entry}`)
  }
  if (selected.id === 'dsh-literature') {
    for (const file of ['LICENSE', 'NOTICE.md', 'UPSTREAM.json', 'README.md', 'README_EN.md', 'cordis.patch.yml']) {
      assert.ok(files.has(file), `Missing literature provenance or bundle file ${file}`)
    }
    for (const entry of Object.values(manifest.exports).filter(entry => entry.endsWith('.js'))) {
      assert.ok(files.has(entry.slice(2).replace(/\.js$/, '.d.ts')), `Missing literature declaration for ${entry}`)
    }
  }
  if (selected.id === 'dsh-desktop-pet') {
    for (const file of ['LICENSE', 'skins/LICENSE', 'README.md', 'README_EN.md', 'cordis.patch.yml',
      'lib/client.js', 'lib/page/pet.html', 'lib/page/pet.js', 'lib/page/pet.css', 'lib/pet-state.js', 'lib/skin-files.js']) {
      assert.ok(files.has(file), `Missing desktop pet runtime or license file ${file}`)
    }
    for (const id of ['eduwork-page', 'eduwork-page-blue', 'dafeiyu', 'ecnu-huashi']) {
      assert.ok(files.has(`skins/${id}/skin.json`), `Missing built-in character ${id}`)
      const references = value => {
        if (typeof value === 'string' && /\.(svg|png|webp)$/i.test(value)) {
          assert.ok(files.has(`skins/${id}/${value}`), `Missing packed character image ${id}/${value}`)
        } else if (value && typeof value === 'object') Object.values(value).forEach(references)
      }
      references(JSON.parse(files.get(`skins/${id}/skin.json`)))
    }
    assert.ok(!manifest.private, 'Desktop pet archive must be publishable')
    assert.ok(!manifest.peerDependencies?.['@eduwork/desktop-services'], 'Host service injection is not an npm dependency')
  }
  if (selected.id === 'dsh-remote-access') {
    assert.equal(manifest.bin?.['eduwork-remote-relay'], 'lib/relay.js', 'Missing remote relay command')
    for (const file of ['lib/relay.js', 'lib/web/index.html', 'lib/web/loader.js', 'lib/web/loader.css',
      'lib/web/sw.js', 'lib/web/preamble.js', 'lib/web/manifest.webmanifest', 'lib/web/icon.svg', 'lib/web/icon.png',
      'lib/THIRD_PARTY_LICENSES.txt', 'docs/PROTOCOL.md', 'cordis.patch.yml', 'README.md', 'README_EN.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
      assert.ok(files.has(file), `Missing remote runtime, protocol or license file ${file}`)
    }
  }
  for (const [file, content] of files) {
    assert.ok(!/(^|\/)(node_modules|\.git|\.local|dist|test|tests)(\/|$)|\.(tgz|log|map)$/.test(file), `Unexpected packed file ${file}`)
    if (!/\.(js|mjs|ts|json|md|yml|yaml|py|ps1|txt)$/.test(file)) continue
    const text = content.toString('utf8')
    assert.ok(!/(?:ghp_|github_pat_|npm_)[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text), `Credential-shaped content in ${file}`)
    assert.ok(!/[A-Z]:[\\/]+(?:Users[\\/]+|ECNUDev)|\/Users\/[^/\s]+\//i.test(text), `Machine path in ${file}`)
  }
  return { manifest, files: [...files.keys()] }
}
