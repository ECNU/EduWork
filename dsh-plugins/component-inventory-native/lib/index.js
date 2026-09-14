import { productInventory } from './product-inventory.js'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, parse, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export const name = 'component-inventory-native'
const remoteInitializers = []
const packageCache = new Map()

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

function regularFile(path) {
  try { return statSync(path).isFile() } catch { return false }
}

function directoryHasEntries(path) {
  try { return readdirSync(path).length > 0 } catch { return false }
}

function identityKey(...values) {
  return createHash('sha256').update(values.join('\0')).digest('hex').slice(0, 16)
}

function relativePath(root, path) {
  if (!path) return null
  const value = relative(root, path)
  if (!value || value.startsWith('..')) return null
  return value.replaceAll('\\', '/')
}

function metadata(values) {
  return Object.entries(values).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(([key, value]) => ({ key, value: String(value) }))
}

function resolvePackage(moduleName) {
  if (packageCache.has(moduleName)) return packageCache.get(moduleName)
  let resolved = null
  try {
    const url = import.meta.resolve(moduleName)
    if (url.startsWith('file:')) {
      let directory = dirname(fileURLToPath(url))
      const root = parse(directory).root
      while (directory !== root) {
        const manifest = readJSON(join(directory, 'package.json'))
        if (manifest?.name) {
          resolved = { name: String(manifest.name), version: typeof manifest.version === 'string' ? manifest.version : null }
          break
        }
        directory = dirname(directory)
      }
    }
  } catch {}
  packageCache.set(moduleName, resolved)
  return resolved
}

function releaseSummary() {
  const manifest = process.env.CHATECNU_WORK_RELEASE_MANIFEST
  const release = manifest ? readJSON(manifest) : null
  const dsh = resolvePackage('@deepseek-ai/dsh')
  return {
    productVersion: String(release?.version ?? 'source'),
    dshVersion: String(release?.dshVersion ?? dsh?.version ?? 'unknown'),
    dshCommit: typeof release?.dshCommit === 'string' ? release.dshCommit : null,
    nodeVersion: typeof release?.nodeVersion === 'string' ? release.nodeVersion : process.versions.node,
    pnpmVersion: typeof release?.pnpmVersion === 'string' ? release.pnpmVersion : null,
    packageFlavor: typeof release?.packageFlavor === 'string' ? release.packageFlavor : null,
    distributionMode: release ? 'desktop-release' : 'web-or-source',
  }
}

function component(id, category, version, status, source, path, dependencies = [], consumers = [], values = {}) {
  return { id, category, version: version ? String(version) : null, status, source, path, dependencies, consumers, metadata: metadata(values) }
}

