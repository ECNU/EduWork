import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopAppPackage, installedUpdateFeed, installedUpdateYAML, portableMigrationConfiguration } from '../../dsh-electron/scripts/assemble-windows.mjs'

test('portable migration is opt-in and never changes the baseline config when disabled', () => {
  const baseline = { schemaVersion: 1, shell: 'electron', updateChannel: 'github' }
  for (const options of [
    { dataLayout: 'portable' },
    { dataLayout: 'portable', portableMigration: false },
    { dataLayout: 'portable', portableMigration: 'true' },
    { dataLayout: 'installed', portableMigration: true },
    { dataLayout: 'portable', portableMigration: true, sourceAlpha: true },
  ]) {
    assert.equal(JSON.stringify({ ...baseline, ...portableMigrationConfiguration(options) }), JSON.stringify(baseline))
  }
  assert.deepEqual(portableMigrationConfiguration({ dataLayout: 'portable', portableMigration: true }), { portableMigration: true })
})
import { installerInclude, installerProject, packWindowsInstaller, verifyElectronBuilderVersion, verifyInstalledCandidate } from '../pack-windows-installer.mjs'

const version = '0.4.13-dev.20261116.1'
const desktop = {
  schemaVersion: 1, shell: 'electron', appId: 'org.eduwork.eduwork.electron', distribution: 'eduwork',
  productName: 'EduWork', productVersion: version, dataLayout: 'installed',
}
const release = { schemaVersion: 1, shell: 'electron', version, distribution: 'eduwork', productName: 'EduWork' }
const receipt = { kind: 'eduwork-windows-installed-candidate', version, distribution: 'eduwork', coreCommit: 'a'.repeat(40), checks: { installedAssembly: 'passed' } }
const valid = { desktop, release, receipt, appPackage: { version }, executableExists: true }

test('electron-builder must match the resolved version in the DSH desktop importer', () => {
  const upstreamLock = `
importers:
  apps/desktop:
    devDependencies:
      electron-builder:
        specifier: ^26.17.0
        version: 26.18.0(electron-builder-squirrel-windows@26.18.0)(supports-color@9.4.0)
  apps/other:
    devDependencies:
      electron-builder:
        specifier: ^26.17.0
        version: 26.17.0
`
  assert.doesNotThrow(() => verifyElectronBuilderVersion(upstreamLock, '26.18.0'))
  assert.throws(() => verifyElectronBuilderVersion(upstreamLock, '26.17.0'), /EduWork.*26\.17\.0.*DSH.*26\.18\.0/)
  assert.throws(() => verifyElectronBuilderVersion(upstreamLock.replace('apps/desktop', 'apps/web'), '26.17.0'), /apps\/desktop.*missing/)
  assert.throws(() => verifyElectronBuilderVersion(upstreamLock.replace(/26\.18\.0\(.*\)/, '26.18.0('), '26.18.0'), /apps\/desktop.*invalid/)
  assert.throws(() => verifyElectronBuilderVersion(upstreamLock.replace(/26\.18\.0\(.*\)/, '26.17.0(supports-color@)'), '26.17.0'), /apps\/desktop.*invalid/)
})

test('installed update metadata uses the same GitHub repository as the installer', () => {
  const updates = { provider: 'github', repository: 'ecnu/EduWork' }
  assert.deepEqual(installedUpdateFeed(updates), { provider: 'github', owner: 'ecnu', repo: 'EduWork' })
  assert.equal(installedUpdateFeed({ provider: 'static', manifestURL: 'https://example.test/update.json' }), null)
  assert.throws(() => installedUpdateFeed({ provider: 'github', repository: 'bad/repo\npublisherName: override' }), /owner\/repo/)
  const project = installerProject({ desktop: { ...desktop, updates }, release, electronVersion: '44.0.0' })
  const { config } = project
  assert.deepEqual(config.publish, { ...installedUpdateFeed(updates), channel: 'dev' })
  assert.equal(project.packageJSON.name, 'eduwork-installer-eduwork')
  assert.equal(installedUpdateYAML(installedUpdateFeed(updates), desktop.distribution),
    'provider: github\nowner: "ecnu"\nrepo: "EduWork"\nupdaterCacheDirName: "eduwork-installer-eduwork-updater"\n')
  const stable = installerProject({ desktop: { ...desktop, updates }, release: { ...release, version: '0.4.13' }, electronVersion: '44.0.0' })
  assert.equal(stable.config.publish.channel, 'latest')
  assert.equal(config.nsis.differentialPackage, true)
})

