// Unpublished qualification product. Never accepted by the release npm path.
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises'
import { copyProductTree as cp } from './portable-product-links.mjs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { installProductHost } from '../dsh-host/install-product-host.mjs'
import { verifyMediaTemplate } from './verify-media-template.mjs'
import { copySourceSkills } from './copy-source-skills.mjs'
import { patchSessionSearchRuntime } from './patch-session-search-runtime.mjs'
import assert from 'node:assert/strict'

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
if (receipt.dshVersion !== '0.2.0-rc.2' || receipt.dshCommit !== '639ed015397290b3745d163aafe02ffee4aa3f84') throw new Error('Unqualified candidate Runtime')
const distribution = await json(join(paths.source, 'config/distributions/generic.json'))
const sourceMediaTemplate = await verifyMediaTemplate(join(paths.source, 'packages/dsh-knowledge-studio/packages/artifact-services'))
const literatureLock = await json(join(repository, 'third_party/dsh/candidate-v0.2.0-rc.2/literature.json'))
const literatureManifest = await json(join(paths.dependencies, 'node_modules', literatureLock.name, 'package.json'))
const productDependencyLock = await json(join(paths.dependencies, 'package-lock.json'))
assert.equal(literatureLock.publicationStatus, 'published')
assert.equal(literatureManifest.name, literatureLock.name)
assert.equal(literatureManifest.version, literatureLock.version)
assert.equal(productDependencyLock.packages['node_modules/' + literatureLock.name]?.integrity, literatureLock.npm.integrity)
await mkdir(paths.output)
console.log('Copying candidate Runtime into the isolated source product')
await cp(paths.runtime, join(paths.output, 'd'), { recursive: true })
const modules = join(paths.output, 'd/node_modules')
const runtimePatches = [await patchSessionSearchRuntime(modules)]
const exists = async path => access(path).then(() => true, () => false)
// Supplement only packages absent from the verified Runtime. These dependencies
// come from source-probe's lock, and this output is explicitly not a release.
const copyDependency = async name => {
  if (!await exists(join(modules, name))) await cp(join(paths.dependencies, 'node_modules', name), join(modules, name), { recursive: true })
}
for (const entry of await readdir(join(paths.dependencies, 'node_modules'), { withFileTypes: true })) {
  if (entry.name.startsWith('.')) continue
  if (entry.name.startsWith('@')) for (const item of await readdir(join(paths.dependencies, 'node_modules', entry.name))) await copyDependency(`${entry.name}/${item}`)
  else await copyDependency(entry.name)
}
const sourceFolders = [...distribution.plugins.map(row => row.source), 'dsh-plugins/skill-control-native',
  ...['dsh-mail', 'dsh-memory', 'dsh-oidc', 'dsh-knowledge-studio'].map(name => 'packages/' + name),
  'packages/dsh-knowledge-studio/packages/artifact-services']
const sourcePackages = []
for (const folder of new Set(sourceFolders)) {
  const source = join(paths.source, folder), manifest = await json(join(source, 'package.json'))
  if (await exists(join(modules, manifest.name))) throw new Error(`Refusing to replace an existing Runtime package: ${manifest.name}`)
  await cp(source, join(modules, manifest.name), { recursive: true })
  sourcePackages.push(manifest.name)
}
const mediaTemplate = await verifyMediaTemplate(join(modules, '@eduwork/dsh-artifact-services'))
if (mediaTemplate.sha256 !== sourceMediaTemplate.sha256) throw new Error('Assembled media template differs from the source build')
await cp(join(repository, 'config/desktop'), join(paths.output, 'resources/desktop'), { recursive: true })
await copySourceSkills({ repository, packages: modules, skills: distribution.skills, output: join(paths.output, 'skills') })
const insert = [
  { id: 'eduwork-artifact-services', name: '@eduwork/dsh-artifact-services/dsh', config: { skills: false, images: { enabled: false } } },
  { id: 'eduwork-knowledge-studio', name: '@eduwork/dsh-knowledge-studio', config: { skills: false } },
  { id: 'enterprise-oidc', name: '@eduwork/dsh-oidc', config: { backend: 'desktop', allowEmptyProfiles: true, profilePathEnv: 'EDUWORK_OIDC_PROFILE' } },
  ...distribution.plugins.map(row => ({ id: row.id, name: row.name, config: row.source === 'dsh-plugins/brand-settings-native' ? distribution.brand : row.config ?? {} })),
]
const exclusions = ['session-log-deepseek', 'deepseek-account', 'account-controller', 'ui-settings-account', 'plugin-package-inventory-deepseek'].map(id => ({ id, disabled: true }))
const composition = [...distribution.patches, ...exclusions, { insert }]
// Memory's published bundle retains its old entry ID; the candidate uses the
// stable settings namespace as the native entry identity.
const memoryBundle = join(modules, '@eduwork/dsh-memory/cordis.patch.yml')
await writeFile(memoryBundle, (await readFile(memoryBundle, 'utf8')).replace('id: local-memory\n', 'id: memories\n').replace('id: local-memory\r\n', 'id: memories\n'))
const identity = { schemaVersion: 1, kind: 'eduwork-web', version: '0.0.0-dev.pinned.dsh', distribution: distribution.id,
  brand: distribution.brand, capabilities: distribution.capabilities, dshVersion: receipt.dshVersion, dshCommit: receipt.dshCommit,
  runtimeMode: 'npm', runtimePatches, pluginMode: 'source-qualification', published: false,
  bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@eduwork/dsh-mail', '@eduwork/dsh-memory', '@eduwork/dsh-literature'],
  sourcePackages, externalPackages: [literatureLock], omittedPackages: [], nativeResources: 'not-bundled', mediaTemplate,
}
await writeFile(join(paths.output, 'assembly.json'), JSON.stringify(identity, null, 2) + '\n')
await writeFile(join(paths.output, 'composition.json'), JSON.stringify(composition, null, 2) + '\n')
await installProductHost({ product: paths.output, adapter: paths.host })
const runtimeManifestPath = join(paths.output, 'd/package.json')
const runtimeManifest = await json(runtimeManifestPath)
const installed = await json(join(paths.output, 'assembly.json'))
for (const name of [...sourcePackages, literatureLock.name, ...Object.keys(installed.desktopHost.nativePlugins)]) {
  const manifest = await json(join(modules, name, 'package.json'))
  runtimeManifest.dependencies[name] = manifest.version
}
runtimeManifest.name = 'eduwork-source-qualification-runtime'
runtimeManifest.private = true
await writeFile(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + '\n')
console.log('Source qualification product prepared. No update feed or release was published.')
