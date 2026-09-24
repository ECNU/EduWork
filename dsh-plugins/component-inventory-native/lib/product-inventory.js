import { readFileSync, statSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'

const json = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }
const file = path => { try { return statSync(path).isFile() } catch { return false } }
const row = (id, category, version, status, source, path, dependencies = [], consumers = [], details = {}) => ({
  id, category, version: version ?? null, status, source, path: path ?? null, dependencies, consumers,
  metadata: Object.entries(details).filter(([, value]) => value != null).map(([key, value]) => ({ key, value: String(value) })),
})

/** Reads the same immutable receipts used by both native launchers. */
export function productInventory(environment = process.env) {
  if (!environment.EDUWORK_PRODUCT_ROOT) return null
  const root = resolve(environment.EDUWORK_PRODUCT_ROOT)
  const identity = json(join(root, 'assembly.json'))
  if (!identity) return null
  const native = json(join(root, 'desktop-resources.json'))
  const shell = environment.EDUWORK_DESKTOP_SHELL
  const desktop = ['electron', 'wails'].includes(shell)
  const resource = path => {
    if (typeof path !== 'string' || isAbsolute(path)) return null
    const target = resolve(root, path), rel = relative(root, target)
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? target : null
  }
  const available = path => Boolean(resource(path) && file(resource(path)))
  const source = desktop ? 'release-bundled' : 'source'
  const release = {
    productName: environment.EDUWORK_PRODUCT_NAME || identity.brand?.product?.name || 'EduWork', platform: `${process.platform}-${process.arch}`,
    productVersion: identity.version, dshVersion: identity.dshVersion, dshCommit: identity.dshCommit,
    nodeVersion: process.versions.node, pnpmVersion: null, packageFlavor: native ? 'offline' : 'development',
    distributionMode: desktop ? 'desktop-release' : 'web-or-source',
  }
  const components = [
    ...(desktop ? [row('desktop-shell', 'platform', identity.version, 'ready', source, null, [], ['desktop-ui'], { framework: shell === 'electron' ? 'Electron' : 'Go / Wails' })] : []),
    ...(shell === 'electron' ? [row('electron', 'runtime', environment.EDUWORK_ELECTRON_VERSION, environment.EDUWORK_ELECTRON_VERSION ? 'ready' : 'unavailable', source, null, [], ['desktop-ui'])] : []),
    row('dsh-core', 'platform', identity.dshVersion, available('d/node_modules/@deepseek-ai/dsh/package.json') ? 'ready' : 'missing', source, 'd', ['nodejs'], ['agent-loop'], { commit: identity.dshCommit }),
    row('nodejs', 'runtime', process.versions.node, 'ready', source, null, [], ['dsh-core', 'video-production']),
  ]
  if (!native) return { release, components }
  const mac = native.platform?.startsWith('darwin-') === true
  // Older macOS receipts omitted Python metadata but used this same layout.
  const python = native.python?.executable ?? (mac ? 'r/p/bin/python3' : native.python && `${native.python.baseRoot}/python.exe`)
  const office = native.environment?.DSH_OFFICE_PYTHON
  const browser = native.environment?.DSH_MEDIA_BROWSER
  const asr = native.pluginConfig?.['eduwork-artifact-services']?.transcription?.local
  const remotion = json(join(root, 'd/node_modules/remotion/package.json'))
  const ffmpeg = `d/node_modules/@remotion/compositor-${native.platform}${mac ? '' : '-msvc'}/ffmpeg${mac ? '' : '.exe'}`
  components.push(
    row('python', 'runtime', native.python?.version, available(python) ? 'ready' : 'missing', source, python, [], ['office-suite']),
    row('office-suite', 'capability', native.python?.version, available(office) ? 'ready' : 'missing', source, office, ['python'], ['documents', 'pdfs', 'presentations', 'spreadsheets'], { environmentLockSHA256: native.python?.environmentLockSHA256 }),
    row('chromium', 'capability', native.browser?.version, available(browser) ? 'ready' : 'missing', source, browser, ['nodejs'], ['video-production']),
    row('video-production', 'capability', remotion?.version, remotion && available(ffmpeg) && available(browser) ? 'ready' : 'missing', source, 'd/node_modules/remotion', ['nodejs', 'chromium'], ['video-creation'], { renderer: 'Remotion / FFmpeg' }),
    row('local-asr', 'capability', native.asr?.model ?? 'whisper.cpp', asr && available(asr.executablePath) && available(asr.modelPath) ? 'ready' : 'missing', source, asr?.executablePath, [], ['audio-transcription']),
    row('system-tts', 'capability', null, 'available', 'system', null, [], ['audio-creation'], { engine: process.platform === 'win32' ? 'Windows SAPI' : 'System voices' }),
  )
  return { release, components }
}