test('installed HTTPS acceptance source matches app-update.yml and installer publish metadata', () => {
  assert.equal(installedUpdateFeed(undefined), null)
  const updates = { provider: 'generic', url: 'https://localhost:18443' }
  const feed = installedUpdateFeed(updates)
  assert.deepEqual(feed, { provider: 'generic', url: 'https://localhost:18443' })
  assert.equal(installedUpdateYAML(feed, desktop.distribution), 'provider: generic\nurl: "https://localhost:18443"\nupdaterCacheDirName: "eduwork-installer-eduwork-updater"\n')
  const { config } = installerProject({ desktop: { ...desktop, updates }, release, electronVersion: '44.0.0' })
  assert.deepEqual(config.publish, { ...feed, channel: 'dev' })
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

test('NSIS include checks the installer cache path per distribution', () => {
  assert.ok(installerInclude({ distribution: 'test-edition' }).includes([
    '!if "${APP_INSTALLER_STORE_FILE}" S!= "eduwork-installer-test-edition-updater\\installer.exe"',
    '  !error "NSIS installer cache path differs from the EduWork updater cache path"',
    '!endif',
  ].join('\n')))
})

test('NSIS finish page relaunches a forced update but leaves manual installation unchanged', () => {
  const include = installerInclude(desktop)
  const finishPage = include.match(/!macro customFinishPage\n([\s\S]*?)\n!macroend/)?.[1] ?? ''
  assert.match(finishPage, /\$\{if\} \$\{isUpdated\}\s+\$\{andIf\} \$\{isForceRun\}\s+HideWindow\s+Exec '"\$appExe" --updated'\s+Abort\s+\$\{endif\}/)
  assert.match(finishPage, /!define MUI_PAGE_CUSTOMFUNCTION_PRE (\w+)\n\s+!insertmacro MUI_PAGE_FINISH/)
  const [, callback] = finishPage.match(/!define MUI_PAGE_CUSTOMFUNCTION_PRE (\w+)/)
  assert.ok(finishPage.includes(`Function ${callback}\n`))
  assert.doesNotMatch(finishPage, /MUI_FINISHPAGE_RUN/)
})

test('NSIS migration guard only checks and aborts while ordinary operations use the stock guard', () => {
  const guard = installerInclude(desktop).match(/!macro customCheckAppRunning\n([\s\S]*?)\n!macroend/)?.[1] ?? ''
  const [migration, ordinary] = guard.split('${else}')
  assert.match(migration, /\$\{GetOptions\} .* "--eduwork-portable-migration"/)
  assert.match(migration, /FIND_PROCESS.*\n.*\$R0 == 0\n\s*MessageBox.*\n\s*Quit/)
  assert.doesNotMatch(migration, /KILL_PROCESS|Stop-Process|taskkill|_CHECK_APP_RUNNING/)
  assert.match(ordinary, /!insertmacro _CHECK_APP_RUNNING/)
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
  assert.equal(project.config.nsis.runAfterFinish, false)
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

test('installer packaging reads the version-specific channel artifact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eduwork-installer-channel-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  t.after(() => delete process.env.INSTALLER_METADATA)
  const candidate = join(root, 'candidate'), resources = join(candidate, 'resources'), app = join(resources, 'app')
  await mkdir(app, { recursive: true })
  await writeFile(join(candidate, 'EduWork-Electron.exe'), 'candidate')
  await writeFile(join(candidate, 'version'), '44.0.0\n')
  const icon = join(root, 'icon.ico'), installedReceipt = join(root, 'installed-receipt.json')
  const electronBuilderCli = join(root, 'mock-electron-builder.mjs')
  await writeFile(icon, 'icon')
  await writeFile(electronBuilderCli, `
    import { mkdir, readFile, writeFile } from 'node:fs/promises'
    import { join } from 'node:path'
    const args=process.argv.slice(2), staging=args[args.indexOf('--projectDir')+1]
    const config=JSON.parse(await readFile(args[args.indexOf('--config')+1],'utf8'))
    const pkg=JSON.parse(await readFile(join(staging,'package.json'),'utf8'))
    const artifacts=config.directories.output
    await mkdir(artifacts,{recursive:true})
    const installer=\`${'${pkg.productName}'}-Setup-\${pkg.version}-x64.exe\`
    await writeFile(join(artifacts,installer),'installer')
    const metadata=JSON.parse(process.env.INSTALLER_METADATA)
    const info=[
      'version: '+metadata.version, 'files:',
      '  - url: '+metadata.files[0].url, '    sha512: '+metadata.files[0].sha512,
      '    size: '+metadata.files[0].size, 'path: '+metadata.path,
      'sha512: '+metadata.sha512, "releaseDate: '2026-11-20T00:00:00.000Z'",
    ].join('\\n')+'\\n'
    await writeFile(join(artifacts,\`${'${config.publish.channel}'}\`.concat('.yml')),info)
    await writeFile(join(artifacts,installer+'.blockmap'),'blockmap')
  `)

  for (const [releaseVersion, channel] of [['0.4.13-dev.20261116.1', 'dev'], ['0.4.13', 'latest']]) {
    const updates = { provider: 'github', repository: 'ecnu/EduWork' }
    const candidateRelease = { ...release, version: releaseVersion }
    await writeFile(installedReceipt, JSON.stringify({ ...receipt, version: releaseVersion }))
    await writeFile(join(resources, 'app-update.yml'), installedUpdateYAML(installedUpdateFeed(updates), desktop.distribution))
    await writeFile(join(resources, 'app/eduwork.desktop.json'), JSON.stringify({ ...desktop, updates,
      productVersion: releaseVersion, dataLayout: 'installed' }))
    await writeFile(join(resources, 'app/package.json'), JSON.stringify({ version: releaseVersion }))
    await writeFile(join(candidate, 'release.json'), JSON.stringify(candidateRelease))
    const output = join(root, channel)
    const installerName = `EduWork-Setup-${releaseVersion}-x64.exe`
    const installerSHA512 = createHash('sha512').update('installer').digest('base64')
    process.env.INSTALLER_METADATA = JSON.stringify({ version: releaseVersion, files: [{ url: installerName, sha512: installerSHA512, size: 9 }], path: installerName, sha512: installerSHA512, releaseDate: '2026-11-20T00:00:00.000Z' })
    const result = await packWindowsInstaller({ candidate, output, installedReceipt, electronBuilderCli, icon })
    assert.deepEqual(result.updateArtifacts.map(item => item.file), [
      `${channel}.yml`, `EduWork-Setup-${releaseVersion}-x64.exe.blockmap`,
    ])
    for (const artifact of result.updateArtifacts) assert.ok((await readFile(join(output, 'artifacts', artifact.file))).length > 0)
  }
  const invalidInstaller = 'EduWork-Setup-0.4.13-x64.exe'
  const invalidSHA512 = createHash('sha512').update('installer').digest('base64')
  const metadata = { version: '0.4.13', files: [{ url: invalidInstaller, sha512: invalidSHA512, size: 9 }], path: invalidInstaller, sha512: invalidSHA512 }
  for (const [kind, invalid, message] of [
    ['version', { ...metadata, version: '0.4.12' }, /differs from/],
    ['sha512', { ...metadata, sha512: 'wrong' }, /differs from/],
    ['size', { ...metadata, files: [{ ...metadata.files[0], size: 10 }] }, /does not identify/],
  ]) {
    process.env.INSTALLER_METADATA = JSON.stringify(invalid)
    await assert.rejects(packWindowsInstaller({ candidate, output: join(root, `invalid-${kind}`), installedReceipt, electronBuilderCli, icon }), message)
  }
})
