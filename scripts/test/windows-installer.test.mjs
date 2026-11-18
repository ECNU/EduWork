import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopAppPackage, installedUpdateFeed, installedUpdateYAML } from '../../dsh-electron/scripts/assemble-windows.mjs'
import { installerInclude, installerProject, packWindowsInstaller, verifyInstalledCandidate } from '../pack-windows-installer.mjs'

const version = '0.4.13-dev.20261116.1'
const desktop = {
  schemaVersion: 1, shell: 'electron', appId: 'org.eduwork.eduwork.electron', distribution: 'eduwork',
  productName: 'EduWork', productVersion: version, dataLayout: 'installed',
}
const release = { schemaVersion: 1, shell: 'electron', version, distribution: 'eduwork', productName: 'EduWork' }
const receipt = { kind: 'eduwork-windows-installed-candidate', version, distribution: 'eduwork', coreCommit: 'a'.repeat(40), checks: { installedAssembly: 'passed' } }
const valid = { desktop, release, receipt, appPackage: { version }, executableExists: true }

test('installed update metadata uses the same GitHub repository as the installer', () => {
  const updates = { provider: 'github', repository: 'ecnu/EduWork' }
  assert.deepEqual(installedUpdateFeed(updates), { provider: 'github', owner: 'ecnu', repo: 'EduWork' })
  assert.equal(installedUpdateFeed({ provider: 'static', manifestURL: 'https://example.test/update.json' }), null)
  assert.throws(() => installedUpdateFeed({ provider: 'github', repository: 'bad/repo\npublisherName: override' }), /owner\/repo/)
  const { config } = installerProject({ desktop: { ...desktop, updates }, release, electronVersion: '44.0.0' })
  assert.deepEqual(config.publish, installedUpdateFeed(updates))
  assert.equal(config.nsis.differentialPackage, true)
})

test('installed HTTPS acceptance source matches app-update.yml and installer publish metadata', () => {
  assert.equal(installedUpdateFeed(undefined), null)
  assert.equal(installedUpdateYAML(installedUpdateFeed({ provider: 'github', repository: 'ecnu/EduWork' })),
    'provider: github\nowner: "ecnu"\nrepo: "EduWork"\n')
  const updates = { provider: 'generic', url: 'https://localhost:18443' }
  const feed = installedUpdateFeed(updates)
  assert.deepEqual(feed, { provider: 'generic', url: 'https://localhost:18443' })
  assert.equal(installedUpdateYAML(feed), 'provider: generic\nurl: "https://localhost:18443"\n')
  const { config } = installerProject({ desktop: { ...desktop, updates }, release, electronVersion: '44.0.0' })
  assert.deepEqual(config.publish, feed)
  assert.equal(config.nsis.differentialPackage, true)
  for (const url of ['http://localhost:18443', 'https://user:secret@example.test']) {
    assert.throws(() => installedUpdateFeed({ provider: 'generic', url }), /HTTPS/)
  }
})

test('installed app manifest carries the product version and keeps the DSH version', () => {
  const installed = desktopAppPackage({ identity: { dshVersion: '0.2.2-rc.1' }, version, dataLayout: 'installed' })
  assert.equal(installed.version, version)
  assert.equal(installed.dshVersion, '0.2.2-rc.1')
  const portable = desktopAppPackage({ identity: { dshVersion: '0.2.2-rc.1' }, version, dataLayout: 'portable' })
  assert.equal(portable.version, '0.2.2-rc.1')
  assert.equal(portable.dshVersion, undefined)
})

test('installer candidate verification accepts the installed identity', () => {
  assert.doesNotThrow(() => verifyInstalledCandidate(valid))
})

test('installer candidate verification rejects a portable build', () => {
  assert.throws(() => verifyInstalledCandidate({ ...valid, desktop: { ...desktop, dataLayout: 'portable' } }), /installed-layout/)
})

test('installer candidate verification rejects the DSH component version in the app manifest', () => {
  assert.throws(() => verifyInstalledCandidate({ ...valid, appPackage: { version: '0.2.2-rc.1' } }), /product version/)
})

