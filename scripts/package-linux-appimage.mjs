// Turn an assembled Linux candidate into a self-contained x86_64 AppImage.
// appimagetool is pinned in config/appimage.lock.json and can be supplied by
// the caller to keep CI and local builds on the same verified binary.
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  copyFileTo, copyTree, download, ensureDir, fullPath, isFile, isMainModule,
  pathExists, readJSON, run, sha256File, statEntry, writeText,
} from './lib/build-util.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

async function resolveTools(toolPath, cacheRoot, runtimePath = '') {
  const lock = await readJSON(join(scriptRoot, '../config/appimage.lock.json'))
  if (toolPath) {
    toolPath = fullPath(toolPath)
    if (!await isFile(toolPath)) throw new Error(`AppImage tool is missing: ${toolPath}`)
  } else {
    const target = join(cacheRoot || join('/tmp', 'eduwork-native-cache'), 'tools', basename(lock.url))
    if (!await isFile(target) || await sha256File(target) !== lock.sha256) await download(lock.url, target, { sha256: lock.sha256 })
    await chmod(target, 0o755)
    toolPath = target
  }
  if (runtimePath) {
    runtimePath = fullPath(runtimePath)
    if (!await isFile(runtimePath)) throw new Error(`AppImage runtime is missing: ${runtimePath}`)
    return { tool: toolPath, runtime: runtimePath }
  }
  const runtimeTarget = join(cacheRoot || join('/tmp', 'eduwork-native-cache'), 'tools', basename(lock.runtime.url))
  if (!await isFile(runtimeTarget) || await sha256File(runtimeTarget) !== lock.runtime.sha256) {
    await download(lock.runtime.url, runtimeTarget, { sha256: lock.runtime.sha256 })
  }
  await chmod(runtimeTarget, 0o755)
  return { tool: toolPath, runtime: runtimeTarget }
}

export async function packageLinuxAppImage({ candidate, output, appimagetool = '', appimageRuntime = '', cacheRoot = '', stagingRoot = '' } = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('AppImage packaging requires a Linux x64 host')
  candidate = fullPath(candidate)
  if (!await isFile(join(candidate, 'eduwork.bin')) || !await isFile(join(candidate, 'resources/app/eduwork.desktop.json'))) {
    throw new Error('Candidate is not an assembled Linux Electron directory')
  }
  const release = await readJSON(join(candidate, 'release.json'))
  // Keep the staging tree beside the candidate so local builds do not fill a
  // small system temporary filesystem. AppImage tooling receives the same
  // directory through TMPDIR for any internal scratch files.
  const staging = fullPath(stagingRoot || join(dirname(candidate), '.appimage-staging'))
  await ensureDir(staging)
  const appDir = await mkdtemp(join(staging, 'eduwork-appdir-'))
  try {
    await copyTree(candidate, join(appDir, 'usr/lib/eduwork'), { skipLinks: true })
    const payload = join(appDir, 'usr/lib/eduwork')
    await copyFileTo(join(payload, 'resources/brand/icon-256.png'), join(appDir, 'eduwork.png'))
    await writeText(join(appDir, 'EduWork.desktop'), [
      '[Desktop Entry]', 'Type=Application', `Name=${release.productName}`,
      'Comment=EduWork desktop workspace', 'Exec=eduwork', 'Icon=eduwork',
      'Terminal=false', 'Categories=Office;Education;', 'StartupWMClass=EduWork', '',
    ].join('\n'))
    await writeText(join(appDir, 'AppRun'), '#!/bin/sh\nhere=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$here/usr/lib/eduwork/eduwork" "$@"\n')
    await chmod(join(appDir, 'AppRun'), 0o755)
    const version = release.version
    const product = release.productName === 'EduWork-ECNU' ? 'EduWork-ECNU' : 'EduWork'
    output = fullPath(output || join(dirname(candidate), `${product}-${version}-linux-x86_64.AppImage`))
    if (await pathExists(output)) throw new Error(`AppImage output already exists: ${output}`)
    const tools = await resolveTools(appimagetool, cacheRoot, appimageRuntime)
    await run(tools.tool, ['--appimage-extract-and-run', appDir, output], { env: { ARCH: 'x86_64', RUNTIME: tools.runtime, TMPDIR: staging } })
    const info = await statEntry(output)
    if (!info?.isFile() || info.size < 1) throw new Error('appimagetool did not produce an AppImage')
    await chmod(output, 0o755)
    const sha256 = await sha256File(output)
    await writeText(`${output}.sha256`, `${sha256}  ${basename(output)}`)
    return { output, sha256, bytes: info.size, tool: tools.tool, runtime: tools.runtime }
  } finally {
    await rm(appDir, { recursive: true, force: true })
  }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string' }, output: { type: 'string' }, appimagetool: { type: 'string' }, 'cache-root': { type: 'string' }, 'staging-root': { type: 'string' },
  } })
  if (!values.candidate) throw new Error('Use --candidate <assembled Linux directory> [--output <AppImage>] [--appimagetool <path>]')
  const result = await packageLinuxAppImage({ candidate: values.candidate, output: values.output, appimagetool: values.appimagetool, cacheRoot: values['cache-root'], stagingRoot: values['staging-root'] })
  console.log(JSON.stringify(result, null, 2))
}