// runtimeComponents is deliberately read-only. It reports the locked release
// identity and current filesystem state but never downloads or initializes a
// managed environment merely because the settings page was opened.
export function runtimeComponents() {
  const manifestPath = process.env.CHATECNU_WORK_RELEASE_MANIFEST
  const release = manifestPath ? readJSON(manifestPath) : null
  const dsh = resolvePackage('@deepseek-ai/dsh')
  if (!release || !manifestPath) {
    return [
      component('dsh-core', 'platform', dsh?.version ?? null, 'ready', 'source', null, [], ['agent-loop']),
      component('nodejs', 'runtime', process.versions.node, 'ready', 'system', null, [], ['dsh-core']),
    ]
  }

  const programRoot = dirname(resolve(manifestPath))
  const dataRoot = process.env.DSH_HOME ? dirname(resolve(process.env.DSH_HOME)) : join(programRoot, 'data')
  const platform = String(release.platform ?? 'windows-amd64')
  const nodeExecutable = platform.startsWith('windows-') ? join(programRoot, 'runtime', 'node', 'node.exe') : join(programRoot, 'runtime', 'node', 'bin', 'node')
  const dshEntry = process.env.CHATECNU_WORK_DSH_ENTRY || join(programRoot, 'd', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const webViewRoot = release.webView2Runtime ? join(programRoot, String(release.webView2Runtime)) : null
  const webViewExecutable = webViewRoot ? join(webViewRoot, 'msedgewebview2.exe') : null

  const pythonRuntimeKey = release.pythonRuntimeId ? identityKey(String(release.pythonRuntimeId), platform) : null
  const pythonEnvironmentKey = release.pythonRuntimeId && release.pythonEnvironmentId
    ? identityKey(String(release.pythonRuntimeId), String(release.pythonEnvironmentId)) : null
  const pythonRuntime = pythonRuntimeKey ? join(dataRoot, 'py', 'r', pythonRuntimeKey, platform.startsWith('windows-') ? 'python.exe' : 'bin/python3') : null
  const pythonEnvironment = pythonEnvironmentKey ? join(dataRoot, 'py', 'v', 's', pythonEnvironmentKey, platform.startsWith('windows-') ? 'Scripts/python.exe' : 'bin/python3') : null
  const pythonSeed = directoryHasEntries(join(programRoot, 'offline', 'python', 'a')) && directoryHasEntries(join(programRoot, 'offline', 'python', 'w'))
  const pythonRuntimeReady = pythonRuntime ? regularFile(pythonRuntime) : false
  const pythonEnvironmentReady = pythonEnvironment ? regularFile(pythonEnvironment) : false
  const pythonStatus = pythonRuntimeReady ? 'ready' : pythonSeed ? 'available' : 'not-initialized'
  const officeStatus = pythonEnvironmentReady ? 'ready' : pythonSeed ? 'available' : 'not-initialized'

  const nodeEnvironmentKey = release.nodeRuntimeId && release.videoRuntimeEnvironment
    ? identityKey(String(release.nodeRuntimeId), String(release.videoRuntimeEnvironment), platform) : null
  const preparedNodeEnvironment = nodeEnvironmentKey ? join(programRoot, 'offline', 'node', 'e', nodeEnvironmentKey) : null
  const managedNodeEnvironment = nodeEnvironmentKey ? join(dataRoot, 'js', 'e', nodeEnvironmentKey) : null
  const nodeEnvironment = preparedNodeEnvironment && regularFile(join(preparedNodeEnvironment, 'package.json'))
    ? preparedNodeEnvironment : managedNodeEnvironment
  const browserExecutable = nodeEnvironment && release.chromiumRevision
    ? join(nodeEnvironment, 'playwright-browsers', `chromium-${release.chromiumRevision}`, 'chrome-win64', 'chrome.exe') : null
  const playwrightPackage = nodeEnvironment ? join(nodeEnvironment, 'node_modules', 'playwright', 'package.json') : null
  const remotionPackage = nodeEnvironment ? join(nodeEnvironment, 'node_modules', 'remotion', 'package.json') : null
  const browserReady = Boolean(browserExecutable && regularFile(browserExecutable) && playwrightPackage && regularFile(playwrightPackage))
  const videoReady = Boolean(browserReady && remotionPackage && regularFile(remotionPackage))
  const environmentExpectedOffline = release.packageFlavor === 'offline'
  const environmentStatus = ready => ready ? 'ready' : environmentExpectedOffline ? 'missing' : 'not-initialized'
  const nodeEnvironmentSource = browserReady || videoReady
    ? preparedNodeEnvironment === nodeEnvironment ? 'offline-seed' : 'managed-data'
    : environmentExpectedOffline ? 'offline-seed' : 'network-managed'

  return [
    component('desktop-shell', 'platform', release.desktopShellVersion, 'ready', 'release-bundled', null, [], ['desktop-ui'], { framework: release.desktopShell ?? 'Wails' }),
    component('dsh-core', 'platform', release.dshVersion ?? dsh?.version, regularFile(dshEntry) ? 'ready' : 'missing', 'release-bundled', relativePath(programRoot, dshEntry), ['nodejs'], ['agent-loop'], { commit: release.dshCommit }),
    component('webview2', 'platform', release.webView2Version, webViewExecutable && regularFile(webViewExecutable) ? 'ready' : 'missing', 'release-bundled', relativePath(programRoot, webViewRoot), [], ['desktop-ui'], { mode: release.webView2Mode }),
    component('nodejs', 'runtime', release.nodeVersion ?? process.versions.node, regularFile(nodeExecutable) ? 'ready' : 'missing', 'release-bundled', relativePath(programRoot, nodeExecutable), [], ['dsh-core', 'browser-automation', 'video-production'], { actualVersion: process.versions.node, runtimeId: release.nodeRuntimeId }),
    component('python', 'runtime', release.pythonVersion, pythonStatus, pythonRuntimeReady ? 'managed-data' : pythonSeed ? 'offline-seed' : 'network-managed', relativePath(programRoot, pythonRuntime), [], ['office-suite'], { runtimeId: release.pythonRuntimeId }),
    component('office-suite', 'capability', release.pythonEnvironmentId, officeStatus, pythonEnvironmentReady ? 'managed-data' : pythonSeed ? 'offline-seed' : 'network-managed', relativePath(programRoot, pythonEnvironment), ['python'], ['documents', 'pdfs', 'presentations', 'spreadsheets'], { environmentId: release.pythonEnvironmentId }),
    component('browser-automation', 'capability', release.playwrightVersion, environmentStatus(browserReady), nodeEnvironmentSource, relativePath(programRoot, nodeEnvironment), ['nodejs', 'chromium'], ['browser-plugin', 'browser-skill', 'web-search'], { chromiumVersion: release.chromiumVersion, chromiumRevision: release.chromiumRevision }),
    component('video-production', 'capability', release.remotionVersion, environmentStatus(videoReady), nodeEnvironmentSource, relativePath(programRoot, nodeEnvironment), ['nodejs', 'chromium'], ['video-creation'], { playwrightVersion: release.playwrightVersion, chromiumVersion: release.chromiumVersion, sharedBrowser: 'browser-automation' }),
  ]
}

export class ComponentInventoryService extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'productComponents')
    for (const initialize of remoteInitializers) initialize.call(this)
  }
  list() {
    return productInventory() ?? { release: releaseSummary(), components: runtimeComponents() }
  }
}

Remote('list')(ComponentInventoryService.prototype.list, {
  kind: 'method', name: 'list', static: false, private: false,
  addInitializer(initializer) { remoteInitializers.push(initializer) },
})
export default ComponentInventoryService
