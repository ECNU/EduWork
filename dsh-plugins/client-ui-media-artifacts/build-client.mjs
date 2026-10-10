// Builds the media artifact client UI with the shared Office viewer resolved
// from a disposable stage. Node.js port of build-client.ps1.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { copyFileTo, copyTree, ensureDir, fullPath, isFile, isMainModule, pathExists, readJSON, removeTree, writeJSON } from '../../scripts/lib/build-util.mjs'
import { assertLockedTsdown, findLockedZod, parseBuilderArgs, runLockedTsdown } from '../../scripts/lib/client-build.mjs'
import { normalizeGeneratedClient } from '../../scripts/normalize-generated-client.mjs'

export async function buildClient({ upstream = '', dshLockPath = '', artifactServices = '', output = '' } = {}) {
  const source = fullPath(dirname(fileURLToPath(import.meta.url)))
  const repository = fullPath(join(source, '..', '..'))
  upstream = fullPath(upstream || join(repository, '.research/upstream/deepseek-harness'))
  if (!dshLockPath) dshLockPath = join(repository, 'third_party/dsh/LOCK.json')
  if (!artifactServices) artifactServices = join(upstream, 'node_modules/@eduwork/dsh-artifact-services')
  const artifactSource = fullPath(artifactServices)
  const artifactManifest = await readJSON(join(artifactSource, 'package.json'))
  if (artifactManifest.name !== '@eduwork/dsh-artifact-services' || !artifactManifest.exports?.['./office-preview-client']) {
    throw new Error('Select Shared Artifact Services with office-preview-client via --artifact-services.')
  }
  const target = output ? fullPath(output) : join(source, 'lib')
  if (!target.startsWith(repository + sep)) throw new Error('Media UI output must stay within the repository')
  const extensions = fullPath(join(upstream, 'packages/extensions'))
  const stage = fullPath(join(extensions, `chatecnu-work-client-ui-media-artifacts-${randomUUID().replaceAll('-', '')}`))

  const { testDshCompatibility } = await import(pathToFileURL(join(repository, 'dsh-desktop/scripts/test-dsh-compatibility.mjs')).href)
  await testDshCompatibility({ upstream, lockPath: dshLockPath })
  await assertLockedTsdown(upstream)
  if (await pathExists(stage)) throw new Error(`Build stage already exists: ${stage}`)

  try {
    await ensureDir(stage)
    await copyFileTo(join(source, 'package.json'), join(stage, 'package.json'))
    await copyFileTo(join(source, 'tsdown.config.ts'), join(stage, 'tsdown.config.ts'))
    await copyTree(join(source, 'src'), join(stage, 'src'))
    await rename(join(stage, 'src/client/index.js'), join(stage, 'src/client/index.ts'))
    // Resolve the product remote and browser-only Shared entry inside this
    // disposable stage. Never replace packages in upstream node_modules.
    const previewPackage = join(stage, 'node_modules/@chatecnu-work/dsh-artifact-preview-native')
    await ensureDir(dirname(previewPackage))
    await copyTree(join(source, '..', 'artifact-preview-native'), previewPackage)
    const zodSource = await findLockedZod(upstream)
    if (!zodSource) throw new Error('Locked DSH zod dependency is missing')
    const stageZod = join(previewPackage, 'node_modules/zod')
    await ensureDir(dirname(stageZod))
    await copyTree(zodSource, stageZod)
    const sharedPackage = join(stage, 'node_modules/@eduwork/dsh-artifact-services')
    await ensureDir(join(sharedPackage, 'lib'))
    await copyFileTo(join(artifactSource, 'lib/office-preview-client.js'), join(sharedPackage, 'lib/office-preview-client.js'))
    await writeJSON(join(sharedPackage, 'package.json'), {
      name: artifactManifest.name,
      version: artifactManifest.version,
      type: 'module',
      exports: { './office-preview-client': './lib/office-preview-client.js' },
    })
    await runLockedTsdown(upstream, stage)
      .catch(() => { throw new Error('Media artifact client bundle failed') })
    await ensureDir(target)
    for (const artifact of ['index.js', 'client.js']) {
      const built = join(stage, 'lib', artifact)
      if (!await isFile(built)) throw new Error(`Missing client artifact: ${built}`)
      const content = (await readFile(built, 'utf8'))
        .replace(/[ \t]+$/gm, '')
        .replace(/^\/\/# sourceMappingURL=client\.js\.map\s*$/gm, '')
      await writeFile(join(target, artifact), content)
    }
  } finally {
    // Check the resolved unique target before deleting our own build stage.
    const resolvedStage = fullPath(stage)
    if (!resolvedStage.startsWith(extensions + sep) ||
      !/^chatecnu-work-client-ui-media-artifacts-[a-f0-9]{32}$/.test(resolvedStage.split(sep).pop())) {
      throw new Error('Unsafe build-stage cleanup target')
    }
    await removeTree(resolvedStage)
  }
  await normalizeGeneratedClient(target)
  console.log('Built ChatECNU Work media artifact UI with the shared Office viewer.')
}

if (isMainModule(import.meta.url)) {
  const { upstream, dshLockPath, artifactServices, output } = parseBuilderArgs()
  await buildClient({ upstream, dshLockPath, artifactServices, output })
}
