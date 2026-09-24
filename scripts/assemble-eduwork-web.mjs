// Assembles the EduWork local Web product from the verified Runtime cache, the
// locked external packages, local plugins, bundled skills and brand resources.
// Node.js port of assemble-eduwork-web.ps1.
import { readFile, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  childPath, copyFileTo, copyTree, copyTreePreservingLinks, ensureDir, fullPath,
  isFile, isMainModule, pathExists, readJSON, runNode, sha256File, statEntry, writeJSON, writeText,
} from './lib/build-util.mjs'
import { resolveEduworkUpstream, withUpstreamLock } from './lib/upstream.mjs'
import { installLockedDshPackage, copyDshPackagePayload } from './lib/dsh-packages.mjs'
import { copyDshBundledSkills } from './lib/dsh-skills.mjs'
import { prepareWebRuntime } from './prepare-eduwork-web-runtime.mjs'
import { provisionBuildTools } from './prepare-eduwork-build-tools.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function assembleEduworkWeb({
  coreRoot = join(scriptRoot, '..'),
  editionRoot = '',
  distributionConfig = 'config/distributions/generic.json',
  output,
  version,
  runtimeSource = '',
  runtimeMode = 'npm',
  pluginMode = 'npm',
  upstream = '',
  assemblyConfig = '',
  dshLockPath = '',
} = {}) {
  coreRoot = fullPath(coreRoot)
  editionRoot = fullPath(editionRoot || coreRoot)
  output = fullPath(output)
  if (!['npm', 'source'].includes(runtimeMode)) throw new Error('Runtime mode must be npm or source')
  if (!['npm', 'locked'].includes(pluginMode)) throw new Error('Plugin mode must be npm or locked')
  const owner = entry => {
    if (!entry.root || entry.root === 'core') return coreRoot
    if (entry.root === 'edition') return editionRoot
    throw new Error(`Unknown source root: ${entry.root}`)
  }
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version ?? '')) throw new Error('Supply an explicit build version')
  if (await pathExists(output)) throw new Error(`Assembly output already exists: ${output}`)

  const selected = await readJSON(childPath(editionRoot, distributionConfig))
  if (selected.schemaVersion !== 1) throw new Error('Unsupported distribution schema')
  let distribution
  if (selected.coreBase) {
    distribution = await readJSON(childPath(coreRoot, selected.coreBase))
    for (const key of ['id', 'brand', 'capabilities']) {
      if (Object.hasOwn(selected, key)) distribution[key] = selected[key]
    }
    for (const key of ['plugins', 'skills', 'resources', 'patches']) {
      distribution[key] = [...(distribution[key] ?? []), ...(selected[key] ?? [])]
    }
  } else {
    distribution = selected
  }
  if (!assemblyConfig) assemblyConfig = childPath(coreRoot, 'config/assembly.eduwork.json')
  if (!dshLockPath) {
    const lockFolder = runtimeMode === 'npm' ? 'release-v0.1.5-rc.2' : 'development-v0.1.5-rc.1'
    dshLockPath = childPath(coreRoot, `third_party/dsh/${lockFolder}/LOCK.json`)
  }
  const assembly = await readJSON(assemblyConfig)
  const lock = await readJSON(dshLockPath)
  upstream = await resolveEduworkUpstream(lock.commit, upstream)
  if (!runtimeSource) {
    runtimeSource = childPath(coreRoot, `dist/dsh-cache/runtime-${runtimeMode}-${lock.packageVersion}`)
    await prepareWebRuntime({ coreRoot, output: runtimeSource, upstream, dshLockPath, source: runtimeMode })
      .catch(error => { throw new Error(`Runtime preparation failed: ${error.message}`) })
  }
  runtimeSource = fullPath(runtimeSource)
  const identity = await readJSON(join(runtimeSource, '.chatecnu-dsh-runtime.json'))
  const hostPlatform = process.platform
  const hostArch = process.arch
  if (identity.dshVersion !== lock.packageVersion || identity.dshCommit !== lock.commit) {
    throw new Error('Runtime does not match the selected DSH baseline')
  }
  let runtimeLockHash
  if (runtimeMode === 'npm') {
    runtimeLockHash = identity.packageLockSHA256
    if (identity.source !== 'npm-lock' || !runtimeLockHash || runtimeLockHash !== lock.runtime.npm.packageLockSHA256) {
      throw new Error('npm mode requires the selected registry package lock; source caches are not a fallback')
    }
    if (identity.platform !== hostPlatform || identity.arch !== hostArch) {
      throw new Error('npm Runtime cache belongs to another platform or architecture')
    }
    const npmProofHash = await sha256File(join(runtimeSource, '.chatecnu-dsh-npm-install-lock.json'))
    if (npmProofHash !== runtimeLockHash) throw new Error('npm Runtime cache install proof differs from the selected lock')
  } else {
    runtimeLockHash = identity.sourceInstallLockSHA256
    if (identity.source !== 'source-release-pack' || !runtimeLockHash || runtimeLockHash !== lock.runtime.source.installLockSHA256) {
      throw new Error('Runtime does not match the selected source install lock')
    }
    const sourceProofHash = await sha256File(join(runtimeSource, '.chatecnu-dsh-source-install-lock.json'))
    if (sourceProofHash !== runtimeLockHash) throw new Error('Source Runtime cache install proof differs from the selected lock')
  }
  // Development retains the full research install; shipped products use the
  // deterministic, offline runtime projection instead of default external agents.
  const projector = childPath(coreRoot, 'scripts/project-eduwork-runtime.mjs')
  const policyHash = await sha256File(projector)
  if (!await pathExists(join(runtimeSource, '.eduwork-distribution-runtime.json'))) {
    const projected = childPath(coreRoot, `dist/dsh-cache/distribution-${hostPlatform}-${hostArch}-${runtimeLockHash.slice(0, 12)}-${policyHash.slice(0, 12)}`)
    if (!await pathExists(projected)) {
      await runNode(projector, ['--source', runtimeSource, '--output', projected])
        .catch(() => { throw new Error('Distribution Runtime projection failed') })
    }
    runtimeSource = projected
  }
  const projection = await readJSON(join(runtimeSource, '.eduwork-distribution-runtime.json'))
  if ((runtimeMode === 'npm' && projection.packageLockSHA256 !== runtimeLockHash) ||
    (runtimeMode === 'source' && projection.sourceInstallLockSHA256 !== runtimeLockHash)) {
    throw new Error('Distribution Runtime belongs to another install lock')
  }
  if (projection.policySHA256 !== policyHash || projection.platform !== hostPlatform || projection.arch !== hostArch) {
    throw new Error('Distribution Runtime uses another projection policy, platform or architecture; prepare a fresh projection from the original verified install')
  }
  const distributionProof = await sha256File(join(runtimeSource, '.eduwork-distribution-lock.json'))
  if (distributionProof !== projection.distributionLockSHA256) {
    throw new Error('Distribution Runtime lock proof differs from its receipt')
  }
  // Product UI extensions need the pinned upstream compiler workspace even when
  // the shipped Runtime is installed from npm. Its artifacts remain build inputs.
  await provisionBuildTools({ coreRoot, upstream, dshLockPath, runtimePackages: join(runtimeSource, 'node_modules') })
    .catch(error => { throw new Error(`Pinned product build tools preparation failed: ${error.message}`) })

  await ensureDir(output)
  console.log('Copying the pinned local runtime')
  const runtime = join(output, 'd')
  await copyTreePreservingLinks(runtimeSource, runtime)
  const modules = join(runtime, 'node_modules')

  const managed = {}
  for (const name of distribution.packages ?? []) {
    const entries = (assembly.externalPackages ?? []).filter(candidate => candidate.name === name)
    if (entries.length !== 1) throw new Error(`A package must select one exact lock: ${name}`)
    const entry = entries[0]
    if (pluginMode === 'npm') {
      const packageLock = await readJSON(childPath(coreRoot, entry.lock))
      if (packageLock.publicationStatus !== 'published' || !packageLock.npm?.integrity || packageLock.tarball) {
        throw new Error(`npm mode requires a published registry lock without a local tarball: ${name}`)
      }
    }
    managed[name] = await installLockedDshPackage({
      destination: childPath(modules, name),
      lockPath: childPath(coreRoot, entry.lock),
      requiredFiles: entry.requiredFiles ?? [],
    })
    if (pluginMode === 'npm' && managed[name].source !== 'npm') throw new Error(`Package was not installed from npm: ${name}`)
  }

  const selectedPlugins = [...(distribution.plugins ?? [])]
  // The skill provider lives in agent presets, rather than as a duplicate host row.
  selectedPlugins.push({ root: 'core', source: 'dsh-plugins/skill-control-native', name: '@chatecnu-work/dsh-skill-control-native' })
  const local = {}
  for (const entry of selectedPlugins) {
    if (Object.hasOwn(local, entry.name)) throw new Error(`Duplicate local plugin: ${entry.name}`)
    let pluginSource = entry.source
    if (entry.root !== 'edition') {
      const prepared = (assembly.localPlugins ?? []).filter(candidate => candidate.package === entry.name.split('/').at(-1))
      if (prepared.length !== 1) throw new Error(`Local plugin is not selected exactly once: ${entry.name}`)
      pluginSource = prepared[0].source
    }
    const source = childPath(owner(entry), pluginSource)
    const manifest = await readJSON(join(source, 'package.json'))
    if (manifest.name !== entry.name) throw new Error('Local package identity mismatch')
    const target = childPath(modules, entry.name)
    await copyDshPackagePayload(source, target)
    const builder = join(source, 'build-client.mjs')
    if (pluginSource === entry.source && await isFile(builder)) {
      const buildOutput = childPath(coreRoot, `dist/eduwork-client-builds/${randomUUID().replaceAll('-', '')}/lib`)
      // Every builder accepts the uniform option set and ignores what it does
      // not use, so the assembly can invoke them identically.
      const builderArgs = [
        '--output', buildOutput,
        '--dsh-lock', dshLockPath,
        '--upstream', upstream,
        '--runtime-packages', join(runtimeSource, 'node_modules'),
        '--artifact-services', join(modules, '@eduwork/dsh-artifact-services'),
        '--version', version,
      ]
      await withUpstreamLock(upstream, `build ${entry.name}`, async () => {
        await runNode(builder, builderArgs)
          .catch(() => { throw new Error(`Client build failed: ${entry.name}`) })
      })
      const libTarget = join(target, 'lib')
      await ensureDir(libTarget)
      for (const artifact of await readdir(buildOutput, { withFileTypes: true })) {
        if (artifact.isFile()) await copyFileTo(join(buildOutput, artifact.name), join(libTarget, artifact.name))
      }
    }
    // Record the dependencies actually supplied by this frozen assembly.
    for (const peerName of Object.keys(manifest.peerDependencies ?? {})) {
      if (peerName.startsWith('@deepseek-ai/dsh-') || peerName.startsWith('@eduwork/')) {
        const dependency = childPath(modules, `${peerName}/package.json`)
        if (await isFile(dependency)) manifest.peerDependencies[peerName] = (await readJSON(dependency)).version
      }
    }
    await writeJSON(join(target, 'package.json'), manifest)
    local[entry.name] = { version: manifest.version, source: entry.source, root: entry.root }
  }

  const skillNames = new Set()
  for (const skill of distribution.skills ?? []) {
    if (skillNames.has(skill.name)) throw new Error(`Duplicate user-facing Skill: ${skill.name}`)
    skillNames.add(skill.name)
    if (!distribution.capabilities?.images && ['artifact-images', 'ecnu-imagegen'].includes(skill.name)) {
      throw new Error('Public Skill list includes image generation')
    }
  }
  const skills = []
  for (const rootName of ['core', 'edition']) {
    const subset = (distribution.skills ?? []).filter(skill =>
      rootName === 'core' ? !skill.root || skill.root === 'core' : skill.root === 'edition')
    if (subset.length) {
      skills.push(...await copyDshBundledSkills({
        repository: rootName === 'core' ? coreRoot : editionRoot,
        packageRoot: modules,
        skillRoot: join(output, 'skills'),
        skills: subset,
      }))
    }
  }

  for (const resource of distribution.resources ?? []) {
    const source = childPath(owner(resource), resource.source)
    const target = childPath(join(output, 'resources'), resource.target)
    await ensureDir(dirname(target))
    if ((await statEntry(source))?.isDirectory()) await copyTree(source, target)
    else await copyFileTo(source, target)
  }
  if (distribution.brand?.product?.logoResource) {
    const logo = childPath(join(output, 'resources'), distribution.brand.product.logoResource)
    const mimes = { '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' }
    const mime = mimes[extname(logo).toLowerCase()]
    if (!mime) throw new Error('Brand logo must be SVG, PNG or WebP')
    const bytes = await readFile(logo)
    if (bytes.length > 262144) throw new Error('Brand logo exceeds 256 KiB')
    distribution.brand.product.logoUrl = `data:${mime};base64,${bytes.toString('base64')}`
    delete distribution.brand.product.logoResource
  }

  const presets = join(runtime, 'presets')
  await copyTree(join(modules, '@deepseek-ai/dsh-agent-presets/presets'), presets)
  const skillSeat = await readFile(childPath(coreRoot, 'dsh-presets/skill-control.agent.cordis.yml'), 'utf8')
  const patchPreset = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await patchPreset(path)
      else if (entry.isFile() && entry.name === 'agent.cordis.yml') {
        const text = (await readFile(path, 'utf8')).replace(
          /- id: skill-filesystem\r?\n {2}name: '@deepseek-ai\/dsh-skill-filesystem'(?:\r?\n {2}config:)?/g,
          () => skillSeat.replace(/\s+$/, ''),
        )
        await writeText(path, text)
      }
    }
  }
  await patchPreset(presets)

  await runNode(childPath(coreRoot, 'scripts/configure-product-concurrency.mjs'), [runtime])
    .catch(() => { throw new Error('Built-in workflow concurrency configuration failed') })

  const bundle = join(modules, '@eduwork/web-composition')
  await ensureDir(bundle)
  const bundleDependencies = {}
  for (const packageName of Object.keys(local)) bundleDependencies[packageName] = local[packageName].version
  await writeJSON(join(bundle, 'package.json'), {
    name: '@eduwork/web-composition',
    version,
    private: true,
    type: 'module',
    dependencies: bundleDependencies,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  })
  await writeText(join(bundle, 'cordis.patch.yml'), [
    '- id: agent-presets',
    '  config:',
    '    default: standard',
    '    includeShippedRoot: false',
    '    includeUserRoot: true',
    '    roots:',
    '      - path: !!js process.env.DSH_PRODUCT_PRESET_DIR',
    '        trust: system',
  ].join('\n'))

  // Runtime credentials are supplied through a private launch profile, never baked
  // into this immutable artifact. The same public OIDC package handles both editions.
  const insert = [
    { id: 'eduwork-artifact-services', name: '@eduwork/dsh-artifact-services/dsh', config: { skills: false, images: { enabled: false } } },
    { id: 'eduwork-knowledge-studio', name: '@eduwork/dsh-knowledge-studio', config: { skills: false } },
    { id: 'enterprise-oidc', name: '@eduwork/dsh-oidc', config: { backend: 'web', uiMode: 'standard', profilePathEnv: 'EDUWORK_OIDC_PROFILE', allowEmptyProfiles: true } },
  ]
  for (const plugin of distribution.plugins ?? []) {
    const config = plugin.source === 'dsh-plugins/brand-settings-native' ? distribution.brand : plugin.config ?? {}
    insert.push({ id: plugin.id, name: plugin.name, config })
  }
  const composition = [...(distribution.patches ?? []), { insert }]
  await writeJSON(join(output, 'composition.json'), composition)

  await writeJSON(join(output, 'assembly.json'), {
    schemaVersion: 1,
    kind: 'eduwork-web',
    version,
    distribution: distribution.id,
    brand: distribution.brand,
    capabilities: distribution.capabilities,
    dshVersion: lock.packageVersion,
    dshCommit: lock.commit,
    runtimeMode,
    pluginMode,
    runtimeLockSHA256: runtimeLockHash,
    distributionRuntimeLockSHA256: projection.distributionLockSHA256,
    managedPackages: managed,
    localPlugins: local,
    skills,
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@eduwork/web-composition', '@eduwork/dsh-mail', '@eduwork/dsh-memory', '@shlv/dsh-literature'],
    assembledAt: new Date().toISOString(),
    published: false,
  })
  console.log(`EduWork local Web assembly ready: ${output}`)
  return output
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'core-root': { type: 'string' },
      'edition-root': { type: 'string' },
      'distribution-config': { type: 'string' },
      output: { type: 'string' },
      version: { type: 'string' },
      'runtime-source': { type: 'string' },
      'runtime-mode': { type: 'string' },
      'plugin-mode': { type: 'string' },
      upstream: { type: 'string' },
      'assembly-config': { type: 'string' },
      'dsh-lock': { type: 'string' },
    },
  })
  if (!values.output || !values.version) {
    throw new Error('Use --output <directory> --version <x.y.z[-suffix]> [--core-root <repo>] [--edition-root <root>] [--distribution-config <json>] [--runtime-source <cache>] [--runtime-mode npm|source] [--plugin-mode npm|locked] [--upstream <cache>] [--assembly-config <json>] [--dsh-lock <LOCK.json>]')
  }
  await assembleEduworkWeb({
    ...(values['core-root'] ? { coreRoot: values['core-root'] } : {}),
    editionRoot: values['edition-root'] ?? '',
    distributionConfig: values['distribution-config'] ?? 'config/distributions/generic.json',
    output: values.output,
    version: values.version,
    runtimeSource: values['runtime-source'] ?? '',
    runtimeMode: values['runtime-mode'] ?? 'npm',
    pluginMode: values['plugin-mode'] ?? 'npm',
    upstream: values.upstream ?? '',
    assemblyConfig: values['assembly-config'] ?? '',
    dshLockPath: values['dsh-lock'] ?? '',
  })
}
