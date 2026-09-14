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
  assert.equal(manifest.repository.url, 'git+https://github.com/ecnu/EduWork.git')
  assert.equal(manifest.repository.directory, selected.directory)
  for (const entry of Object.values(manifest.exports || {})) {
    assert.equal(typeof entry, 'string', 'Review new conditional exports before publishing')
    assert.ok(files.has(entry.replace(/^\.\//, '')), `Missing packed export ${entry}`)
  }
  for (const [file, content] of files) {
    assert.ok(!/(^|\/)(node_modules|\.git|\.local|dist|test|tests)(\/|$)|\.(tgz|log|map)$/.test(file), `Unexpected packed file ${file}`)
    if (!/\.(js|mjs|json|md|yml|yaml|py|ps1|txt)$/.test(file)) continue
    const text = content.toString('utf8')
    assert.ok(!/(?:ghp_|github_pat_|npm_)[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text), `Credential-shaped content in ${file}`)
    assert.ok(!/[A-Z]:[\\/]+(?:Users[\\/]+|ECNUDev)|\/Users\/[^/\s]+\//i.test(text), `Machine path in ${file}`)
  }
  return { manifest, files: [...files.keys()] }
}
