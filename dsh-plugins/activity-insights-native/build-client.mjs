// Builds the activity insights client bundle in a disposable stage inside the
// locked compiler workspace, linking the verified runtime packages directly.
// Node.js port of build-client.ps1.
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileTo, copyTree, ensureDir, fullPath, isFile, isMainModule, pathExists, removeTree } from '../../scripts/lib/build-util.mjs'
import { linkDirectory, parseBuilderArgs, runLockedTsdown } from '../../scripts/lib/client-build.mjs'

export async function buildClient({ upstream, output, runtimePackages } = {}) {
  if (!upstream || !output || !runtimePackages) throw new Error('Use --upstream <workspace> --output <lib> --runtime-packages <verified-runtime/node_modules>')
  const scriptRoot = fullPath(dirname(fileURLToPath(import.meta.url)))
  const upstreamRoot = await realpath(fullPath(upstream))
  const target = fullPath(output)
  const stage = join(upstreamRoot, `packages/extensions/activity-insights-build-${randomUUID().replaceAll('-', '')}`)
  if (!stage.startsWith(upstreamRoot.replace(/[\\/]+$/, '') + sep)) throw new Error('Build stage must stay in the selected toolchain')
  await ensureDir(stage)
  try {
    const dependencies = await realpath(fullPath(runtimePackages))
    if (!await isFile(join(dependencies, 'zod/package.json'))) throw new Error('The selected runtime must provide zod')
    await linkDirectory(join(stage, 'node_modules'), dependencies)
    for (const name of ['src', 'lib']) {
      await copyTree(join(scriptRoot, name), join(stage, name))
    }
    for (const name of ['package.json', 'tsdown.config.ts']) {
      await copyFileTo(join(scriptRoot, name), join(stage, name))
    }
    await runLockedTsdown(upstreamRoot, stage)
      .catch(() => { throw new Error('Activity insights client build failed') })
    await ensureDir(target)
    const built = join(stage, 'lib/client.js')
    if (await isFile(built)) {
      const content = (await readFile(built, 'utf8')).replace(/^\/\/# sourceMappingURL=.*$/gm, '')
      await writeFile(join(target, 'client.js'), content)
    }
  } finally {
    const runtimeLink = join(stage, 'node_modules')
    if (await pathExists(runtimeLink)) await removeTree(runtimeLink)
    await removeTree(stage)
  }
}

if (isMainModule(import.meta.url)) {
  const { upstream, output, runtimePackages } = parseBuilderArgs()
  await buildClient({ upstream, output, runtimePackages })
}
