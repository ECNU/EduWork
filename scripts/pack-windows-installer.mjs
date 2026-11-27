// Build the first per-user Windows installer from an assembled installed-layout
// candidate. electron-builder runs in --prepackaged mode: the candidate tree is
// already complete, so this step only wraps it in NSIS and must not repack or
// rename anything inside it.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { installedUpdateCacheDirName, installedUpdateFeed, installedUpdateYAML, installerPackageName } from '../dsh-electron/scripts/assemble-windows.mjs'
import { capture, ensureDir, fullPath, isFile, isMainModule, pathExists, readJSON, runNode, writeJSON } from './lib/build-util.mjs'

const EXECUTABLE = 'EduWork-Electron.exe'
const BUILDER_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'electron-builder')
const requireBuilder = createRequire(join(BUILDER_ROOT, 'package.json'))
const DNS_NAMESPACE = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex')

function requireMatch(condition, message) {
  if (!condition) throw new Error(message)
}

export function verifyElectronBuilderVersion(upstreamLock, localVersion) {
  const lock = requireBuilder('js-yaml').load(upstreamLock)
  const resolved = lock?.importers?.['apps/desktop']?.devDependencies?.['electron-builder']?.version
  requireMatch(typeof resolved === 'string' && resolved, 'DSH apps/desktop resolved electron-builder version is missing from pnpm-lock.yaml')
  const upstreamVersion = resolved.match(/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\((?:@[^@/()\s]+\/)?[^@/()\s]+@[^()\s]+\))*$/)?.[1]
  requireMatch(upstreamVersion, 'DSH apps/desktop resolved electron-builder version is invalid in pnpm-lock.yaml')
  requireMatch(localVersion === upstreamVersion, `electron-builder version mismatch: EduWork locks ${localVersion}, DSH locks ${upstreamVersion}`)
}

export function installedToastActivatorClsid(appId) {
  requireMatch(/^org\.eduwork\.[a-z0-9][a-z0-9-]*\.electron$/.test(appId ?? ''), 'Installed Toast app ID is invalid')
  const bytes = createHash('sha1').update(DNS_NAMESPACE).update(appId, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = bytes.toString('hex').toUpperCase()
  return `{${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}}`
}

export async function verifyElectronBuilderLock(upstream, electronBuilderCli) {
  const coreRoot = join(BUILDER_ROOT, '../..')
  const { sourceLock } = await readJSON(join(coreRoot, 'config/desktop-build.json'))
  const { commit } = await readJSON(join(coreRoot, sourceLock))
  const lock = await capture('git', ['-C', fullPath(upstream), 'show', `${commit}:pnpm-lock.yaml`])
  const { dependencies } = await readJSON(join(BUILDER_ROOT, 'package.json'))
  const expected = dependencies['electron-builder']
  verifyElectronBuilderVersion(lock, expected)
  const installed = (await runNode(electronBuilderCli, ['--version'], { capture: true })).stdout
  requireMatch(installed === expected, `electron-builder version differs from its lockfile: installed ${installed}, EduWork locks ${expected}`)
}

export function verifyInstalledCandidate({ desktop, release, receipt, appPackage, executableExists }) {
  requireMatch(desktop?.schemaVersion === 1 && desktop.shell === 'electron', 'Desktop identity is missing or unsupported')
  requireMatch(desktop.dataLayout === 'installed', 'Installer packaging requires an installed-layout candidate')
  requireMatch(release?.schemaVersion === 1 && release.shell === 'electron', 'Release identity is missing or unsupported')
  requireMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version ?? ''), 'Release version is invalid')
  requireMatch(desktop.productVersion === release.version, 'Product version differs between desktop identity and release')
  requireMatch(desktop.distribution === release.distribution, 'Distribution differs between desktop identity and release')
  requireMatch(desktop.productName === release.productName, 'Product name differs between desktop identity and release')
  requireMatch(/^[a-z0-9][a-z0-9-]*$/.test(desktop.distribution ?? ''), 'Distribution identifier is invalid')
  requireMatch(desktop.appId === `org.eduwork.${desktop.distribution}.electron`, 'Application identity does not match the distribution')
  requireMatch(desktop.sourceAlpha !== true, 'Source Alpha installers are not supported')
  requireMatch(executableExists, `Installed candidate is missing ${EXECUTABLE}`)
  requireMatch(appPackage?.version === release.version, 'Installed app manifest must carry the product version, not the DSH component version')
  requireMatch(receipt !== undefined, 'Installed-candidate receipt is required')
  requireMatch(receipt.kind === 'eduwork-windows-installed-candidate', 'Installed-candidate receipt kind is invalid')
  requireMatch(receipt.version === release.version && receipt.distribution === desktop.distribution, 'Installed-candidate receipt does not match the candidate')
  requireMatch(/^[a-f0-9]{40}$/.test(receipt.coreCommit ?? ''), 'Installed-candidate receipt has no source commit')
  requireMatch(receipt.checks?.installedAssembly === 'passed', 'Installed assembly has not passed')
}

