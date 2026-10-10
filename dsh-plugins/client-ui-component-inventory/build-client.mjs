// Builds the DSH component inventory client UI against the locked compiler
// workspace, staging the product native packages and the locked zod copy that
// the bundle resolves at build time. Node.js port of build-client.ps1.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyFileTo, copyTree, ensureDir, fullPath, isFile, isMainModule, pathExists, removeTree } from '../../scripts/lib/build-util.mjs'
import { assertLockedTsdown, findLockedZod, parseBuilderArgs, runLockedTsdown } from '../../scripts/lib/client-build.mjs'
import { normalizeGeneratedClient } from '../../scripts/normalize-generated-client.mjs'

export async function buildClient({ upstream = '', dshLockPath = '', output = '' } = {}) {
  const source = fullPath(dirname(fileURLToPath(import.meta.url)))
  const repository = fullPath(join(source, '..', '..'))
  upstream = fullPath(upstream || join(repository, '.research/upstream/deepseek-harness'))
  if (!dshLockPath) dshLockPath = join(repository, 'third_party/dsh/LOCK.json')
  const target = output ? fullPath(output) : join(source, 'lib')
  if (!target.startsWith(repository + sep)) throw new Error('Component inventory output must stay within the repository')
  const stage = join(upstream, 'packages/extensions/chatecnu-work-component-inventory-ui')
  const hostPackage = join(upstream, 'node_modules/@chatecnu-work/dsh-component-inventory-native')
  const hostSource = join(source, '..', 'component-inventory-native')
  const managerPackage = join(upstream, 'node_modules/@chatecnu-work/dsh-plugin-manager-native')
  const managerSource = join(source, '..', 'plugin-manager-native')

  const { testDshCompatibility } = await import(pathToFileURL(join(repository, 'dsh-desktop/scripts/test-dsh-compatibility.mjs')).href)
  await testDshCompatibility({ upstream, lockPath: dshLockPath })
  await assertLockedTsdown(upstream)
  await removeTree(stage)
  await removeTree(hostPackage)
  await removeTree(managerPackage)

  try {
    await ensureDir(stage)
    await copyFileTo(join(source, 'package.json'), join(stage, 'package.json'))
    await copyFileTo(join(source, 'tsdown.config.ts'), join(stage, 'tsdown.config.ts'))
    await copyTree(join(source, 'src'), join(stage, 'src'))
    await ensureDir(dirname(hostPackage))
    await copyTree(hostSource, hostPackage)
    await copyTree(managerSource, managerPackage)
    const zodSource = await findLockedZod(upstream)
    if (!zodSource || !await pathExists(zodSource)) throw new Error('Locked zod dependency is unavailable.')
    for (const zodPackage of [join(hostPackage, 'node_modules/zod'), join(managerPackage, 'node_modules/zod')]) {
      await ensureDir(dirname(zodPackage))
      await copyTree(zodSource, zodPackage)
    }
    await runLockedTsdown(upstream, stage)
      .catch(() => { throw new Error('Component inventory client bundle failed') })
    for (const artifact of ['index.js', 'client.js']) {
      const built = join(stage, 'lib', artifact)
      if (!await isFile(built)) throw new Error(`Missing client artifact: ${built}`)
      await ensureDir(target)
      await writeFile(join(target, artifact), await readFile(built))
    }
  } finally {
    await removeTree(stage)
    await removeTree(hostPackage)
    await removeTree(managerPackage)
  }

  await normalizeGeneratedClient(target)
  console.log('Built DSH component inventory client module.')
}

if (isMainModule(import.meta.url)) {
  const { upstream, dshLockPath, output } = parseBuilderArgs()
  await buildClient({ upstream, dshLockPath, output })
}
