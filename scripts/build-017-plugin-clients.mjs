// Explicit source qualification build. This does not publish npm artifacts or
// change the release assembly's dependency locks.
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile, cp, copyFile, readdir } from 'node:fs/promises'
import { join, resolve, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { adaptNativePresetUI } from './native-preset-ui.mjs'
import { releaseIdentity } from '../dsh-host/release-policy.mjs'

const { values } = parseArgs({ options: { runtime: { type: 'string' }, dependencies: { type: 'string' }, report: { type: 'string' }, output: { type: 'string' } } })
if (!values.runtime || !values.dependencies || !values.report || !values.output) throw new Error('Use --runtime <candidate> --dependencies <isolated dependencies> --output <new directory> --report <path>')
const sourceRepository = fileURLToPath(new URL('../', import.meta.url))
const repository = resolve(values.output)
const pathFromSource = relative(sourceRepository, repository)
if (!pathFromSource.startsWith('..' + sep) && !/^[A-Za-z]:/.test(pathFromSource)) throw new Error('Qualification output must stay outside the source checkout')
const runtime = resolve(values.runtime), dependencies = resolve(values.dependencies)
const require = createRequire(join(runtime, 'package.json'))
const runtimeReceipt = JSON.parse(await readFile(join(runtime, '.chatecnu-dsh-runtime.json'), 'utf8'))
if (runtimeReceipt.dshVersion !== '0.1.7-rc.1' || runtimeReceipt.dshCommit !== '46a7f68b0922371ce7144b668b90e377d8e799f4') throw new Error('This build requires the pinned candidate Runtime')
await mkdir(repository)
// Copy the maintained plugin source into a disposable qualification tree.
// Candidate bundles never overwrite the default-version checked-in clients.
for (const folder of ['dsh-plugins', 'config/distributions', 'packages/dsh-mail', 'packages/dsh-memory', 'packages/dsh-oidc', 'packages/dsh-knowledge-studio']) {
  await cp(join(sourceRepository, folder), join(repository, folder), { recursive: true,
    filter: path => !relative(sourceRepository, path).split(/[\\/]/).some(part => ['node_modules', '.git', 'test', 'tests', '.research'].includes(part)),
  })
}
const { build } = require('esbuild')
const { transform: transformCSS } = require('lightningcss')
const sharedRoot = join(repository, 'packages/dsh-knowledge-studio/packages/artifact-services')
const shared = JSON.parse(await readFile(join(sharedRoot, 'package.json'), 'utf8'))
const sharedAliases = Object.fromEntries(Object.entries(shared.exports).map(([key, path]) => [shared.name + (key === '.' ? '' : key.slice(1)), join(sharedRoot, path)]))
const report = { scope: 'source candidate client bundles; unpublished', dshVersion: runtimeReceipt.dshVersion, packages: [] }
// These are separately rebuilt, private candidate artifacts. Their DSH peers
// describe this target, not the default-version npm builds in the source tree.
// Do not rewrite third-party manifests or grant compatibility exemptions.
report.manifests = []
async function prepareCandidateManifests(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await prepareCandidateManifests(path)
    else if (entry.name === 'package.json') {
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      if (!/^@(eduwork|chatecnu-work)\//.test(manifest.name ?? '')) continue
      const originalPeers = { ...manifest.peerDependencies }
      for (const name of Object.keys(manifest.peerDependencies ?? {})) {
        if (/^@deepseek-ai\/dsh(?:-|$)/.test(name)) manifest.peerDependencies[name] = runtimeReceipt.dshVersion
      }
      manifest.private = true
      await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
      report.manifests.push({ name: manifest.name, originalPeers, targetPeers: manifest.peerDependencies ?? {} })
    }
  }
}
for (const directory of ['dsh-plugins', 'packages']) await prepareCandidateManifests(join(repository, directory))
// Memory's maintained build copies its JS Host modules verbatim. Studio's PDF
// runtime is generated separately and is required for real document indexing.
for (const folder of ['dsh-memory', 'dsh-mail', 'dsh-oidc']) {
  const root = join(repository, 'packages', folder)
  await cp(join(root, 'src/host'), join(root, 'lib'), { recursive: true })
}
await build({ entryPoints: [join(repository, 'packages/dsh-knowledge-studio/src/host/pdf-runtime.ts')],
  outfile: join(repository, 'packages/dsh-knowledge-studio/lib/pdf-runtime.js'), bundle: true, platform: 'node',
  format: 'esm', target: 'node24', nodePaths: [join(dependencies, 'node_modules'), join(runtime, 'node_modules')],
})
const clients = Object.entries({ 'dsh-mail': 'index.tsx', 'dsh-memory': 'index.ts', 'dsh-oidc': 'index.ts', 'dsh-knowledge-studio': 'index.tsx' })
  .map(([folder, entry]) => [`packages/${folder}`, `src/client/${entry}`])
for (const folder of ['client-ui-branding', 'client-ui-component-inventory', 'activity-insights-native', 'workbench-native', 'client-ui-media-artifacts']) {
  clients.push([`dsh-plugins/${folder}`, folder === 'workbench-native' ? 'src/client.ts' : folder === 'client-ui-media-artifacts' ? 'src/client/native.js' : 'src/client/index.ts'])
}
const localAliases = { ...sharedAliases }
for (const folder of ['skill-manager-native', 'skill-settings-native', 'component-inventory-native', 'plugin-manager-native', 'artifact-preview-native']) {
  const root = join(repository, 'dsh-plugins', folder)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  for (const [key, path] of Object.entries(manifest.exports ?? {})) {
    if (typeof path === 'string') localAliases[manifest.name + (key === '.' ? '' : key.slice(1))] = join(root, path)
  }
}
for (const [folder, entry] of clients) {
  const root = join(repository, folder)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  await mkdir(join(root, 'lib'), { recursive: true })
  const result = await build({
    absWorkingDir: root, entryPoints: [entry], outfile: 'lib/client.js', bundle: true,
    platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic', minify: true, metafile: true,
    nodePaths: [join(runtime, 'node_modules'), join(dependencies, 'node_modules')],
    external: ['react', 'react/*', 'react-dom', 'react-dom/*', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit'],
    define: { 'process.env.NODE_ENV': '"production"', __EDUWORK_NATIVE_017__: 'true' },
    alias: { ...localAliases, ...(folder === 'packages/dsh-knowledge-studio' ? Object.fromEntries(['process', 'path', 'url'].map(name => [`node:${name}`, join(root, `src/client/shims/${name}.ts`)])) : {}) },
    // ModuleLoader fetches one JS artifact. Embed module CSS just as the
    // official compiler does, with stable per-plugin class names.
    plugins: [{ name: 'native-module-css', setup(builder) {
      builder.onLoad({ filter: /\.module\.css$/ }, async ({ path }) => {
        const id = manifest.name + '/' + relative(root, path).split(sep).join('/')
        const css = transformCSS({ filename: id, code: await readFile(path), cssModules: true, minify: true })
        const classes = Object.fromEntries(Object.entries(css.exports).map(([key, value]) => [key, [value.name, ...value.composes.map(item => item.name)].join(' ')]))
        return { loader: 'js', contents: `const id=${JSON.stringify(id)}, css=${JSON.stringify(css.code.toString())};
          if(typeof document!=='undefined'){let tag=document.querySelector('style[data-plugin-css='+JSON.stringify(id)+']');if(!tag){tag=document.createElement('style');tag.dataset.pluginCss=id;document.head.append(tag)}tag.textContent=css}
          export default ${JSON.stringify(classes)};` }
      })
    } }],
    banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
    footer: { js: `const original = module.exports; return { ...original, async apply(...args) { try { return await original.apply(...args); } catch (error) { console.error(${JSON.stringify(manifest.name)}, error?.stack || String(error)); throw error; } } }; } });` },
  })
  report.packages.push({ name: manifest.name, output: join(root, 'lib/client.js'), inputs: Object.keys(result.metafile.inputs).length })
  console.log(`Built ${manifest.name}`)
}
// Rebase the three product UI derivatives onto the exact candidate artifacts.
// The old controller implementations must not leak into the new client.
for (const [folder, upstream] of [
  ['client-ui-conversation-brand', 'ui-conversation'],
  ['client-ui-agent-preset-product', 'ui-agent-preset'],
  ['client-ui-skill-live', 'ui-skill'],
]) {
  const root = join(repository, 'dsh-plugins', folder)
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const upstreamName = `@deepseek-ai/dsh-client-${upstream}`
  const upstreamRoot = join(runtime, 'node_modules', upstreamName)
  const sourceManifest = JSON.parse(await readFile(join(upstreamRoot, 'package.json'), 'utf8'))
  if (sourceManifest.version !== runtimeReceipt.dshVersion) throw new Error(`Unqualified client: ${upstreamName}`)
  let client = await readFile(join(upstreamRoot, 'lib/client.js'), 'utf8')
  if (!client.includes(upstreamName)) throw new Error(`Client identity is missing: ${upstreamName}`)
  client = client.replaceAll(upstreamName, manifest.name)
  const replaceOnce = (from, to) => {
    if (client.split(from).length !== 2) throw new Error(`Candidate UI anchor changed: ${upstreamName}: ${from}`)
    client = client.replace(from, to)
  }
  if (upstream === 'ui-conversation') {
    const badge = releaseIdentity('0.0.0-dev.core.17', runtimeReceipt.dshVersion).badge
    replaceOnce('"hero.headline": "探索未至之境"', '"hero.headline": "今天想一起完成什么？"')
    replaceOnce('"hero.headline": "Into the Unknown"', '"hero.headline": "What shall we accomplish today?"')
    replaceOnce('"hero.preview": "预览版"', '"hero.preview": ' + JSON.stringify(badge.zh))
    replaceOnce('"hero.preview": "Preview"', '"hero.preview": ' + JSON.stringify(badge.en))
  }
  if (upstream === 'ui-skill') {
    replaceOnce('ctx.on("connection/reset", clearAll);', 'ctx.on("connection/reset", clearAll);\nctx.remote.$on("settings/document-updated", clearAll);')
  }
  if (upstream === 'ui-agent-preset') client = adaptNativePresetUI(client)
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'lib/client.js'), client)
  await copyFile(join(upstreamRoot, 'lib/index.js'), join(root, 'lib/index.js'))
  report.packages.push({ name: manifest.name, upstream: upstreamName, version: sourceManifest.version })
}
await writeFile(resolve(values.report), JSON.stringify(report, null, 2) + '\n')