export function installerInclude(desktop) {
  requireMatch(/^[a-z0-9][a-z0-9-]*$/.test(desktop.distribution ?? ''), 'Distribution identifier is invalid')
  requireMatch(desktop.appId === `org.eduwork.${desktop.distribution}.electron`, 'Application identity does not match the distribution')
  const toastActivatorClsid = installedToastActivatorClsid(desktop.appId)
  return [
    `!if "\${APP_INSTALLER_STORE_FILE}" S!= "${installedUpdateCacheDirName(desktop.distribution)}\\installer.exe"`,
    '  !error "NSIS installer cache path differs from the EduWork updater cache path"',
    '!endif',
    '',
    '; EduWork per-user install directory. customInit runs after the default',
    '; per-user path is computed and before any page or extraction uses it.',
    '!macro customInit',
    `  StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\EduWork\\${desktop.distribution}"`,
    '!macroend',
    '',
    '; The stock install-mode page recomputes $INSTDIR for per-user installs,',
    '; which would discard the customInit value. Pin the mode and path here.',
    '!macro customInstallMode',
    '  StrCpy $installMode CurrentUser',
    '  SetShellVarContext current',
    `  StrCpy $INSTDIR "$LOCALAPPDATA\\Programs\\EduWork\\${desktop.distribution}"`,
    '  Abort',
    '!macroend',
    '',
    '; Inventory tools and the updater read the public uninstall entry.',
    '!macro customInstall',
    '  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" InstallLocation "$INSTDIR"',
    '  IfFileExists "$newStartMenuLink" 0 installedToastNoShortcut',
    '  System::Call \'ole32::CoInitializeEx(p 0, i 2) i.r0\'',
    '  ${if} $0 < 0',
    '    Abort "Unable to initialize Shell COM for the Start menu shortcut."',
    '  ${endif}',
    '  System::Call \'ole32::CoCreateInstance(g "{00021401-0000-0000-C000-000000000046}", p 0, i 1, g "{000214F9-0000-0000-C000-000000000046}", *p .r1) i.r0\'',
    '  ${if} $0 < 0',
    '    System::Call \'ole32::CoUninitialize()\'',
    '    Abort "Unable to load the Start menu shortcut."',
    '  ${endif}',
    '  System::Call \'$1->0(g "{0000010B-0000-0000-C000-000000000046}", *p .r2) i.r0\'',
    '  ${if} $0 < 0',
    '    System::Call \'$1->2()\'',
    '    System::Call \'ole32::CoUninitialize()\'',
    '    Abort "Unable to persist the Start menu shortcut."',
    '  ${endif}',
    '  System::Call \'$2->5(w "$newStartMenuLink", i 2) i.r0\'',
    '  ${if} $0 < 0',
    '    System::Call \'$2->2()\'',
    '    System::Call \'$1->2()\'',
    '    System::Call \'ole32::CoUninitialize()\'',
    '    Abort "Unable to open the Start menu shortcut."',
    '  ${endif}',
    '  System::Call \'$1->0(g "{886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99}", *p .r3) i.r0\'',
    '  ${if} $0 < 0',
    '    System::Call \'$2->2()\'',
    '    System::Call \'$1->2()\'',
    '    System::Call \'ole32::CoUninitialize()\'',
    '    Abort "Unable to update the Start menu shortcut."',
    '  ${endif}',
    '  ; Set PKEY_AppUserModel_ToastActivatorCLSID on the loaded link without recreating it.',
    '  StrCpy $4 0',
    '  StrCpy $5 0',
    '  StrCpy $6 0',
    '  System::Alloc 20',
    '  Pop $4',
    '  ${if} $4 == 0',
    '    Goto installedToastAllocationFailed',
    '  ${endif}',
    '  System::Call \'*$4(&g16 "{9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3}", i 26)\'',
    '  System::Alloc 16',
    '  Pop $5',
    '  ${if} $5 == 0',
    '    Goto installedToastAllocationFailed',
    '  ${endif}',
    `  System::Call '*$5(&g16 "${toastActivatorClsid}")'`,
    '  System::Alloc 24',
    '  Pop $6',
    '  ${if} $6 == 0',
    '    Goto installedToastAllocationFailed',
    '  ${endif}',
    '  System::Call \'*$6(&i2 72, &i2 0, &i2 0, &i2 0, p $5)\'',
    '  Goto installedToastAllocationReady',
    'installedToastAllocationFailed:',
    '  ${if} $6 != 0',
    '    System::Free $6',
    '  ${endif}',
    '  ${if} $5 != 0',
    '    System::Free $5',
    '  ${endif}',
    '  ${if} $4 != 0',
    '    System::Free $4',
    '  ${endif}',
    '  System::Call \'$3->2()\'',
    '  System::Call \'$2->2()\'',
    '  System::Call \'$1->2()\'',
    '  System::Call \'ole32::CoUninitialize()\'',
    '  Abort "Unable to allocate the Toast activation identity."',
    'installedToastAllocationReady:',
    '  System::Call \'$3->6(p $4, p $6) i.r0\'',
    '  ${if} $0 < 0',
    '    System::Call \'$3->2()\'',
    '    System::Call \'$2->2()\'',
    '    System::Call \'$1->2()\'',
    '    System::Free $6',
    '    System::Free $5',
    '    System::Free $4',
    '    System::Call \'ole32::CoUninitialize()\'',
    '    Abort "Unable to set the Toast activation identity."',
    '  ${endif}',
    '  System::Call \'$3->7() i.r0\'',
    '  ${if} $0 < 0',
    '    System::Call \'$3->2()\'',
    '    System::Call \'$2->2()\'',
    '    System::Call \'$1->2()\'',
    '    System::Free $6',
    '    System::Free $5',
    '    System::Free $4',
    '    System::Call \'ole32::CoUninitialize()\'',
    '    Abort "Unable to commit the Toast activation identity."',
    '  ${endif}',
    '  System::Call \'$2->6(w "$newStartMenuLink", i 1) i.r0\'',
    '  ${if} $0 < 0',
    '    System::Call \'$3->2()\'',
    '    System::Call \'$2->2()\'',
    '    System::Call \'$1->2()\'',
    '    System::Free $6',
    '    System::Free $5',
    '    System::Free $4',
    '    System::Call \'ole32::CoUninitialize()\'',
    '    Abort "Unable to save the Start menu shortcut."',
    '  ${endif}',
    '  System::Call \'$3->2()\'',
    '  System::Call \'$2->2()\'',
    '  System::Call \'$1->2()\'',
    '  System::Free $6',
    '  System::Free $5',
    '  System::Free $4',
    '  System::Call \'ole32::CoUninitialize()\'',
    '  Goto installedToastShortcutDone',
    'installedToastNoShortcut:',
    'installedToastShortcutDone:',
    '!macroend',
    '',
    '!macro customUnInstall',
    '  ${ifNot} ${isUpdated}',
    '  ${andIf} $installMode == "CurrentUser"',
    `    ReadRegStr $R0 HKCU "Software\\Classes\\CLSID\\${toastActivatorClsid}\\LocalServer32" ""`,
    '    ${if} $R0 == "$INSTDIR\\EduWork-Electron.exe"',
    `      DeleteRegKey HKCU "Software\\Classes\\CLSID\\${toastActivatorClsid}"`,
    '    ${endif}',
    '  ${endif}',
    '!macroend',
    '',
    '; Updated assisted installs must skip the finish page before relaunching.',
    '!macro customFinishPage',
    '  Function RelaunchAfterUpdate',
    '    ${if} ${isUpdated}',
    '    ${andIf} ${isForceRun}',
    '      HideWindow',
    `      Exec '"$appExe" --updated'`,
    '      Abort',
    '    ${endif}',
    '  FunctionEnd',
    '  !define MUI_PAGE_CUSTOMFUNCTION_PRE RelaunchAfterUpdate',
    '  !insertmacro MUI_PAGE_FINISH',
    '!macroend',
    '',
  ].join('\n')
}

