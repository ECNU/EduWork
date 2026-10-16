import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { createMacOSAppArchive, verifyMacOSAppArchive } from '../scripts/create-macos-archive.mjs'
import { ZipWriter } from '../../scripts/lib/zip.mjs'

const run = promisify(execFile)

for (const [label, extra] of [
  ['valid app entries', null],
  ['AppleDouble directory', '__MACOSX/Synthetic.app/Contents/._Info.plist'],
  ['AppleDouble file', 'Synthetic.app/Contents/Resources/._data.txt'],
  ['another top-level directory', 'Other.app/Contents/Info.plist'],
]) test(`archive verification checks ${label}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-archive-policy-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const archive = join(root, 'synthetic.zip'), writer = await ZipWriter.create(archive)
  for (const name of ['Synthetic.app/', 'Synthetic.app/Contents/Info.plist', 'Synthetic.app/Contents/MacOS/main']) {
    await writer.addEntry(name, Buffer.from('synthetic'))
  }
  if (extra) await writer.addEntry(extra, Buffer.from('metadata'))
  await writer.close()
  if (extra) await assert.rejects(verifyMacOSAppArchive(archive, 'Synthetic.app'), error => error.message.includes(extra))
  else await verifyMacOSAppArchive(archive, 'Synthetic.app')
})

test('signed app ZIP excludes AppleDouble and preserves executable, symlink and signature', { skip: process.platform !== 'darwin' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-archive-'))
  try {
    const app = join(root, 'Synthetic 中文 App.app'), contents = join(app, 'Contents')
    await mkdir(join(contents, 'MacOS'), { recursive: true })
    await mkdir(join(contents, 'Resources'))
    const source = join(root, 'main.c'), executable = join(contents, 'MacOS', 'ArchiveTest')
    await writeFile(source, '#include <stdio.h>\nint main(void) { puts("SYNTHETIC_ARCHIVE_OK"); return 0; }\n')
    await run('clang', [source, '-o', executable])
    await writeFile(join(contents, 'Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>ArchiveTest</string><key>CFBundleIdentifier</key><string>org.eduwork.synthetic.archive</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>')
    const data = Buffer.from('Synthetic archive contents\n')
    await writeFile(join(contents, 'Resources', 'data.txt'), data)
    await symlink('data.txt', join(contents, 'Resources', 'current'))
    await run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app])
    // Harmless metadata reproduces the duplicate metadata .app in old ZIPs.
    await run('xattr', ['-w', 'com.eduwork.synthetic', 'archive regression', join(contents, 'Resources', 'data.txt')])
    await run('codesign', ['--verify', '--deep', '--strict', app])
    const oldZip = join(root, 'metadata.zip')
    await run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, oldZip])
    assert.match((await run('unzip', ['-Z1', oldZip])).stdout, /^__MACOSX\/[^/]+\.app\//m)
    await assert.rejects(verifyMacOSAppArchive(oldZip, 'Synthetic 中文 App.app'), /__MACOSX/)

    const archive = join(root, 'update.zip'), extracted = join(root, 'extracted')
    await createMacOSAppArchive(app, archive)
    await verifyMacOSAppArchive(archive, 'Synthetic 中文 App.app')
    const entries = (await run('unzip', ['-Z1', archive])).stdout.trim().split('\n')
    // System unzip can display Unicode names in a legacy encoding. Verify the
    // one bundle root here, and its exact Unicode name after ditto extraction.
    const bundleName = entries[0].split('/')[0]
    assert.ok(bundleName.endsWith('.app'))
    assert.ok(entries.every(path => path.startsWith(bundleName + '/')))
    assert.ok(entries.every(path => !path.split('/').some(part => part === '__MACOSX' || part.startsWith('._'))))
    await mkdir(extracted)
    await run('ditto', ['-x', '-k', archive, extracted])
    const replacement = join(extracted, 'Synthetic 中文 App.app'), resources = join(replacement, 'Contents', 'Resources')
    assert.deepEqual(await readFile(join(resources, 'data.txt')), data)
    assert.equal(await readlink(join(resources, 'current')), 'data.txt')
    const replacementExecutable = join(replacement, 'Contents', 'MacOS', 'ArchiveTest')
    assert.equal((await stat(replacementExecutable)).mode & 0o777, (await stat(executable)).mode & 0o777)
    assert.equal((await run(replacementExecutable, [])).stdout.trim(), 'SYNTHETIC_ARCHIVE_OK')
    for (const path of [replacement, join(resources, 'data.txt')]) {
      assert.doesNotMatch((await run('xattr', [path])).stdout, /^(?:com\.eduwork\.synthetic|com\.apple\.(?:FinderInfo|ResourceFork))$/m)
    }
    await run('codesign', ['--verify', '--deep', '--strict', replacement])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
