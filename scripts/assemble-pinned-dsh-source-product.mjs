// Assemble locked npm plugins with the product-owned desktop extensions.
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises'
import { copyProductTree as cp } from './portable-product-links.mjs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { installProductHost } from '../dsh-host/install-product-host.mjs'
import { verifyMediaTemplate } from './verify-media-template.mjs'
import { copySourceSkills } from './copy-source-skills.mjs'
import { loadDistributionBundleLayers, mergeDistributionConfigPatches } from './distribution-config-patches.mjs'
import { patchSessionSearchRuntime } from './patch-session-search-runtime.mjs'
import { patchSettingsNavigationRuntime } from './patch-settings-navigation-runtime.mjs'
import { patchRemotionBundlerRuntime } from './patch-remotion-bundler-runtime.mjs'
import { omitRuntimePackages } from './omit-runtime-packages.mjs'
import { patchRemotionRendererRuntime } from './patch-remotion-renderer-runtime.mjs'
import { readPublishedPackageLocks, verifyPublishedPackageInputs, publishedPackageFiles, verifyPublishedPackageFiles } from './published-package-inputs.mjs'
import { pinnedDshDirectory, verifyPinnedDshReceipt } from './pinned-dsh-contract.mjs'

const { values } = parseArgs({ options: Object.fromEntries(['runtime', 'source', 'dependencies', 'host', 'output'].map(key => [key, { type: 'string' }])) })
if (Object.values(values).length !== 5) throw new Error('Use --runtime --source --dependencies --host --output with separate qualification directories')
const repository = fileURLToPath(new URL('../', import.meta.url))
const paths = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, resolve(value)]))
const inside = (root, child) => { const path = relative(root, child); return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) }
for (const source of [repository, paths.runtime, paths.source, paths.dependencies, paths.host]) {
  if (inside(source, paths.output) || inside(paths.output, source)) throw new Error('Source qualification output must be separate from every input')
}
const json = async file => JSON.parse(await readFile(file, 'utf8'))
const receipt = await json(join(paths.runtime, '.chatecnu-dsh-runtime.json'))
verifyPinnedDshReceipt(receipt)
const distribution = await json(join(paths.source, 'config/distributions/generic.json'))
const sourceMediaTemplate = await verifyMediaTemplate(join(paths.dependencies, 'node_modules/@eduwork/dsh-artifact-services'))
const publishedLocks = await readPublishedPackageLocks(pinnedDshDirectory)
await verifyPublishedPackageInputs({ locks: publishedLocks, dependencies: paths.dependencies, runtime: paths.runtime })
const publishedFiles = await publishedPackageFiles(publishedLocks, join(paths.dependencies, 'node_modules'))
const pluginInstallLock = await readFile(join(paths.dependencies, 'package-lock.json'))
await mkdir(paths.output)
console.log('Copying candidate Runtime into the isolated source product')
await cp(paths.runtime, join(paths.output, 'd'), { recursive: true })
await writeFile(join(paths.output, 'd/.eduwork-plugin-install-lock.json'), pluginInstallLock)
const modules = join(paths.output, 'd/node_modules')
const runtimePatches = [await patchSessionSearchRuntime(modules), await patchSettingsNavigationRuntime(modules), ...await patchRemotionBundlerRuntime(modules), ...await patchRemotionRendererRuntime(modules)]
const exists = async path => access(path).then(() => true, () => false)
// Supplement only packages absent from the verified Runtime. These dependencies
// come from source-probe's npm lock. Published plugin bytes must remain unchanged.
const copyDependency = async name => {
  if (!await exists(join(modules, name))) await cp(join(paths.dependencies, 'node_modules', name), join(modules, name), { recursive: true })
}
for (const entry of await readdir(join(paths.dependencies, 'node_modules'), { withFileTypes: true })) {
  if (entry.name.startsWith('.')) continue
  if (entry.name.startsWith('@')) for (const item of await readdir(join(paths.dependencies, 'node_modules', entry.name))) await copyDependency(`${entry.name}/${item}`)
  else await copyDependency(entry.name)
}
// Published packages were copied from the locked npm dependencies above.
// Never rebuild or overwrite them with workspace source.
const sourceFolders = [...distribution.plugins.map(row => row.source), 'dsh-plugins/skill-control-native']
const sourcePackages = []
for (const folder of new Set(sourceFolders)) {
  const source = join(paths.source, folder), manifest = await json(join(source, 'package.json'))
  if (await exists(join(modules, manifest.name))) throw new Error(`Refusing to replace an existing Runtime package: ${manifest.name}`)
  await cp(source, join(modules, manifest.name), { recursive: true })
  sourcePackages.push(manifest.name)
}
const mediaTemplate = await verifyMediaTemplate(join(modules, '@eduwork/dsh-artifact-services'))
if (mediaTemplate.sha256 !== sourceMediaTemplate.sha256) throw new Error('Assembled media template differs from the published package')
await cp(join(repository, 'config/desktop'), join(paths.output, 'resources/desktop'), { recursive: true })
await copySourceSkills({ repository, packages: modules, skills: distribution.skills, output: join(paths.output, 'skills') })
const insert = [
  { id: 'eduwork-artifact-services', name: '@eduwork/dsh-artifact-services/dsh', config: { skills: false, images: { enabled: false } } },
  { id: 'eduwork-knowledge-studio', name: '@eduwork/dsh-knowledge-studio', config: { skills: false } },
  { id: 'enterprise-oidc', name: '@eduwork/dsh-oidc', config: { backend: 'desktop', allowEmptyProfiles: true, profilePathEnv: 'EDUWORK_OIDC_PROFILE' } },
  ...distribution.plugins.map(row => ({ id: row.id, name: row.name, config: row.source === 'dsh-plugins/brand-settings-native' ? distribution.brand : row.config ?? {} })),
]
const exclusions = ['session-log-deepseek', 'deepseek-account', 'account-controller', 'ui-settings-account', 'plugin-package-inventory-deepseek'].map(id => ({ id, disabled: true }))
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@eduwork/dsh-mail', '@eduwork/dsh-memory', '@eduwork/dsh-literature']
const require = createRequire(join(paths.output, 'd/package.json'))
const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href)
const lowerLayers = await loadDistributionBundleLayers(join(paths.output, 'd'), bundles, boot)
const composition = [...mergeDistributionConfigPatches([{ insert }], distribution.patches, boot.composeEntries, lowerLayers), ...exclusions]
const identity = { schemaVersion: 1, kind: 'eduwork-web', version: '0.0.0-dev.pinned.dsh', distribution: distribution.id,
  brand: distribution.brand, capabilities: distribution.capabilities, dshVersion: receipt.dshVersion, dshCommit: receipt.dshCommit,
  runtimeMode: 'npm', runtimePatches, pluginMode: 'npm', published: false,
  bundles,
  sourcePackages, externalPackages: publishedLocks, publishedPackageFiles: publishedFiles,
  pluginInstallLockSHA256: createHash('sha256').update(pluginInstallLock).digest('hex'),
  omittedPackages: [], nativeResources: 'not-bundled', mediaTemplate,
}
await writeFile(join(paths.output, 'assembly.json'), JSON.stringify(identity, null, 2) + '\n')
await writeFile(join(paths.output, 'composition.json'), JSON.stringify(composition, null, 2) + '\n')
await installProductHost({ product: paths.output, adapter: paths.host })
const dependencyManifest = await json(join(paths.dependencies, 'package.json'))
const omitted = await omitRuntimePackages(join(paths.output, 'd'), Object.keys({ ...dependencyManifest.dependencies, ...dependencyManifest.optionalDependencies }))
console.log(`Omitted ${omitted.packages.length} unused Runtime packages (${(omitted.bytes / 2 ** 20).toFixed(1)} MiB)`)
const runtimeManifestPath = join(paths.output, 'd/package.json')
const runtimeManifest = await json(runtimeManifestPath)
const installed = await json(join(paths.output, 'assembly.json'))
installed.omittedPackages = omitted.packages
await writeFile(join(paths.output, 'assembly.json'), JSON.stringify(installed, null, 2) + '\n')
for (const name of [...sourcePackages, ...publishedLocks.map(lock => lock.name), ...Object.keys(installed.desktopHost.nativePlugins)]) {
  const manifest = await json(join(modules, name, 'package.json'))
  runtimeManifest.dependencies[name] = manifest.version
}
runtimeManifest.name = 'eduwork-product-runtime'
runtimeManifest.private = true
await writeFile(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + '\n')
await verifyPublishedPackageFiles(publishedFiles, modules)
console.log('Product prepared from locked npm plugins and product extensions. No release was published.')
