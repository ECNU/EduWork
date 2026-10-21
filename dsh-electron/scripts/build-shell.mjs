import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { adaptNativeDesktopSource } from './native-desktop-source.mjs'
import { adaptHostQuit } from './host-quit-adaptation.mjs'
import { pinnedDshContract } from '../../scripts/pinned-dsh-contract.mjs'

const { values } = parseArgs({ options: { upstream: { type: 'string' }, host: { type: 'string' }, output: { type: 'string' }, runtime: { type: 'string' }, 'pinned-dsh-source': { type: 'boolean' } } })
if (!values['pinned-dsh-source']) throw new Error('The legacy Electron shell build is retired. Use --pinned-dsh-source with --runtime, or scripts/local-desktop-pipeline.mjs. See docs/BUILD.md.')
if (!values.upstream || !values.host || !values.output) throw new Error('Use --upstream <pinned source> --host <prepared host> --output <new directory> --pinned-dsh-source --runtime <pinned npm Runtime>')
const upstream = resolve(values.upstream), output = resolve(values.output), host = resolve(values.host)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (!values.runtime) throw new Error('The native shell requires --runtime <pinned npm Runtime>')
const lock = pinnedDshContract
const coreLock = lock
const digest = data => createHash('sha256').update(data).digest('hex')
const inputs = JSON.parse(await readFile(join(repository, 'dsh-electron/upstream-inputs-pinned-source.json'), 'utf8'))
const hostReceipt = JSON.parse(await readFile(join(host, 'receipt.json'), 'utf8'))
if (hostReceipt.upstreamCommit !== coreLock.commit) throw new Error('Host and selected core commits differ')
for (const name of ['host-process.mjs', 'node-environment.mjs', 'web-document.mjs', 'redacted-log.mjs']) {
  if (digest(await readFile(join(host, name))) !== hostReceipt.outputs[name]) throw new Error('Prepared Host bytes differ from receipt')
}
const source = async path => {
  const bytes = await readFile(join(upstream, path))
  if (digest(bytes) !== inputs[path]) throw new Error('Pinned Electron source hash mismatch: ' + path)
  return bytes
}
const files = Object.keys(inputs).filter(path => path !== 'apps/desktop/package.json')
await mkdir(output, { recursive: false })
const rows = []
for (const file of files) {
  const before = await source(file)
  let text = before.toString('utf8')
  text = adaptNativeDesktopSource(file, text)
  if (file === 'apps/desktop/src/preload-app.ts') { text += '\n' + await readFile(join(repository, 'dsh-electron/src/dock-theme-preload.cjs'), 'utf8') + '\n' + await readFile(join(repository, 'dsh-electron/src/boot-motion-preload.cjs'), 'utf8'); text += '\n' + await readFile(join(repository, 'dsh-electron/src/boot-brand-preload.cjs'), 'utf8') }
  const target = join(output, file.slice('apps/desktop/'.length))
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, text)
  rows.push({ path: file, originalSHA256: digest(before), derivedSHA256: digest(text), changed: !before.equals(Buffer.from(text)) })
}
const electronAdapters = ['runtime-access.mjs', 'workspace-access.mjs', 'update-channel-migration.mjs', 'alpha-update-migration.mjs', 'desktop-brand.mjs', 'desktop-exit.mjs', 'quit-confirmation.mjs', 'task-notifications.mjs', 'update-coordinator.mjs', 'mac-sparkle-updates.mjs', 'portable-updates.mjs', 'software-update-control.mjs', 'startup-failure.mjs', 'startup-page.mjs', 'desktop-web-paths.mjs', 'startup-presentation.mjs', 'native-vault.mjs', 'product.mjs', 'window-visibility.mjs', 'desktop-menu.mjs', 'installer-cleanup.mjs', 'desktop-restart.mjs', 'lifecycle.mjs', 'media-transport.mjs', 'configuration-files.mjs', 'configuration-policy.mjs', 'desktop-paths.mjs', 'initialize-user-config.mjs', 'legacy-migration.mjs', 'external-navigation.mjs', 'directory-picker.mjs', 'host-git-identity.mjs', 'desktop-pet.mjs', 'desktop-pet-core.mjs']
for (const name of electronAdapters) await copyFile(join(repository, 'dsh-electron/src', name), join(output, 'src', name))
await copyFile(join(repository, 'dsh-host/product-profile.mjs'), join(output, 'src/product-profile.mjs'))
await writeFile(join(output,'src/alpha-update-migration.mjs'), (await readFile(join(output,'src/alpha-update-migration.mjs'),'utf8'))
  .replace('../../dsh-host/configuration-file.mjs','./configuration-file.mjs')
  .replace('../../dsh-host/dsh-compatibility.mjs','./dsh-compatibility.mjs'))