export function installerProject({ desktop, release, electronVersion, artifactsDir, icon, includePath }) {
  requireMatch(/^\d+\.\d+\.\d+/.test(electronVersion ?? ''), 'Electron runtime version is invalid')
  const feed = installedUpdateFeed(desktop.updates)
  const channel = release.version.includes('-dev.') ? 'dev' : 'latest'
  const publish = feed?.provider === 'generic' ? { provider: 'generic', url: feed.url, channel } : feed ? { ...feed, channel } : null
  return {
    packageJSON: {
      name: installerPackageName(desktop.distribution),
      productName: desktop.productName,
      version: release.version,
      description: 'EduWork desktop application',
      author: { name: 'EduWork' },
      license: 'MulanPSL-2.0 AND MIT',
      private: true,
    },
    config: {
      appId: desktop.appId,
      productName: desktop.productName,
      executableName: EXECUTABLE.replace(/\.exe$/i, ''),
      electronVersion,
      copyright: `Copyright © ${new Date().getFullYear()} EduWork`,
      directories: { output: artifactsDir },
      win: { target: ['nsis'], icon },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowElevation: false,
        allowToChangeInstallationDirectory: false,
        createDesktopShortcut: false,
        createStartMenuShortcut: true,
        runAfterFinish: false,
        uninstallDisplayName: desktop.productName,
        deleteAppDataOnUninstall: false,
        differentialPackage: publish !== null,
        installerLanguages: ['zh_CN', 'en_US'],
        installerIcon: icon,
        uninstallerIcon: icon,
        include: includePath,
        artifactName: `${desktop.productName}-Setup-${release.version}-\${arch}.\${ext}`,
      },
      publish,
    },
  }
}

