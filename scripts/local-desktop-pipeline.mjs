// One-command local pipeline: build the Web assembly, Host, native inputs and
// the Electron desktop package for this machine's platform, then install the
// verified archive locally. Windows and macOS produce and install a desktop
// package; Linux currently runs the Web assembly and Host validation only.
// This entry publishes nothing: GitHub Releases, npm and update feeds remain
// separate, explicitly authorized flows.
import { rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  ensureDir, fullPath, isMacOS, isMainModule, isWindows, pathExists, readJSON,
  removeTree, run, runNode, sha256File, writeJSON,
} from './lib/build-util.mjs'
import { ciEduworkWeb } from './ci-eduwork-web.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

function defaultInstallRoot() {
  if (isWindows) return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Programs')
  if (isMacOS) return join(homedir(), 'Applications')
  return ''
}

async function developmentVersion(coreRoot, requested) {
  if (requested) {
    if (!/^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/.test(requested)) {
      throw new Error('Local desktop builds use development versions: X.Y.Z-dev.YYYYMMDD.N')
    }
    return requested
  }
  const source = await readJSON(join(coreRoot, 'source-receipt.json'))
  if (/^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/.test(source.version)) return source.version
  const base = source.version.match(/^(\d+\.\d+\.\d+)/)?.[1]
  if (!base) throw new Error('Source receipt version is not a supported release version')
  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  return `${base}-dev.${today}.1`
}

export async function localDesktopPipeline({
  coreRoot = join(scriptRoot, '..'),
  editionRoot = '',
  distributionConfig = 'config/distributions/generic.json',
  version = '',
  workspace = '',
  installRoot = '',
  skipInstall = false,
  verifySnapshot = true,
  runtimeSource = '',
} = {}) {
  coreRoot = fullPath(coreRoot)
  editionRoot = fullPath(editionRoot || coreRoot)
  const name = coreRoot === editionRoot ? 'EduWork' : 'EduWork-ECNU'
  // The pinned compiler workspace uses the corepack/npm entries bundled with
  // Node.js 24; newer Node releases no longer ship corepack.
  if (!process.version.startsWith('v24.')) {
    throw new Error(`EduWork builds require the pinned Node.js 24 toolchain (24.18.0); this is ${process.version}`)
  }

  if (!isWindows && !isMacOS) {
    // Linux has no supported desktop package yet. Validate what this platform
    // supports end to end: source audit, Web assembly and Host compatibility.
    const output = fullPath(workspace || join(coreRoot, 'dist/local-web-pipeline'))
    const result = await ciEduworkWeb({ coreRoot, editionRoot, distributionConfig, version, output })
    console.log('Linux: Web assembly and validation complete. Desktop packages currently require Windows or macOS.')
    return { schemaVersion: 1, kind: 'eduwork-local-pipeline', platform: process.platform, web: result }
  }

  version = await developmentVersion(coreRoot, version)
  const output = fullPath(workspace || join(coreRoot, `dist/local-desktop-${version}`))
  installRoot = fullPath(installRoot || defaultInstallRoot())
  const installTarget = isWindows ? join(installRoot, name) : join(installRoot, `${name}.app`)
  if (!skipInstall && await pathExists(installTarget)) {
    throw new Error(`Install target already exists and is never replaced: ${installTarget}. ` +
      'Move it away or pass --install-root <new directory>.')
  }

  const shared = {
    coreRoot,
    editionRoot,
    distributionConfig,
    version,
    development: true,
    verifySnapshot,
    runtimeSource,
    output,
  }
  let releaseReceipt
  if (isWindows) {
    const { ciEduworkWindowsRelease } = await import('./ci-eduwork-windows-release.mjs')
    releaseReceipt = await ciEduworkWindowsRelease(shared)
  } else {
    const { ciEduworkMacosRelease } = await import('./ci-eduwork-macos-release.mjs')
    releaseReceipt = await ciEduworkMacosRelease(shared)
  }

  const receipt = {
    schemaVersion: 1,
    kind: 'eduwork-local-pipeline',
    platform: isWindows ? 'windows-x64' : 'macos-arm64',
    edition: name,
    version,
    workspace: output,
    asset: releaseReceipt.asset,
    // An unverified source snapshot means these bytes were built from an
    // uncommitted working tree; never treat such a build as a release input.
    sourceSnapshotVerified: verifySnapshot,
    // The build already passed the packaged launch acceptance on the same
    // archive bytes inside the workspace.
    checks: { build: 'passed', packagedLaunch: 'passed' },
    installed: false,
  }

  if (!skipInstall) {
    const archive = join(output, 'publish', releaseReceipt.asset.name)
    if (await sha256File(archive) !== releaseReceipt.asset.sha256) throw new Error('Published archive hash changed after acceptance')
    await ensureDir(installRoot)
    // Extract next to the target, then move the finished tree into place, so a
    // failed extraction never leaves a half-installed application.
    const staging = join(installRoot, `.${name}-install-${version}`)
    if (await pathExists(staging)) throw new Error(`Remove the leftover install staging directory: ${staging}`)
    await ensureDir(staging)
    if (isWindows) {
      await run('tar.exe', ['-xf', archive, '-C', staging])
      await rename(join(staging, name), installTarget)
    } else {
      await run('ditto', ['-x', '-k', archive, staging])
      await rename(join(staging, `${name}.app`), installTarget)
    }
    await removeTree(staging)
    if (isWindows) {
      await runNode(join(coreRoot, 'scripts/verify-windows-release.mjs'), [installTarget, '--for-update'])
      await run(join(installTarget, 'resources/runtime/node.exe'),
        [join(coreRoot, 'scripts/check-desktop-runtimes.mjs'), installTarget, join(output, 'installed-native-runtimes.json')])
    } else {
      await run('codesign', ['--verify', '--deep', '--strict', installTarget])
      await run(join(installTarget, 'Contents/Resources/runtime/node'),
        [join(coreRoot, 'scripts/check-desktop-runtimes.mjs'), installTarget, join(output, 'installed-native-runtimes.json')])
    }
    receipt.installed = true
    receipt.installPath = installTarget
    receipt.checks.installedArchiveHash = 'passed'
    receipt.checks.installedNativeRuntimes = 'passed'
    console.log(`Installed: ${installTarget}`)
    console.log(isWindows
      ? `Launch: ${join(installTarget, 'EduWork-Electron.exe')}`
      : `Launch: open "${installTarget}"`)
  } else {
    console.log(`Build complete without local installation: ${join(output, 'publish', releaseReceipt.asset.name)}`)
  }

  await writeJSON(join(output, 'local-pipeline-receipt.json'), receipt)
  return receipt
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'core-root': { type: 'string' },
      'edition-root': { type: 'string' },
      'distribution-config': { type: 'string' },
      version: { type: 'string' },
      workspace: { type: 'string' },
      'install-root': { type: 'string' },
      'skip-install': { type: 'boolean' },
      'no-verify-snapshot': { type: 'boolean' },
      'runtime-source': { type: 'string' },
    },
  })
  await localDesktopPipeline({
    coreRoot: values['core-root'] ?? join(scriptRoot, '..'),
    editionRoot: values['edition-root'] ?? '',
    distributionConfig: values['distribution-config'] ?? 'config/distributions/generic.json',
    version: values.version ?? '',
    workspace: values.workspace ?? '',
    installRoot: values['install-root'] ?? '',
    skipInstall: Boolean(values['skip-install']),
    verifySnapshot: !values['no-verify-snapshot'],
    runtimeSource: values['runtime-source'] ?? '',
  })
}