test('installer candidate verification rejects a mismatched receipt', () => {
  assert.throws(() => verifyInstalledCandidate({ ...valid, receipt: undefined }), /receipt is required/)
  assert.throws(() => verifyInstalledCandidate({ ...valid, receipt: { ...receipt, version: '0.4.12' } }), /does not match/)
  assert.throws(() => verifyInstalledCandidate({ ...valid, receipt: { ...receipt, coreCommit: undefined } }), /source commit/)
  assert.throws(() => verifyInstalledCandidate({ ...valid, receipt: { ...receipt, checks: { installedAssembly: 'not-run' } } }), /not passed/)
})

test('installer candidate verification rejects Source Alpha and mismatched identities', () => {
  assert.throws(() => verifyInstalledCandidate({ ...valid, desktop: { ...desktop, sourceAlpha: true } }), /Source Alpha/)
  assert.throws(() => verifyInstalledCandidate({ ...valid, desktop: { ...desktop, appId: 'org.eduwork.other.electron' } }), /does not match the distribution/)
  assert.throws(() => verifyInstalledCandidate({ ...valid, desktop: { ...desktop, distribution: '../escape' }, release: { ...release, distribution: '../escape' } }), /Distribution identifier/)
})

test('NSIS include pins the per-user program directory per distribution', () => {
  assert.throws(() => installerInclude({ distribution: '../escape' }), /Distribution identifier/)
  const include = installerInclude(desktop)
  assert.match(include, /!macro customInit/)
  assert.match(include, /StrCpy \$INSTDIR "\$LOCALAPPDATA\\Programs\\EduWork\\eduwork"/)
  assert.match(include, /!macro customInstallMode/)
  assert.match(include, /StrCpy \$installMode CurrentUser/)
  assert.match(include, /StrCpy \$INSTDIR "\$LOCALAPPDATA\\Programs\\EduWork\\eduwork"/)
  assert.match(include, /!macro customInstall/)
  assert.match(include, /WriteRegStr SHELL_CONTEXT "\$\{UNINSTALL_REGISTRY_KEY\}" InstallLocation "\$INSTDIR"/)
})

test('installer project fixes per-user, no-elevation and data-preserving behavior', () => {
  const project = installerProject({ desktop, release, electronVersion: '44.0.0', artifactsDir: 'C:/out/artifacts', icon: 'C:/icon.ico', includePath: 'C:/out/installer.nsh' })
  assert.equal(project.packageJSON.version, version)
  assert.equal(project.packageJSON.productName, 'EduWork')
  assert.equal(project.config.appId, desktop.appId)
  assert.equal(project.config.executableName, 'EduWork-Electron')
  assert.equal(project.config.electronVersion, '44.0.0')
  assert.deepEqual(project.config.win.target, ['nsis'])
  assert.equal(project.config.win.icon, 'C:/icon.ico')
  assert.equal(project.config.nsis.oneClick, false)
  assert.equal(project.config.nsis.perMachine, false)
  assert.equal(project.config.nsis.allowElevation, false)
  assert.equal(project.config.nsis.allowToChangeInstallationDirectory, false)
  assert.equal(project.config.nsis.createDesktopShortcut, false)
  assert.equal(project.config.nsis.createStartMenuShortcut, true)
  assert.equal(project.config.nsis.uninstallDisplayName, 'EduWork')
  assert.equal(project.config.nsis.deleteAppDataOnUninstall, false)
  assert.equal(project.config.nsis.differentialPackage, false)
  assert.equal(project.config.nsis.include, 'C:/out/installer.nsh')
  assert.equal(project.config.nsis.artifactName, 'EduWork-Setup-0.4.13-dev.20261116.1-${arch}.${ext}')
  assert.equal(project.config.publish, null)
  assert.equal(project.config.directories.output, 'C:/out/artifacts')
})

test('installer packaging requires a receipt and never reuses an output directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-installer-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(packWindowsInstaller({ candidate: root, output: join(root, 'out'), installedReceipt: '', electronBuilderCli: 'x', icon: 'x' }), /receipt is required/)
  await assert.rejects(packWindowsInstaller({ candidate: root, output: root, installedReceipt: 'receipt.json', electronBuilderCli: 'x', icon: 'x' }), /must be a new directory/)
})