export async function packWindowsInstaller({ candidate, output, installedReceipt, electronBuilderCli, icon }) {
  requireMatch(typeof installedReceipt === 'string' && installedReceipt.length > 0, 'Installed-candidate receipt is required')
  candidate = fullPath(candidate)
  output = fullPath(output)
  icon = fullPath(icon)
  electronBuilderCli = fullPath(electronBuilderCli)
  requireMatch(!await pathExists(output), 'Installer output must be a new directory')
  const desktop = await readJSON(join(candidate, 'resources/app/eduwork.desktop.json'))
  const release = await readJSON(join(candidate, 'release.json'))
  const appPackage = await readJSON(join(candidate, 'resources/app/package.json'))
  const electronVersion = (await readFile(join(candidate, 'version'), 'utf8')).trim()
  const receipt = await readJSON(fullPath(installedReceipt))
  verifyInstalledCandidate({ desktop, release, receipt, appPackage, executableExists: await isFile(join(candidate, EXECUTABLE)) })
  requireMatch(await isFile(icon), 'Installer icon is missing')
  requireMatch(await isFile(electronBuilderCli), 'electron-builder CLI is missing')

  const staging = join(output, 'installer-project')
  const artifacts = join(output, 'artifacts')
  await ensureDir(staging)
  await ensureDir(artifacts)
  const includePath = join(staging, 'installer.nsh')
  await writeFile(includePath, installerInclude(desktop))
  const project = installerProject({ desktop, release, electronVersion, artifactsDir: artifacts, icon, includePath })
  const updateConfig = join(candidate, 'resources/app-update.yml')
  if (project.config.publish) {
    requireMatch(await readFile(updateConfig, 'utf8') === installedUpdateYAML(project.config.publish, desktop.distribution), 'Packaged update source differs from installer configuration')
  } else {
    requireMatch(!await pathExists(updateConfig), 'Installer without a publish source must not declare an update feed')
  }
  await writeJSON(join(staging, 'package.json'), project.packageJSON)
  const configPath = join(staging, 'electron-builder.json')
  await writeJSON(configPath, project.config)

  const args = ['--win', 'nsis', '--x64', '--prepackaged', candidate, '--projectDir', staging,
    '--config', configPath, '--publish', 'never']
  await runNode(electronBuilderCli, args, { cwd: staging, env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })

  const expected = `${desktop.productName}-Setup-${release.version}-x64.exe`
  const artifact = join(artifacts, expected)
  requireMatch(await isFile(artifact), `Installer artifact is missing: ${expected}`)
  const bytes = await readFile(artifact)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await writeFile(`${artifact}.sha256`, `${sha256} *${expected}\n`)
  const updateArtifacts = []
  if (project.config.publish) {
    const channelFile = `${project.config.publish.channel}.yml`
    const channelBytes = await readFile(join(artifacts, channelFile))
    const metadata = requireBuilder('js-yaml').load(channelBytes.toString('utf8'))
    const digest = createHash('sha512').update(bytes).digest('base64')
    requireMatch(metadata?.version === release.version && metadata.path === expected && metadata.sha512 === digest,
      'Installer update metadata differs from the packaged installer')
    requireMatch(Array.isArray(metadata.files) && metadata.files.length === 1
      && metadata.files[0]?.url === expected && metadata.files[0].sha512 === digest && metadata.files[0].size === bytes.length,
      'Installer channel file does not identify the packaged installer')
    for (const file of [channelFile, `${expected}.blockmap`]) {
      const contents = file === channelFile ? channelBytes : await readFile(join(artifacts, file))
      requireMatch(contents.length > 0, `Installer update artifact is empty: ${file}`)
      updateArtifacts.push({ file, bytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex') })
    }
  }
  const result = {
    schemaVersion: 1,
    kind: 'eduwork-windows-installer-candidate',
    version: release.version,
    coreCommit: receipt.coreCommit,
    distribution: desktop.distribution,
    appId: desktop.appId,
    productName: desktop.productName,
    executableName: EXECUTABLE,
    installDir: `%LOCALAPPDATA%\\Programs\\EduWork\\${desktop.distribution}`,
    dataDir: `%LOCALAPPDATA%\\EduWork\\${desktop.distribution}`,
    artifact: { file: expected, bytes: bytes.length, sha256 },
    updateArtifacts,
    publication: 'artifact-only',
    checks: { installedAssembly: 'passed', installerBuilt: 'passed', install: 'not-run', import: 'not-run', uninstall: 'not-run', reinstall: 'not-run' },
  }
  await writeJSON(join(output, 'installer-candidate-receipt.json'), result)
  console.log(`Windows installer assembled: ${artifact}`)
  return result
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string' }, output: { type: 'string' }, 'installed-receipt': { type: 'string' },
    'electron-builder-cli': { type: 'string' }, icon: { type: 'string' }, upstream: { type: 'string' },
  } })
  if (!values.candidate || !values.output || !values['installed-receipt'] || !values['electron-builder-cli'] || !values.icon || !values.upstream) {
    throw new Error('Use --candidate <installed candidate root> --installed-receipt <json> --output <new directory> --electron-builder-cli <cli.js> --icon <icon.ico> --upstream <pinned DSH checkout>')
  }
  await verifyElectronBuilderLock(values.upstream, values['electron-builder-cli'])
  await packWindowsInstaller({
    candidate: values.candidate,
    output: values.output,
    installedReceipt: values['installed-receipt'],
    electronBuilderCli: values['electron-builder-cli'],
    icon: values.icon,
  })
}
