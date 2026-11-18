// Build the first per-user Windows installer from an assembled installed-layout
// candidate. electron-builder runs in --prepackaged mode: the candidate tree is
// already complete, so this step only wraps it in NSIS and must not repack or
// rename anything inside it.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { installedUpdateFeed, installedUpdateYAML } from '../dsh-electron/scripts/assemble-windows.mjs'
import { ensureDir, fullPath, isFile, isMainModule, pathExists, readJSON, runNode, writeJSON } from './lib/build-util.mjs'

const EXECUTABLE = 'EduWork-Electron.exe'

function requireMatch(condition, message) {
  if (!condition) throw new Error(message)
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
  return [
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
    '!macroend',
    '',
  ].join('\n')
}

export function installerProject({ desktop, release, electronVersion, artifactsDir, icon, includePath }) {
  requireMatch(/^\d+\.\d+\.\d+/.test(electronVersion ?? ''), 'Electron runtime version is invalid')
  const publish = installedUpdateFeed(desktop.updates)
  return {
    packageJSON: {
      name: `eduwork-installer-${desktop.distribution}`,
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
    requireMatch(await readFile(updateConfig, 'utf8') === installedUpdateYAML(project.config.publish), 'Packaged update source differs from installer configuration')
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
    const channel = release.version.includes('-dev.') ? 'dev' : 'latest'
    for (const file of [`${channel}.yml`, `${expected}.blockmap`]) {
      const contents = await readFile(join(artifacts, file))
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
    'electron-builder-cli': { type: 'string' }, icon: { type: 'string' },
  } })
  if (!values.candidate || !values.output || !values['installed-receipt'] || !values['electron-builder-cli'] || !values.icon) {
    throw new Error('Use --candidate <installed candidate root> --installed-receipt <json> --output <new directory> --electron-builder-cli <cli.js> --icon <icon.ico>')
  }
  await packWindowsInstaller({
    candidate: values.candidate,
    output: values.output,
    installedReceipt: values['installed-receipt'],
    electronBuilderCli: values['electron-builder-cli'],
    icon: values.icon,
  })
}
