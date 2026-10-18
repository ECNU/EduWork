// Builds the EduWork workbench client bundle in a disposable stage inside the
// locked compiler workspace, linking the verified runtime's zod. Node.js port
// of build-client.ps1.
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileTo, copyTree, ensureDir, fullPath, isFile, isMainModule, pathExists, removeTree } from '../../scripts/lib/build-util.mjs'
import { linkDirectory, parseBuilderArgs, runLockedTsdown } from '../../scripts/lib/client-build.mjs'
import { isDsh020 } from '../../dsh-host/dsh-compatibility.mjs'

export async function buildClient({ upstream, output, runtimePackages, dshLockPath } = {}) {
  if (!upstream || !output || !runtimePackages) throw new Error('Use --upstream <workspace> --output <lib> --runtime-packages <verified-runtime/node_modules>')
  // The compiler workspace version does not select the target UI contract.
  // Explicit native builds must agree with the supplied Runtime lock.
  let native = false
  if (dshLockPath) {
    const lock = JSON.parse(await readFile(dshLockPath, 'utf8'))
    const runtime = JSON.parse(await readFile(join(runtimePackages, '@deepseek-ai/dsh/package.json'), 'utf8'))
    if (runtime.version !== lock.packageVersion) throw new Error('Workbench target Runtime and DSH lock differ')
    native = isDsh020(runtime.version)
  }
  const scriptRoot = fullPath(dirname(fileURLToPath(import.meta.url)))
  const upstreamRoot = await realpath(fullPath(upstream))
  const target = fullPath(output)
  const stage = join(upstreamRoot, `packages/extensions/eduwork-workbench-build-${randomUUID().replaceAll('-', '')}`)
  if (!stage.startsWith(upstreamRoot.replace(/[\\/]+$/, '') + sep)) throw new Error('Build stage must stay in the selected toolchain')
  await ensureDir(stage)
  try {
    const dependencies = await realpath(fullPath(runtimePackages))
    if (!await isFile(join(dependencies, 'zod/package.json'))) throw new Error('The selected runtime must provide zod')
    await ensureDir(join(stage, 'node_modules/@chatecnu-work'))
    await linkDirectory(join(stage, 'node_modules/zod'), join(dependencies, 'zod'))
    for (const folder of ['skill-manager-native', 'skill-settings-native']) {
      const support = join(stage, `node_modules/@chatecnu-work/dsh-${folder}`)
      await ensureDir(support)
      await copyTree(join(scriptRoot, '..', folder, 'lib'), join(support, 'lib'))
      await copyFileTo(join(scriptRoot, '..', folder, 'package.json'), join(support, 'package.json'))
    }
    for (const name of ['src', 'lib']) {
      await copyTree(join(scriptRoot, name), join(stage, name))
    }
    for (const name of ['package.json', 'tsdown.config.ts', 'tsconfig.json']) {
      await copyFileTo(join(scriptRoot, name), join(stage, name))
    }
    if (native) {
      const config = join(stage, 'tsdown.config.ts')
      const original = await readFile(config, 'utf8')
      if (!original.includes('defineConfig({')) throw new Error('Workbench compiler configuration changed')
      await writeFile(config, original.replace('defineConfig({', "defineConfig({\n  define: { __EDUWORK_PINNED_DSH__: 'true' },"))
    }
    await runLockedTsdown(upstreamRoot, stage)
      .catch(() => { throw new Error('EduWork workbench client build failed') })
    await ensureDir(target)
    for (const entry of await readdir(join(stage, 'lib'), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue
      let content = (await readFile(join(stage, 'lib', entry.name), 'utf8'))
        .replace(/^\/\/# sourceMappingURL=.*$/gm, '')
        .replace(/[ \t]+(?=\r?$)/gm, '')
      content = content.replace(/[\r\n]+$/, '') + '\n'
      await writeFile(join(target, entry.name), content)
    }
  } finally {
    const zodLink = join(stage, 'node_modules/zod')
    if (await pathExists(zodLink)) await removeTree(zodLink)
    await removeTree(stage)
  }
}

if (isMainModule(import.meta.url)) {
  const { upstream, output, runtimePackages, dshLockPath } = parseBuilderArgs()
  await buildClient({ upstream, output, runtimePackages, dshLockPath })
}
