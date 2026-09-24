// Run on macOS: node --test dsh-electron/tests/dock-plugin.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

test('native Dock plugin retains the saved color after application exit', { skip: process.platform !== 'darwin' }, () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const temporary = mkdtempSync(join(tmpdir(), 'eduwork-dock-plugin-'))
  const distribution = 'eduwork-dock-test-' + randomUUID()
  const dataRoot = join(homedir(), 'Library/Application Support', distribution + '-electron')
  try {
    const app = join(temporary, 'Theme.app'), contents = join(app, 'Contents'), resources = join(contents, 'Resources')
    for (const folder of [join(resources, 'app'), join(resources, 'brand'), join(dataRoot, 'browser')]) mkdirSync(folder, { recursive: true })
    const appId = 'org.eduwork.' + distribution
    const plist = join(contents, 'Info.plist')
    writeFileSync(plist, JSON.stringify({ CFBundleIdentifier: appId, CFBundlePackageType: 'APPL' }))
    execFileSync('plutil', ['-convert', 'xml1', plist])
    writeFileSync(join(resources, 'app/eduwork.desktop.json'), JSON.stringify({ appId, distribution }))
    for (const file of ['dock-red-1024.png', 'dock-blue-1024.png']) copyFileSync(join(root, 'assets/eduwork', file), join(resources, 'brand', file))
    execFileSync(process.execPath, [join(root, 'dsh-electron/scripts/build-dock-plugin.mjs'), app], { stdio: 'inherit' })
    assert.equal(execFileSync('plutil', ['-extract', 'NSDockTilePlugIn', 'raw', plist], { encoding: 'utf8' }).trim(), 'EduWorkDockTilePlugin.docktileplugin')
    const binary = join(contents, 'PlugIns/EduWorkDockTilePlugin.docktileplugin/Contents/MacOS/EduWorkDockTilePlugin')
    const plugin = join(contents, 'PlugIns/EduWorkDockTilePlugin.docktileplugin')
    execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', plugin], { stdio: 'inherit' })
    execFileSync('codesign', ['--verify', '--deep', '--strict', plugin], { stdio: 'inherit' })
    const original = readFileSync(binary)
    const executable = join(temporary, 'test-plugin')
    execFileSync('xcrun', ['clang', '-fobjc-arc', '-framework', 'AppKit', join(root, 'dsh-electron/tests/dock-plugin-native.m'), '-o', executable], { stdio: 'inherit' })
    execFileSync(executable, [app, join(dataRoot, 'browser/visual-style.json')], { stdio: 'inherit' })
    assert.deepEqual(readFileSync(binary), original)
    execFileSync('codesign', ['--verify', '--deep', '--strict', plugin], { stdio: 'inherit' })
  } finally {
    rmSync(temporary, { recursive: true, force: true })
    rmSync(dataRoot, { recursive: true, force: true })
  }
})
