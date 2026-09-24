import { readFile, writeFile, mkdir, copyFile, symlink, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { upstream: { type: 'string' }, host: { type: 'string' }, output: { type: 'string' }, 'native-017': { type: 'boolean' } } })
if (!values.upstream || !values.host || !values.output) throw new Error('Use --upstream <pinned source> --host <prepared host> --output <new directory>')
const upstream = resolve(values.upstream), output = resolve(values.output), host = resolve(values.host)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const lock = JSON.parse(await readFile(join(repository, 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json'), 'utf8'))
// Keep the independently pinned product window/lifecycle while replacing its
// Host with the official Web transport. The receipt records both revisions.
const native = values['native-017'] === true
const coreLock = native ? JSON.parse(await readFile(join(repository, 'third_party/dsh/candidate-v0.1.7-rc.1/LOCK.json'), 'utf8')) : lock
const digest = data => createHash('sha256').update(data).digest('hex')
const inputs = JSON.parse(await readFile(join(repository, 'dsh-electron/upstream-inputs.json'), 'utf8'))
const hostReceipt = JSON.parse(await readFile(join(host, 'receipt.json'), 'utf8'))
if (hostReceipt.upstreamCommit !== coreLock.commit) throw new Error('Host and selected core commits differ')
for (const name of native ? ['host-process.mjs', 'node-environment.mjs', 'web-document.mjs', 'redacted-log.mjs'] : ['host-process.mjs', 'host-protocol.mjs']) {
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
  if (file === 'apps/desktop/src/main.ts') {
    const replace = (from, to) => { if (text.split(from).length !== 2) throw new Error('Official Electron anchor changed: ' + from.slice(0, 80)); text = text.replace(from, to) }
    replace("import { DesktopHostProcess } from './host-process.ts'", "import { DesktopHostProcess } from './eduwork-host-process.mjs'\nimport { configureEduworkPaths, prepareEduworkDesktop, nativeBootstrap, desktopReady, trackHost, desktopHostLog, isQuitting, attachDesktopWindow, configureWindowNavigation, showDesktopFailure, checkProductUpdates } from './product.mjs'\nimport { fetchDesktopProtocolResponse } from './media-transport.mjs'")
    replace('  const checkAndPrompt = async (manual: boolean): Promise<void> => {', '  const checkAndPrompt = async (manual: boolean): Promise<void> => {\n    if (manual) await checkProductUpdates()\n    return\n    // Upstream installer updates are inactive for the portable product distribution.')
    replace("const SCHEME = 'dsh-app'", "configureEduworkPaths()\nconst SCHEME = 'dsh-app'")
    // macOS routes standard editing shortcuts through native menu roles.
    // Keep the application menu first and preserve other platforms' menus.
    replace("      { role: 'quit' },\n    ],\n  }]))", "      { role: 'quit' },\n    ],\n  }, ...(process.platform === 'darwin' ? [{ role: 'editMenu' as const }] : [])]))")
    replace('  const resources = runtimeResources()', '  const product = await prepareEduworkDesktop()\n  const resources = { ...runtimeResources(), node: product.node }')
    replace('  const development = developmentProject()', '  const development = product.profile')
    replace('new DesktopHostProcess(resources.node, projectDir, hostInspectPort)', 'new DesktopHostProcess(resources.node, projectDir, hostInspectPort, { bootstrap: nativeBootstrap(), allowLinkedProfile: true, onLog: desktopHostLog })')
    replace('    await next.start()', "    trackHost(next)\n    await next.start()\n    if (isQuitting()) throw new Error('Desktop is shutting down')")
    replace("  await mainWindow.loadURL(`${SCHEME}://app/index.html`)", "  await mainWindow.loadURL(`${SCHEME}://app/index.html`)\n  await desktopReady()")
    replace('  mainWindow = createMainWindow()', '  mainWindow = createMainWindow()\n  await attachDesktopWindow(mainWindow)')
    replace("  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))\n  window.webContents.on('will-navigate', (event, url) => {\n    if (new URL(url).protocol !== `${SCHEME}:`) event.preventDefault()\n  })", '  configureWindowNavigation(window)')
    replace("process.env.DSH_DESKTOP_OPEN_DEVTOOLS !== '0'", "process.env.DSH_DESKTOP_OPEN_DEVTOOLS === '1'")
    replace("  app.on('before-quit', (event) => {\n    if (shellInstallerOwnsQuit) return\n    if (host === undefined) return\n    event.preventDefault()\n    const active = host\n    host = undefined\n    void active.stop().finally(() => { app.quit() })\n  })", '  // Product lifecycle also owns Hosts which have not reached ready yet.')
    replace('  const message = error instanceof Error ? error.message : String(error)', '  if (isQuitting()) return\n  const message = error instanceof Error ? error.message : String(error)')
    replace('  dialog.showErrorBox(resolveDesktopLocale(app.getLocale()).messages.startupFailed, message)', '  await showDesktopFailure(error)')
    replace('  app.exit(1)', '  // Keep the startup error visible so the user can fix configuration and retry.')
    if (native) {
      replace("import { fetchDesktopProtocolResponse } from './media-transport.mjs'", "import { registerNativeWebBridge } from './native-web-bridge.mjs'")
      replace('  let pluginWindow: BrowserWindow | undefined', '  let pluginWindow: BrowserWindow | undefined\n  registerNativeWebBridge({ getHost: () => host, getWindow: () => mainWindow })')
    } else replace('    return active.fetch(request)', '    return fetchDesktopProtocolResponse(active, request, isQuitting)')
  }
  if (native && file === 'apps/desktop/src/preload-app.ts') text = await readFile(join(repository, 'dsh-electron/src/native-preload.mjs'), 'utf8')
  if (file === 'apps/desktop/src/locale.ts') {
    const before = "export function resolveDesktopLocale(locale: string): DesktopLocale {\n  return locale.toLowerCase().startsWith('zh')\n    ? { id: 'zh-CN', messages: zh }\n    : { id: 'en', messages: en }\n}"
    if (!text.includes(before)) throw new Error('Official desktop locale adapter anchor changed')
    text = "import { app } from 'electron'\n" + text.replace(before,
      "export function resolveDesktopLocale(locale: string): DesktopLocale {\n  const selected: DesktopLocale = locale.toLowerCase().startsWith('zh') ? { id: 'zh-CN', messages: zh } : { id: 'en', messages: en }\n  const messages = Object.fromEntries(Object.entries(selected.messages).map(([key, value]) => [key, value.replaceAll('DeepSeek Harness', app.getName())])) as unknown as DesktopMessages\n  return { ...selected, messages }\n}")
  }
  const target = join(output, file.slice('apps/desktop/'.length))
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, text)
  rows.push({ path: file, originalSHA256: digest(before), derivedSHA256: digest(text), changed: !before.equals(Buffer.from(text)) })
}
const electronAdapters = ['desktop-brand.mjs', 'task-notifications.mjs', 'update-coordinator.mjs', 'mac-sparkle-updates.mjs', 'portable-updates.mjs', 'native-vault.mjs', 'product.mjs', 'desktop-restart.mjs', 'lifecycle.mjs', 'media-transport.mjs', 'configuration-files.mjs', 'configuration-policy.mjs', 'desktop-paths.mjs', 'initialize-user-config.mjs', 'legacy-migration.mjs', 'external-navigation.mjs']
for (const name of electronAdapters) await copyFile(join(repository, 'dsh-electron/src', name), join(output, 'src', name))
await copyFile(join(repository, 'dsh-host/product-profile.mjs'), join(output, 'src/product-profile.mjs'))
for (const name of ['native-profile.mjs', 'settings-migration.mjs']) await copyFile(join(repository, 'dsh-host', name), join(output, 'src', name))
await copyFile(join(repository, 'dsh-host/product-presets.mjs'), join(output, 'src/product-presets.mjs'))
await copyFile(join(repository, 'dsh-host/native-resources.mjs'), join(output, 'src/native-resources.mjs'))
for (const name of ['user-config.mjs', 'configuration-file.mjs', 'configuration-documentation.mjs', 'configuration-reference.mjs', 'configuration-plugin-options.mjs', 'content-updates.mjs', 'content-update-protocol.mjs', 'publisher-bootstrap.mjs']) await copyFile(join(repository, 'dsh-host', name), join(output, 'src', name))
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
if (native) {
  await copyFile(join(host, 'host-process.mjs'), join(output, 'src/eduwork-native-host-process.mjs'))
  for (const name of ['node-environment.mjs', 'web-document.mjs', 'redacted-log.mjs']) await copyFile(join(host, name), join(output, 'src', name))
  await copyFile(join(repository, 'dsh-electron/src/native-web-host.mjs'), join(output, 'src/eduwork-host-process.mjs'))
  await copyFile(join(repository, 'dsh-electron/src/native-web-bridge.mjs'), join(output, 'src/native-web-bridge.mjs'))
} else {
  await copyFile(join(host, 'host-process.mjs'), join(output, 'src/eduwork-host-process.mjs'))
  await copyFile(join(host, 'host-protocol.mjs'), join(output, 'src/host-protocol.mjs'))
}
await copyFile(join(host, 'LICENSE-DeepSeek'), join(output, 'LICENSE-DeepSeek'))
const manifest = JSON.parse(await source('apps/desktop/package.json'))
await writeFile(join(output, 'package.json'), JSON.stringify({ ...manifest, name: '@eduwork/desktop-electron', scripts: {}, devDependencies: {} }, null, 2))
await symlink(join(upstream, 'apps/desktop/node_modules'), join(output, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
const require = createRequire(join(upstream, 'package.json'))
const desktopRequire = createRequire(join(upstream, 'apps/desktop/package.json'))
const alias = Object.fromEntries(['electron-updater', 'semver', 'tar', '@deepseek-ai/dsh-home-paths'].map(name => [name, desktopRequire.resolve(name)]))
const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
await build({ config: false, cwd: output, alias, failOnWarn: true, entry: ['src/main.ts'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, deps: { alwaysBundle: [/.*/u], neverBundle: ['electron'] } })
await build({ config: false, cwd: output, entry: { preload: 'src/preload.ts', 'preload-app': 'src/preload-app.ts' }, outDir: 'lib', format: ['cjs'], platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false, deps: { neverBundle: ['electron'] } })
const adapters = {}
for (const name of ['native-profile.mjs', 'settings-migration.mjs']) adapters['dsh-host/' + name] = digest(await readFile(join(repository, 'dsh-host', name)))
if (native) for (const name of ['native-web-host.mjs', 'native-web-bridge.mjs', 'native-preload.mjs']) adapters['dsh-electron/src/' + name] = digest(await readFile(join(repository, 'dsh-electron/src', name)))
adapters['dsh-host/publisher-bootstrap.mjs'] = digest(await readFile(join(repository, 'dsh-host/publisher-bootstrap.mjs')))
for (const name of ['configuration-documentation.mjs', 'configuration-reference.mjs', 'configuration-plugin-options.mjs']) adapters['dsh-host/' + name] = digest(await readFile(join(repository, 'dsh-host', name)))
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
for (const name of Object.keys(alias)) await collectNotice(name, join(upstream, 'apps/desktop/package.json'))
await mkdir(join(output, 'third-party/jsonc-parser@3.3.1'), { recursive: true })
await copyFile(join(repository, 'dsh-host', vendor, 'LICENSE.md'), join(output, 'third-party/jsonc-parser@3.3.1/LICENSE.md'))
notices.push({ name: 'jsonc-parser', version: '3.3.1', license: 'MIT', source: 'dsh-host/vendor/jsonc-parser' })
for (const file of ['dsh-electron/src/update-coordinator.mjs', 'dsh-host/content-updates.mjs', 'dsh-host/content-update-protocol.mjs', 'dsh-electron/src/configuration-policy.mjs', 'dsh-host/user-config.mjs', 'dsh-plugins/media-openai/lib/config.js', 'dsh-host/enterprise-model-updates.mjs', ...['parser.js', 'scanner.js', 'string-intern.js'].map(name => 'dsh-host/' + vendor + '/' + name)]) adapters[file] = digest(await readFile(join(repository, file)))
await writeFile(join(output, 'third-party/notices.json'), JSON.stringify(notices, null, 2) + '\n')
await writeFile(join(output, 'source-receipt.json'), JSON.stringify({ schemaVersion: 1, dshCommit: coreLock.commit, dshVersion: coreLock.packageVersion, shellCommit: lock.commit, kind: 'official-desktop-with-product-adapters', files: rows, adapters, host: hostReceipt }, null, 2) + '\n')
console.log('Built official Electron shell with recorded product adapters: ' + output)