for (const name of ['native-profile.mjs', 'settings-migration.mjs']) await copyFile(join(repository, 'dsh-host', name), join(output, 'src', name))
await copyFile(join(repository, 'dsh-host/product-presets.mjs'), join(output, 'src/product-presets.mjs'))
await copyFile(join(repository, 'dsh-host/native-resources.mjs'), join(output, 'src/native-resources.mjs'))
for (const name of ['user-config.mjs', 'configuration-file.mjs', 'configuration-documentation.mjs', 'configuration-reference.mjs', 'configuration-plugin-options.mjs', 'content-updates.mjs', 'content-update-protocol.mjs', 'publisher-bootstrap.mjs', 'dsh-compatibility.mjs']) await copyFile(join(repository, 'dsh-host', name), join(output, 'src', name))
await copyFile(join(repository, 'dsh-plugins/media-openai/lib/config.js'), join(output, 'src/media-config.mjs'))
await copyFile(join(repository, 'dsh-host/enterprise-model-updates.mjs'), join(output, 'src/enterprise-model-updates.mjs'))
await copyFile(join(repository, 'dsh-host/desktop-updates.mjs'), join(output, 'src/desktop-updates.mjs'))
await copyFile(join(repository, 'dsh-host/release-policy.mjs'), join(output, 'src/release-policy.mjs'))
await copyFile(join(repository, 'dsh-host/workbench-support.mjs'), join(output, 'src/workbench-support.mjs'))
await copyFile(join(repository, 'dsh-host/diagnostics.mjs'), join(output, 'src/diagnostics.mjs'))
await copyFile(join(repository, 'dsh-host/desktop-log.mjs'), join(output, 'src/desktop-log.mjs'))
const vendor = 'vendor/jsonc-parser'
await mkdir(join(output, 'src', vendor), { recursive: true })
for (const name of ['parser.js', 'scanner.js', 'string-intern.js', 'package.json', 'LICENSE.md', 'README.md']) await copyFile(join(repository, 'dsh-host', vendor, name), join(output, 'src', vendor, name))
{
  await writeFile(join(output, 'src/eduwork-native-host-process.mjs'), adaptHostQuit(await readFile(join(host, 'host-process.mjs'), 'utf8')))
  for (const name of ['node-environment.mjs', 'web-document.mjs', 'redacted-log.mjs']) await copyFile(join(host, name), join(output, 'src', name))
  await copyFile(join(repository, 'dsh-electron/src/native-web-host.mjs'), join(output, 'src/eduwork-host-process.mjs'))
  for (const name of ['desktop-main.mjs', 'automation-browser.mjs', 'native-desktop.mjs', 'native-desktop-bridge.mjs']) await copyFile(join(repository, 'dsh-electron/src', name), join(output, 'src', name))
}
await copyFile(join(host, 'LICENSE-DeepSeek'), join(output, 'LICENSE-DeepSeek'))
const manifest = JSON.parse(await source('apps/desktop/package.json'))
await writeFile(join(output, 'package.json'), JSON.stringify({ ...manifest, name: '@eduwork/desktop-electron', scripts: {}, devDependencies: {} }, null, 2))
{
  const runtime = resolve(values.runtime)
  const runtimeReceipt = JSON.parse(await readFile(join(runtime, '.chatecnu-dsh-runtime.json'), 'utf8'))
  if (runtimeReceipt.dshCommit !== lock.commit || runtimeReceipt.dshVersion !== lock.packageVersion) throw new Error('Native shell compiler Runtime differs from the core lock')
  const runtimeRequire = createRequire(join(runtime, 'package.json'))
  const { build } = runtimeRequire('esbuild')
  const common = { bundle: true, platform: 'node', target: 'es2024', nodePaths: [join(runtime, 'node_modules')], external: ['electron'], logLevel: 'warning' }
  await build({ ...common, entryPoints: [join(output, 'src/desktop-main.mjs')], outfile: join(output, 'lib/main.js'), format: 'esm', banner: { js: "import { createRequire as __eduworkRequire } from 'node:module'; const require = __eduworkRequire(import.meta.url);" } })
  await build({ ...common, entryPoints: [join(output, 'src/preload-app.ts')], outfile: join(output, 'lib/preload-app.cjs'), format: 'cjs' })
}
// The pet preload requires only electron; the sandbox loads it as written.
await copyFile(join(repository, 'dsh-electron/src/preload-pet.cjs'), join(output, 'lib/preload-pet.cjs'))
const adapters = {}
for (const name of ['dock-theme-preload.cjs', 'boot-motion-preload.cjs', 'preload-pet.cjs']) adapters['dsh-electron/src/' + name] = digest(await readFile(join(repository, 'dsh-electron/src', name)))
adapters['dsh-electron/src/boot-brand-preload.cjs'] = digest(await readFile(join(repository, 'dsh-electron/src/boot-brand-preload.cjs')))
for (const name of ['native-profile.mjs', 'settings-migration.mjs']) adapters['dsh-host/' + name] = digest(await readFile(join(repository, 'dsh-host', name)))
{
  for (const name of ['native-web-host.mjs', 'desktop-main.mjs', 'automation-browser.mjs', 'native-desktop.mjs', 'native-desktop-bridge.mjs']) adapters['dsh-electron/src/' + name] = digest(await readFile(join(repository, 'dsh-electron/src', name)))
  adapters['dsh-electron/scripts/native-desktop-source.mjs'] = digest(await readFile(join(repository, 'dsh-electron/scripts/native-desktop-source.mjs')))
}
adapters['dsh-host/publisher-bootstrap.mjs'] = digest(await readFile(join(repository, 'dsh-host/publisher-bootstrap.mjs')))
for (const name of ['configuration-documentation.mjs', 'configuration-reference.mjs', 'configuration-plugin-options.mjs', 'dsh-compatibility.mjs']) adapters['dsh-host/' + name] = digest(await readFile(join(repository, 'dsh-host', name)))
adapters['dsh-host/configuration-file.mjs'] = digest(await readFile(join(repository, 'dsh-host/configuration-file.mjs')))
for (const name of electronAdapters) adapters['dsh-electron/src/' + name] = digest(await readFile(join(repository, 'dsh-electron/src', name)))
for (const file of ['dsh-electron/native/sparkle-addon.mm', 'dsh-electron/scripts/build-shell.mjs', 'dsh-electron/src/portable-updates.mjs', 'dsh-electron/src/product.mjs', 'dsh-electron/src/native-vault.mjs', 'dsh-electron/src/configuration-files.mjs', 'dsh-electron/src/lifecycle.mjs', 'dsh-electron/src/media-transport.mjs', 'dsh-electron/src/legacy-migration.mjs', 'dsh-electron/src/external-navigation.mjs', 'dsh-host/release-policy.mjs', 'dsh-host/desktop-updates.mjs', 'dsh-host/workbench-support.mjs', 'dsh-host/diagnostics.mjs', 'dsh-host/desktop-log.mjs', 'dsh-host/product-profile.mjs', 'dsh-host/product-presets.mjs', 'dsh-host/native-resources.mjs']) adapters[file] = digest(await readFile(join(repository, file)))
const notices = [], visited = new Set()
async function collectNotice(name, from) {
  let manifestPath
  const req = createRequire(from)
  try { manifestPath = req.resolve(name + '/package.json') }
  catch {
    let folder = dirname(req.resolve(name))
    for (;;) {
      const candidate = join(folder, 'package.json')
      const data = await readFile(candidate, 'utf8').then(JSON.parse).catch(() => null)
      if (data?.name === name) { manifestPath = candidate; break }
      if (dirname(folder) === folder) throw new Error('Cannot locate bundled dependency manifest: ' + name)
      folder = dirname(folder)
    }
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const key = manifest.name + '@' + manifest.version
  if (visited.has(key)) return
  visited.add(key)
  const folder = dirname(manifestPath), outputFolder = key.replaceAll('/', '__')
  const licenseFiles = (await readdir(folder)).filter(name => /^(license|licence|notice|copyright)(\.|$)/iu.test(name))
  const copies = []
  for (const name of licenseFiles) {
    const bytes = await readFile(join(folder, name)).catch(() => null)
    if (!bytes) continue
    const destination = join(output, 'third-party', outputFolder, name)
    await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes)
    copies.push({ file: outputFolder + '/' + name, sha256: digest(bytes) })
  }
  notices.push({ name: manifest.name, version: manifest.version, license: manifest.license, files: copies })
  for (const dependency of Object.keys(manifest.dependencies ?? {})) await collectNotice(dependency, manifestPath)
}
for (const name of ['@deepseek-ai/dsh-client-shortcuts', '@deepseek-ai/dsh-atomic-write', 'ws']) await collectNotice(name, join(resolve(values.runtime), 'package.json'))
await mkdir(join(output, 'third-party/jsonc-parser@3.3.1'), { recursive: true })
await copyFile(join(repository, 'dsh-host', vendor, 'LICENSE.md'), join(output, 'third-party/jsonc-parser@3.3.1/LICENSE.md'))
notices.push({ name: 'jsonc-parser', version: '3.3.1', license: 'MIT', source: 'dsh-host/vendor/jsonc-parser' })
for (const file of ['dsh-electron/src/update-coordinator.mjs', 'dsh-host/content-updates.mjs', 'dsh-host/content-update-protocol.mjs', 'dsh-electron/src/configuration-policy.mjs', 'dsh-host/user-config.mjs', 'dsh-plugins/media-openai/lib/config.js', 'dsh-host/enterprise-model-updates.mjs', ...['parser.js', 'scanner.js', 'string-intern.js'].map(name => 'dsh-host/' + vendor + '/' + name)]) adapters[file] = digest(await readFile(join(repository, file)))
await writeFile(join(output, 'third-party/notices.json'), JSON.stringify(notices, null, 2) + '\n')
await writeFile(join(output, 'source-receipt.json'), JSON.stringify({ schemaVersion: 1, dshCommit: coreLock.commit, dshVersion: coreLock.packageVersion, shellCommit: lock.commit, kind: 'official-desktop-with-product-adapters', files: rows, adapters, host: hostReceipt }, null, 2) + '\n')
console.log('Built official Electron shell with recorded product adapters: ' + output)
