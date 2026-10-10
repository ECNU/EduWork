// Downloads and verifies the pinned Electron runtime for the current platform
// (Windows and macOS only). Node.js port of prepare-electron.ps1.
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  capture, download, ensureDir, fullPath, isDirectory, isFile, isMainModule,
  isMacOS, isWindows, pathExists, readJSON, run, sha256File, writeJSON,
} from '../../scripts/lib/build-util.mjs'

export async function prepareElectron({ upstream, output } = {}) {
  const packageRoot = join(fullPath(upstream), 'apps/desktop/node_modules/electron')
  const manifest = await readJSON(join(packageRoot, 'package.json'))
  const checksums = await readJSON(join(packageRoot, 'checksums.json'))
  let platform
  if (isWindows) platform = 'win32'
  else if (isMacOS) platform = 'darwin'
  else throw new Error('Electron preparation supports Windows and macOS only')
  const arch = process.arch
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Electron preparation requires Node x64 or arm64')
  const archiveName = `electron-v${manifest.version}-${platform}-${arch}.zip`
  const expected = checksums[archiveName]
  if (!/^[a-f0-9]{64}$/.test(expected ?? '')) throw new Error(`The pinned Electron package has no ${platform} ${arch} checksum`)
  output = fullPath(output)
  await ensureDir(output)
  const archive = join(output, archiveName)
  if (!await pathExists(archive)) {
    await download(`https://github.com/electron/electron/releases/download/v${manifest.version}/${archiveName}`, archive)
  }
  if (await sha256File(archive) !== expected) throw new Error('Electron archive checksum mismatch')
  const runtime = join(output, 'runtime')
  if (!await isDirectory(runtime)) {
    await mkdir(runtime, { recursive: true })
    await run('tar', ['-xf', archive, '-C', runtime])
      .catch(() => { throw new Error('Electron extraction failed') })
  }
  let actualVersion
  if (isWindows) {
    if (!await isFile(join(runtime, 'electron.exe'))) throw new Error('Electron runtime executable is missing')
    actualVersion = (await readFile(join(runtime, 'version'), 'utf8')).trim().replace(/^v/, '')
  } else {
    const electronApp = join(runtime, 'Electron.app')
    const executable = join(electronApp, 'Contents/MacOS/Electron')
    const plist = join(electronApp, 'Contents/Info.plist')
    if (!await isFile(executable) || !await isFile(plist)) throw new Error('Electron.app runtime is incomplete')
    actualVersion = (await capture('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', plist])
      .catch(() => { throw new Error('Electron.app version could not be read') })).trim()
    const architectures = (await capture('lipo', ['-archs', executable])).trim().split(/\s+/)
    if (!architectures.includes(arch)) throw new Error(`Electron runtime architecture mismatch: expected ${arch}`)
  }
  if (actualVersion !== manifest.version) throw new Error(`Electron runtime version mismatch: expected ${manifest.version}, found ${actualVersion}`)
  await writeJSON(join(output, 'receipt.json'), {
    version: actualVersion,
    platform,
    arch,
    archive: archiveName,
    sha256: expected,
    downloadedFrom: 'https://github.com/electron/electron/releases',
    runtime,
  })
  console.log(`Verified Electron ${actualVersion} ${platform} ${arch} runtime: ${runtime}`)
  return { runtime, version: actualVersion, platform, arch }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      upstream: { type: 'string' },
      output: { type: 'string' },
    },
  })
  if (!values.upstream || !values.output) throw new Error('Use --upstream <workspace> --output <cache>')
  await prepareElectron({ upstream: values.upstream, output: values.output })
}
