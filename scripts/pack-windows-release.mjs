// Packs a validated Windows Electron candidate into the immutable release ZIP
// with its RELEASE-MANIFEST inventory. Node.js port of pack-windows-release.ps1.
import { readFile, readdir, lstat, mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, extname, join, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { fullPath, isFile, isMainModule, pathExists, readJSON, sha256File, statEntry, writeText } from './lib/build-util.mjs'
import { ZipWriter } from './lib/zip.mjs'

export async function packWindowsRelease({ candidate, output, development = false, forUpdate = false } = {}) {
  candidate = await realpath(fullPath(candidate))
  output = fullPath(output)
  if (output.toLowerCase().startsWith(candidate.replace(/[\\/]+$/, '').toLowerCase() + sep) || await pathExists(output)) {
    throw new Error('ZIP must be a new file outside the desktop directory')
  }
  const identity = await readJSON(join(candidate, 'resources/app/eduwork.desktop.json'))
  const versionPattern = development ? /^\d+\.\d+\.\d+-dev\.\d{8}\.[1-9]\d*$/ : /^\d+\.\d+\.\d+$/
  if (!versionPattern.test(identity.productVersion) || identity.shell !== 'electron') {
    throw new Error('Package version does not match its selected channel or Electron shell')
  }
  if (forUpdate) {
    for (const entry of ['ChatECNU-Work.exe', 'EduWork.exe']) {
      if (!await isFile(join(candidate, entry))) throw new Error(`Migration launcher is missing: ${entry}`)
    }
  }
  const names = { eduwork: 'EduWork', 'eduwork-chatecnu': 'EduWork-ECNU' }
  const name = names[identity.distribution]
  if (!name) throw new Error('Unknown release distribution')
  if (basename(output) !== `${name}-${identity.productVersion}-windows-x64-electron.zip`) {
    throw new Error('Release asset name differs from the package identity')
  }
  const files = []
  const inventory = async (directory, prefix) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const path = join(directory, entry.name)
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Unresolved package link: ${relative}`)
      if (/(^|\/)(\.git|\.env|\.env\.local|credentials\.encrypted)(\/|$)/.test(relative) || /^(data|evidence)(\/|$)/.test(relative)) {
        throw new Error(`Private/build data in the release: ${relative}`)
      }
      if (entry.isDirectory()) {
        await inventory(path, relative)
      } else {
        if (/^(config\/|resources\/product\/resources\/desktop\/)/.test(relative) && ['.json', '.jsonc'].includes(extname(entry.name))) {
          const text = await readFile(path, 'utf8')
          for (const match of text.matchAll(/"client(?:Id|ID|_id)"\s*:\s*"([^"]+)"/g)) {
            if (!/^replace-with-[a-z0-9-]+$/.test(match[1])) throw new Error(`Deployment client identifier in public package configuration: ${relative}`)
          }
        }
        files.push({ path: relative, bytes: (await statEntry(path)).size, sha256: await sha256File(path) })
      }
    }
  }
  await inventory(candidate, '')
  await mkdir(dirname(output), { recursive: true })
  const zip = await ZipWriter.create(output)
  try {
    for (const file of files) {
      await zip.addEntry(`${name}/${file.path}`, await readFile(join(candidate, file.path)))
    }
    const manifest = {
      schemaVersion: 1,
      kind: 'eduwork-portable-release',
      version: identity.productVersion,
      distribution: identity.distribution,
      shell: 'electron',
      platform: 'windows-x64',
      files,
    }
    if (forUpdate) {
      manifest.launcherVersion = identity.productVersion
      manifest.flavor = 'offline'
      manifest.launch = { protocol: 'eduwork-desktop/v1', shell: 'electron', executable: 'EduWork-Electron.exe', migration: 'wails-host-v1', distribution: identity.distribution }
    }
    await zip.addEntry(`${name}/RELEASE-MANIFEST.json`, Buffer.from(JSON.stringify(manifest, null, 2)))
    await zip.close()
  } catch (error) {
    await zip.abort()
    throw error
  }
  const hash = await sha256File(output)
  await writeText(`${output}.sha256`, `${hash}  ${basename(output)}`)
  console.log(`Created ${basename(output)}: ${(await statEntry(output)).size} bytes, SHA256 ${hash}`)
  return { output, sha256: hash }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      candidate: { type: 'string' },
      output: { type: 'string' },
      development: { type: 'boolean' },
      'for-update': { type: 'boolean' },
    },
  })
  if (!values.candidate || !values.output) throw new Error('Use --candidate <dir> --output <zip> [--development] [--for-update]')
  await packWindowsRelease({
    candidate: values.candidate,
    output: values.output,
    development: Boolean(values.development),
    forUpdate: Boolean(values['for-update']),
  })
}
