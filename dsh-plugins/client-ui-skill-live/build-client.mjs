// Builds the product-owned live Skill UI compatibility plugin by renaming the
// locked upstream module identity and adding the settings invalidation hook.
// Node.js port of build-client.ps1.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureDir, fullPath, isFile, isMainModule, readJSON } from '../../scripts/lib/build-util.mjs'
import { parseBuilderArgs } from '../../scripts/lib/client-build.mjs'
import { normalizeGeneratedClient } from '../../scripts/normalize-generated-client.mjs'

const upstreamName = '@deepseek-ai/dsh-client-ui-skill'
const productName = '@chatecnu-work/dsh-client-ui-skill-live'

export async function buildClient({ upstream = '', runtimePackages = '', dshLockPath = '', output = '' } = {}) {
  const scriptRoot = fullPath(dirname(fileURLToPath(import.meta.url)))
  const repository = fullPath(join(scriptRoot, '..', '..'))
  upstream = fullPath(upstream || join(repository, '.research/upstream/deepseek-harness'))
  if (!dshLockPath) dshLockPath = join(repository, 'third_party/dsh/LOCK.json')
  const lock = await readJSON(dshLockPath)
  let source
  if (runtimePackages) {
    const runtimePackage = join(fullPath(runtimePackages), '@deepseek-ai/dsh-client-ui-skill')
    const manifest = await readJSON(join(runtimePackage, 'package.json'))
    if (String(manifest.version) !== String(lock.packageVersion)) {
      throw new Error(`Official DSH Skill UI package version mismatch: expected ${lock.packageVersion}, got ${manifest.version}`)
    }
    source = join(runtimePackage, 'lib/client.js')
  } else {
    const { testDshCompatibility } = await import(pathToFileURL(join(repository, 'dsh-desktop/scripts/test-dsh-compatibility.mjs')).href)
    await testDshCompatibility({ upstream, lockPath: dshLockPath })
    source = join(upstream, 'packages/client/ui-skill/lib/client.js')
  }
  const target = output ? join(fullPath(output), 'client.js') : join(scriptRoot, 'lib/client.js')
  if (!target.startsWith(repository + sep)) throw new Error('Skill UI output must stay within the repository')
  await ensureDir(dirname(target))
  if (!await isFile(source)) throw new Error(`Locked upstream Skill UI artifact is missing: ${source}`)

  let content = await readFile(source, 'utf8')
  if (content.includes('chatecnu-skills')) {
    throw new Error('Locked upstream Skill UI unexpectedly already contains the product settings namespace')
  }
  const identityCount = content.split(upstreamName).length - 1
  if (identityCount < 3) throw new Error(`Unexpected upstream Skill UI module identity count: ${identityCount}`)
  content = content.replaceAll(upstreamName, productName)

  const anchor = 'ctx.remote.$on("agent-preset/selected", invalidate);'
  // The inserted lines keep CRLF separators so rebuilding reproduces the
  // committed artifact byte for byte.
  const replacement = anchor +
    '\r\n\t\t\tctx.remote.$on("settings/document-updated", (namespace) => {' +
    '\r\n\t\t\t\tif (namespace === "chatecnu-skills") clearAll();' +
    '\r\n\t\t\t});'
  const anchorCount = content.split(anchor).length - 1
  if (anchorCount !== 1) throw new Error(`Unexpected upstream Skill UI invalidation anchor count: ${anchorCount}`)
  content = content.replace(anchor, () => replacement)
  content = content.replace(/^\/\/# sourceMappingURL=client\.js\.map\s*$/gm, '')
  await writeFile(target, content.replace(/\s+$/, ''))

  await normalizeGeneratedClient(dirname(target))
  console.log('Built product-owned live Skill UI compatibility plugin.')
}

if (isMainModule(import.meta.url)) {
  const { upstream, runtimePackages, dshLockPath, output } = parseBuilderArgs()
  await buildClient({ upstream, runtimePackages, dshLockPath, output })
}
