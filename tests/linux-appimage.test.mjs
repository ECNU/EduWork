import test from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopBuildTargets } from '../scripts/desktop-build-targets.mjs'
import { desktopPaths } from '../dsh-electron/src/desktop-paths.mjs'
import { packageLinuxAppImage } from '../scripts/package-linux-appimage.mjs'

test('Linux is an artifact-only desktop target', () => {
  assert.deepEqual(desktopBuildTargets('linux'), [{ platform: 'linux', script: 'linux', runner: 'ubuntu-24.04' }])
  assert.throws(() => desktopBuildTargets('linux', 'ps1'), /Node build recipe/)
})

test('Linux desktop data is outside a read-only AppImage', () => {
  const paths = desktopPaths({ appRoot: '/opt/EduWork/usr/lib/eduwork/resources/app', appData: '/tmp/eduwork-user-config',
    settings: { distribution: 'eduwork', sourceAlpha: false, productVersion: '0.4.13', configurationOwnership: 'user', product: '../product', node: '../runtime/node' }, platform: 'linux' })
  assert.equal(paths.home, '/tmp/eduwork-user-config/eduwork-electron/dsh')
  assert.equal(paths.userData, '/tmp/eduwork-user-config/eduwork-electron/browser')
})

test('AppImage packaging invokes the pinned tool and writes a checksum', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-appimage-test-')); t.after(() => rm(root, { recursive: true, force: true }))
  const candidate = join(root, 'candidate'); await mkdir(join(candidate, 'resources/app'), { recursive: true }); await mkdir(join(candidate, 'resources/brand'), { recursive: true })
  await writeFile(join(candidate, 'eduwork.bin'), 'binary'); await writeFile(join(candidate, 'eduwork'), '#!/bin/sh\n')
  await writeFile(join(candidate, 'resources/app/eduwork.desktop.json'), '{}'); await writeFile(join(candidate, 'resources/brand/icon-256.png'), 'png')
  await writeFile(join(candidate, 'release.json'), JSON.stringify({ version: '0.4.13-dev.20261117.1', productName: 'EduWork' }))
  const tool = join(root, 'fake-appimagetool.mjs'), runtime = join(root, 'runtime-x86_64')
  await writeFile(tool, `#!/usr/bin/env node\nimport { writeFile } from 'node:fs/promises'; await writeFile(process.argv.at(-1), 'appimage')`); await chmod(tool, 0o755)
  await writeFile(runtime, 'runtime')
  const result = await packageLinuxAppImage({ candidate, output: join(root, 'EduWork.AppImage'), appimagetool: tool, appimageRuntime: runtime })
  assert.equal(result.bytes, 8)
})
