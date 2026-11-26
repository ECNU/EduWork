// Prepare the pinned official Node runtime used by the Linux AppImage Host.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { capture, download, ensureDir, fullPath, isFile, isMainModule, pathExists, readJSON, run, sha256File, writeJSON } from './lib/build-util.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

export async function prepareLinuxReleaseInputs({ output } = {}) {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Linux inputs require a Linux x64 host')
  output = fullPath(output)
  if (await pathExists(output)) throw new Error('Use a new Linux input directory')
  await ensureDir(output)
  const manifest = await readJSON(join(root, 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json'))
  const asset = manifest.assets['linux-amd64']
  if (!asset?.url || !asset?.sha256 || !asset.archiveRoot) throw new Error('The Node runtime manifest has no Linux x64 asset')
  const archive = join(output, 'node.tar.xz')
  await download(asset.url, archive, { sha256: asset.sha256 })
  const nodeRoot = join(output, 'node')
  await mkdir(nodeRoot, { recursive: true })
  await run('tar', ['-xJf', archive, '-C', nodeRoot])
  const node = join(nodeRoot, asset.archiveRoot, 'bin/node')
  const license = join(nodeRoot, asset.archiveRoot, 'LICENSE')
  if (!await isFile(node) || !await isFile(license)) throw new Error('Extracted Linux Node runtime is incomplete')
  const nodeVersion = (await capture(node, ['--version'])).trim()
  await writeJSON(join(output, 'inputs.json'), {
    schemaVersion: 1, platform: 'linux-x64', node, nodeVersion, nodeSHA256: await sha256File(node),
    source: { url: asset.url, sha256: asset.sha256 },
  })
  return { node, nodeVersion }
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({ options: { output: { type: 'string' } } })
  if (!values.output) throw new Error('Use --output <new Linux input directory>')
  console.log(JSON.stringify(await prepareLinuxReleaseInputs({ output: values.output }), null, 2))
}
