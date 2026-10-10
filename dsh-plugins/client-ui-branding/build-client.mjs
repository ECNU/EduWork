// Builds the configurable EduWork branding client bundle from the locked DSH
// compiler workspace. Node.js port of build-client.ps1.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyFileTo, copyTree, ensureDir, fullPath, isFile, isMainModule, removeTree } from '../../scripts/lib/build-util.mjs'
import { assertLockedTsdown, parseBuilderArgs, runLockedTsdown } from '../../scripts/lib/client-build.mjs'
import { normalizeGeneratedClient } from '../../scripts/normalize-generated-client.mjs'

export async function buildClient({ upstream = '', dshLockPath = '', output = '' } = {}) {
  const source = fullPath(dirname(fileURLToPath(import.meta.url)))
  const repository = fullPath(join(source, '..', '..'))
  upstream = fullPath(upstream || join(repository, '.research/upstream/deepseek-harness'))
  if (!dshLockPath) dshLockPath = join(repository, 'third_party/dsh/LOCK.json')
  const target = output ? fullPath(output) : join(source, 'lib')
  if (!target.startsWith(repository + sep)) throw new Error('Branding output must stay within the repository')
  const stage = join(upstream, 'packages/extensions/chatecnu-work-client-ui-branding')

  const { testDshCompatibility } = await import(pathToFileURL(join(repository, 'dsh-desktop/scripts/test-dsh-compatibility.mjs')).href)
  await testDshCompatibility({ upstream, lockPath: dshLockPath })
  await assertLockedTsdown(upstream)
  await removeTree(stage)

  try {
    await ensureDir(stage)
    await copyFileTo(join(source, 'package.json'), join(stage, 'package.json'))
    await copyFileTo(join(source, 'tsdown.config.ts'), join(stage, 'tsdown.config.ts'))
    await copyTree(join(source, 'src'), join(stage, 'src'))
    await runLockedTsdown(upstream, stage)
      .catch(() => { throw new Error('Branding client bundle failed') })
    await ensureDir(target)
    for (const artifact of ['index.js', 'theme.js', 'client.js']) {
      const built = join(stage, 'lib', artifact)
      if (!await isFile(built)) throw new Error(`Missing client artifact: ${built}`)
      const content = (await readFile(built, 'utf8'))
        .replace(/^\/\/# sourceMappingURL=client\.js\.map\s*$/gm, '')
      await writeFile(join(target, artifact), content.replace(/\s+$/, ''))
    }
  } finally {
    await removeTree(stage)
  }

  await normalizeGeneratedClient(target)
  console.log('Built configurable EduWork branding client module.')
}

if (isMainModule(import.meta.url)) {
  const { upstream, dshLockPath, output } = parseBuilderArgs()
  await buildClient({ upstream, dshLockPath, output })
}
