import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { isMainModule, pathExists, readJSON, sha256File, statEntry, writeJSON } from './lib/build-util.mjs'
import { desktopVersion } from './desktop-build-plan.mjs'
import { windowsReleaseManifest } from './pack-windows-release.mjs'
import { installedUpdateSource } from '../dsh-electron/src/installed-updates.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export async function packWindowsInstalled({ candidate, upstream, tools, output }) {
  candidate = resolve(candidate); output = resolve(output); tools = resolve(tools)
  if (await pathExists(output)) throw new Error('Installer output must be a new directory')
  const settings = await readJSON(join(candidate, 'resources/app/eduwork.desktop.json'))
  if (settings.dataLayout !== 'installed' || !/^[a-z0-9-]+$/u.test(settings.distribution)
    || settings.appId !== `org.eduwork.${settings.distribution}.electron`) throw new Error('NSIS requires an installed-layout candidate with a fixed edition identity')
  const { channel } = desktopVersion(settings.productVersion)
  const source = installedUpdateSource({ defaults: settings.updates, policy: channel, version: settings.productVersion })
  if (!source) throw new Error('Configure an NSIS GitHub or HTTPS latest.yml/nightly.yml source before packaging')
  const req = createRequire(join(tools, 'package.json'))
  for (const name of ['electron-builder', 'app-builder-lib']) assert.equal(req(`${name}/package.json`).version, '26.17.0', 'Use the pinned official NSIS tooling')
  const expected = await readJSON(join(repository, 'dsh-electron/upstream-inputs-pinned-source.json'))
  const official = {}
  for (const file of ['windows-directory-installer.mjs', 'installer-directories.nsh']) {
    const path = `apps/desktop/scripts/${file}`, bytes = await readFile(join(upstream, path))
    assert.equal(sha256(bytes), expected[path], `Official NSIS source differs: ${path}`)
    official[file] = bytes
  }
  const build = join(output, '.builder')
  await mkdir(build, { recursive: true })
  await writeJSON(join(build, 'package.json'), { name: 'eduwork-desktop-installer', version: settings.productVersion,
    description: settings.productName, author: 'EduWork', license: 'MulanPSL-2.0 AND MIT' })
  // Only resolve the unchanged official adapter's dependencies from the locked tooling directory.
  const adapter = official['windows-directory-installer.mjs'].toString('utf8')
    .replace('const require = createRequire(import.meta.url)', `const require = createRequire(${JSON.stringify(join(tools, 'package.json'))})`)
  assert.notEqual(adapter, official['windows-directory-installer.mjs'].toString('utf8'))
  await writeFile(join(build, 'windows-directory-installer.mjs'), adapter)
  await writeFile(join(build, 'installer-directories.nsh'), official['installer-directories.nsh'])
  await copyFile(join(repository, 'dsh-electron/scripts/windows-installed.nsh'), join(build, 'windows-installed.nsh'))
  const manifest = await windowsReleaseManifest(candidate)
  await writeJSON(join(candidate, 'RELEASE-MANIFEST.json'), manifest)
  const manifestSHA256 = await sha256File(join(candidate, 'RELEASE-MANIFEST.json'))
  const { installWindowsDirectoryInstaller } = await import(pathToFileURL(join(build, 'windows-directory-installer.mjs')))
  installWindowsDirectoryInstaller()
  const { build: buildInstaller, Platform, Arch } = req('electron-builder')
  let registry
  const edition = { eduwork: 'EduWork', 'eduwork-chatecnu': 'EduWork-ECNU' }[settings.distribution]
  if (!edition) throw new Error('Unknown installer edition')
  await buildInstaller({ projectDir: build, prepackaged: candidate, publish: 'never',
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    config: { appId: settings.appId, productName: settings.productName, executableName: 'EduWork-Electron',
      directories: { output }, electronVersion: '44.0.0', asar: false,
      artifactName: `${edition}-${settings.productVersion}-windows-x64-setup.exe`,
      detectUpdateChannel: false, generateUpdatesFilesForAllChannels: false,
      publish: source,
      win: { signAndEditExecutable: false, requestedExecutionLevel: 'asInvoker', icon: join(repository, 'assets/eduwork/icon.ico') },
      nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
        packElevateHelper: false,
        deleteAppDataOnUninstall: false, createDesktopShortcut: 'always', createStartMenuShortcut: true,
        shortcutName: settings.productName, uninstallDisplayName: settings.productName,
        include: join(build, 'windows-installed.nsh'), installerLanguages: ['zh_CN', 'en_US'],
        installerIcon: join(repository, 'assets/eduwork/icon.ico'), uninstallerIcon: join(repository, 'assets/eduwork/icon.ico'),
        warningsAsErrors: true },
      extraMetadata: {},
    },
    effectiveOptionComputed: async options => {
      if (options[0] === undefined) return false
      const [defines] = options
      assert.match(defines.APP_GUID, /^[a-f0-9-]{36}$/u)
      registry = { installKey: `Software\\${defines.APP_GUID}`,
        uninstallKey: `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${defines.UNINSTALL_APP_KEY}` }
      defines.APP_FILENAME = edition
      defines.EDUWORK_INSTALLER_NODE = join(candidate, 'resources/runtime/node.exe')
      defines.EDUWORK_INSTALLER_WORKER = join(candidate, 'resources/app/lib/installed-files.cjs')
      defines.EDUWORK_DISTRIBUTION = settings.distribution
      defines.EDUWORK_DIRECTORY_INCLUDE = join(build, 'installer-directories.nsh')
      return false
    },
  })
  assert.equal(await sha256File(join(candidate, 'RELEASE-MANIFEST.json')), manifestSHA256)
  assert.deepEqual(await windowsReleaseManifest(candidate), manifest, 'NSIS packaging changed the frozen application payload')
  const files = []
  const setup = `${edition}-${settings.productVersion}-windows-x64-setup.exe`
  for (const name of [setup, `${setup}.blockmap`, `${source.channel}.yml`]) {
    const file = join(output, name)
    files.push({ name, bytes: (await statEntry(file)).size, sha256: await sha256File(file) })
  }
  const receipt = { schemaVersion: 1, kind: 'eduwork-windows-nsis', version: settings.productVersion,
    distribution: settings.distribution, appId: settings.appId, backend: 'nsis', registry, manifestSHA256, files,
    tooling: { electronBuilder: '26.17.0', officialSources: Object.fromEntries(Object.entries(official).map(([file, bytes]) => [file, sha256(bytes)])),
      adapterSHA256: sha256(adapter) } }
  await writeJSON(join(output, 'installer-receipt.json'), receipt)
  return { ...receipt, output: join(output, files.find(file => file.name.endsWith('-setup.exe')).name) }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: Object.fromEntries(['candidate', 'upstream', 'tools', 'output'].map(name => [name, { type: 'string' }])) })
  if (['candidate', 'upstream', 'tools', 'output'].some(name => !values[name])) throw new Error('Use --candidate --upstream --tools --output')
  await packWindowsInstalled(values)
}
