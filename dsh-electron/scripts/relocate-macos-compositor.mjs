// Rewrites the pinned Remotion compositor's Mach-O install names so every
// bundled dependency resolves beside the binary, then re-signs ad hoc.
// Node.js port of relocate-macos-compositor.ps1. Requires macOS.
import { lstat, readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs } from 'node:util'
import { capture, fullPath, isFile, isMacOS, isMainModule, readJSON, run, sha256File, writeJSON } from '../../scripts/lib/build-util.mjs'

export async function relocateMacosCompositor({ packageRoot, receipt } = {}) {
  if (!isMacOS) throw new Error('Mach-O relocation requires macOS')
  packageRoot = fullPath(packageRoot)
  const manifest = await readJSON(join(packageRoot, 'package.json'))
  if (manifest.name !== '@remotion/compositor-darwin-arm64') throw new Error('Expected the pinned arm64 compositor package')
  const records = []
  const entries = (await readdir(packageRoot, { withFileTypes: true }))
    .filter(entry => entry.isFile() || entry.isSymbolicLink())
    .sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const path = join(packageRoot, entry.name)
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Native compositor inputs must be real files')
    const kind = await capture('file', ['-b', path])
    if (!/Mach-O/.test(kind)) continue
    const before = await sha256File(path)
    const dependencies = (await capture('otool', ['-L', path])).split('\n').slice(1)
    const changes = []
    for (const line of dependencies) {
      const match = line.match(/^\s+(.+?) \(/)
      if (!match) continue
      const dependency = match[1]
      if (dependency.startsWith('/System/Library/') || dependency.startsWith('/usr/lib/')) continue
      const name = dependency.split('/').at(-1)
      if (name === entry.name && extname(entry.name) === '.dylib') continue
      const sibling = join(packageRoot, name)
      if (!await isFile(sibling) || (await lstat(sibling)).isSymbolicLink()) throw new Error(`Unbundled compositor dependency: ${dependency}`)
      const relative = `@loader_path/${name}`
      if (dependency !== relative) {
        await run('install_name_tool', ['-change', dependency, relative, path])
        changes.push({ from: dependency, to: relative })
      }
    }
    if (extname(entry.name) === '.dylib') await run('install_name_tool', ['-id', `@loader_path/${entry.name}`, path])
    await run('codesign', ['--force', '--sign', '-', '--timestamp=none', path])
    records.push({ file: entry.name, beforeSHA256: before, afterSHA256: await sha256File(path), dependencies: changes })
  }
  if (!records.some(record => record.file === 'ffmpeg')) throw new Error('Compositor FFmpeg was not found')
  await writeJSON(fullPath(receipt), { schemaVersion: 1, package: manifest.name, version: manifest.version, files: records })
  // Exercise the executable outside its own directory, as Office and media tools do.
  const versionOutput = await capture(join(packageRoot, 'ffmpeg'), ['-version'], { cwd: tmpdir() })
  console.log(versionOutput.split('\n')[0])
  return records
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'package-root': { type: 'string' },
      receipt: { type: 'string' },
    },
  })
  if (!values['package-root'] || !values.receipt) throw new Error('Use --package-root <compositor package> --receipt <json>')
  await relocateMacosCompositor({ packageRoot: values['package-root'], receipt: values.receipt })
}
