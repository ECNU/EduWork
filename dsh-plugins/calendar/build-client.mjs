// Builds the EduWork calendar client bundle in a disposable stage inside the
// locked compiler workspace, linking the verified runtime's zod. Node.js port of
// build-client.ps1.
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileTo, copyTree, ensureDir, fullPath, isFile, isMainModule, pathExists, removeTree } from '../../scripts/lib/build-util.mjs'
import { linkDirectory, parseBuilderArgs, runLockedTsdown } from '../../scripts/lib/client-build.mjs'
import { normalizeGeneratedClient } from '../../scripts/normalize-generated-client.mjs'
import { calendarClientLicenseBanner, installCalendarClientDependencies } from './client-dependencies.mjs'

export async function buildClient({ upstream, output, runtimePackages } = {}) {
  if (!upstream || !output || !runtimePackages) throw new Error('Use --upstream <workspace> --output <lib> --runtime-packages <verified-runtime/node_modules>')
  const scriptRoot = fullPath(dirname(fileURLToPath(import.meta.url)))
  const upstreamRoot = await realpath(fullPath(upstream))
  const target = fullPath(output)
  const stage = join(upstreamRoot, `packages/extensions/eduwork-calendar-build-${randomUUID().replaceAll('-', '')}`)
  if (!stage.startsWith(upstreamRoot.replace(/[\\/]+$/, '') + sep)) throw new Error('Build stage must stay in the selected toolchain')
  await ensureDir(stage)
  try {
    // The remote descriptors carry zod schemas, so the compiler needs the zod the
    // selected runtime ships. Link it instead of copying, and only the link is
    // removed below — the runtime stays untouched.
    const dependencies = await realpath(fullPath(runtimePackages))
    if (!await isFile(join(dependencies, 'zod/package.json'))) throw new Error('The selected runtime must provide zod')
    await ensureDir(join(stage, 'node_modules'))
    await linkDirectory(join(stage, 'node_modules/zod'), join(dependencies, 'zod'))
    const buildDeps = join(stage, 'build-deps')
    await ensureDir(buildDeps)
    for (const name of ['package.json', 'package-lock.json']) {
      await copyFileTo(join(scriptRoot, 'build-deps', name), join(buildDeps, name))
    }
    await installCalendarClientDependencies(buildDeps)
    await linkDirectory(join(stage, 'node_modules/fullcalendar'), join(buildDeps, 'node_modules/fullcalendar'))
    for (const name of ['src', 'lib']) {
      await copyTree(join(scriptRoot, name), join(stage, name))
    }
    for (const name of ['package.json', 'tsdown.config.ts', 'tsconfig.json']) {
      await copyFileTo(join(scriptRoot, name), join(stage, name))
    }
    await runLockedTsdown(upstreamRoot, stage)
      .catch(() => { throw new Error('Calendar client build failed') })
    await ensureDir(target)
    for (const entry of await readdir(join(stage, 'lib'), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue
      const content = (await readFile(join(stage, 'lib', entry.name), 'utf8'))
        .replace(/^([ \t]*\/\/#region \\0calendar-css:)[^\r\n]*[\\/]src[\\/]([^\\/\r\n]+\.css\.js)$/gm, '$1src/$2')
        .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
        .replace(/[ \t]+(?=\r?$)/gm, '')
      const banner = entry.name === 'client.js' ? await calendarClientLicenseBanner(buildDeps) : ''
      await writeFile(join(target, entry.name), banner + content.replace(/[\r\n]+$/, '') + '\n')
    }
  } finally {
    for (const name of ['zod', 'fullcalendar']) {
      const link = join(stage, 'node_modules', name)
      if (await pathExists(link)) await removeTree(link)
    }
    await removeTree(stage)
  }

  await normalizeGeneratedClient(target)
}

if (isMainModule(import.meta.url)) {
  const { upstream, output, runtimePackages } = parseBuilderArgs()
  await buildClient({ upstream, output, runtimePackages })
}
