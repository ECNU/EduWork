import { open, lstat, realpath } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { arch, platform, release, homedir } from 'node:os'
import { deflateRawSync, crc32 } from 'node:zlib'
import { loadUserConfig } from './user-config.mjs'

const MAX_FILE = 512 * 1024, MAX_TOTAL = 3 * 1024 * 1024
const secretKey = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client.?secret|.*(?:api.?key|token|credential|nonce)|code|state)$/iu
const contentKey = /^(?:messages|prompt|input|output|requestBody|responseBody|body|content|arguments|bootstrap)$/iu

/** Local support data only; never read the credential vault or session bodies. */
export function redactDiagnostic(text, paths = {}) {
  let result = String(text)
  // Structured log records can contain complete request/response bodies.
  result = result.split(/\r?\n/u).map(line => {
    const offset = line.indexOf('{')
    if (offset < 0) return line
    try {
      const value = JSON.parse(line.slice(offset))
      return line.slice(0, offset) + JSON.stringify(value, (key, child) =>
        secretKey.test(key) || contentKey.test(key) ? '[REDACTED]' : child)
    } catch { return line }
  }).join('\n')
  // Covers plain headers, JSON (including multiline records), URLs and env syntax.
  result = result.replace(/(["']?(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|client[_-]?secret|[\w.-]*(?:api[_-]?key|token|credential)|nonce)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\r\n,;}&]+)/giu, '$1[REDACTED]')
    .replace(/([?&](?:code|state|key|secret|signature|sig|password|[^=&\s]*(?:token|credential))=)[^&#\s"']*/giu, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,"';}]+/giu, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, '$1[REDACTED]@')
    .replace(/(["']?(?:messages|prompt|requestBody|responseBody|bootstrap)["']?\s*[:=]\s*).*$/gimu, '$1[REDACTED]')
  for (const [label, path] of Object.entries({ ...paths, USERPROFILE: homedir() }).filter(([, path]) => path).sort((a, b) => b[1].length - a[1].length)) {
    for (const spelling of new Set([path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')])) {
      result = result.replace(new RegExp(spelling.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'giu'), `<${label}>`)
    }
  }
  return result
}

const inside = (root, target) => { const rel = relative(root, target); return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep)) }
async function boundedFile(root, name, limit, tail = true) {
  if (!root) return { status: 'unavailable' }
  const path = resolve(root, name)
  if (!inside(resolve(root), path)) return { status: 'outside-root' }
  try {
    const canonicalRoot = await realpath(root), canonical = await realpath(path), info = await lstat(path)
    if (!inside(canonicalRoot, canonical) || !info.isFile() || info.isSymbolicLink()) return { status: 'not-regular' }
    if (!tail && info.size > limit) return { status: 'too-large', bytes: info.size }
    const file = await open(path, 'r')
    try {
      const start = tail ? Math.max(0, info.size - limit) : 0
      const bytes = Buffer.alloc(Math.min(limit, info.size))
      const { bytesRead } = await file.read(bytes, 0, bytes.length, start)
      let body = bytes.subarray(0, bytesRead).toString('utf8')
      // Drop a partial first line rather than breaking Unicode or secret redaction.
      if (start) body = '[earlier log content omitted]\n' + body.slice(body.indexOf('\n') < 0 ? body.length : body.indexOf('\n') + 1)
      return { status: 'included', bytes: info.size, modifiedAt: info.mtime.toISOString(), truncated: start > 0, body }
    } finally { await file.close() }
  } catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'unreadable', code: error.code || 'READ_ERROR' } }
}

/** Small, bounded standard ZIP; no shell, external archiver or extra dependency. */
export function diagnosticZip(entries) {
  const chunks = [], directory = []; let offset = 0
  for (const [name, body] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(body), compressed = deflateRawSync(bytes), checksum = crc32(bytes)
    const local = Buffer.alloc(30), central = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(33, 12)
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26)
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(33, 14)
    central.writeUInt32LE(checksum, 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42)
    chunks.push(local, filename, compressed); directory.push(central, filename); offset += local.length + filename.length + compressed.length
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, central, end])
}

const select = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]))
const endpoint = value => { try { const url = new URL(value); return url.origin + url.pathname } catch { return undefined } }
function configurationSummary(settings) {
  return {
    valid: true, closeAction: settings.closeAction,
    updates: Object.fromEntries(Object.entries(settings.updates ?? {}).map(([key, value]) => [key, endpoint(value)])),
    organizations: settings.organizations.map(org => ({ id: org.id, issuer: endpoint(org.oidc?.issuer),
      provider: { ...select(org.provider, ['id', 'modelSource', 'defaultModel', 'compat']), baseURL: endpoint(org.provider?.baseURL),
        models: org.provider?.models?.map(model => select(model, ['id', 'input', 'contextWindow', 'maxTokens', 'reasoningEfforts', 'defaultReasoningEffort', 'compat'])) } })),
    media: settings.media?.providers?.map(provider => ({ id: provider.id, baseURL: endpoint(provider.baseURL),
      images: select(provider.images, ['enabled', 'model', 'nativeSizes']), speech: select(provider.speech, ['enabled', 'model']) })),
  }
}

export async function exportDiagnostics({ config, version, shell, logs, root, product, home, updateStatus, configurationOverlay }) {
  const paths = { PROGRAM: root, PRODUCT: product, DSH_HOME: home, LOGS: logs }
  const entries = [], files = [], generatedAt = new Date().toISOString(); let remaining = MAX_TOTAL
  const add = (name, text) => { const body = redactDiagnostic(text, paths); entries.push([name, body]); return body }
  const collect = async (directory, file, target, metadata = false, project) => {
    const item = await boundedFile(directory, file, Math.max(0, Math.min(metadata ? 128 * 1024 : MAX_FILE, remaining)), !metadata)
    const { body, ...health } = item
    files.push({ name: target, ...health })
    if (body !== undefined) {
      remaining -= Buffer.byteLength(body)
      if (metadata) {
        try { add(target, JSON.stringify(project(JSON.parse(body)), null, 2)) }
        catch { files.at(-1).status = 'invalid-json' }
      } else add(target, body)
    }
  }
  let configuration
  try { configuration = configurationSummary(loadUserConfig(config, { overlay: configurationOverlay })) }
  catch (error) { configuration = { valid: false, error: redactDiagnostic(error.message, paths) } }
  add('configuration.json', JSON.stringify(configuration, null, 2))
  if (updateStatus?.contentUpdate) add('content-update-status.json', JSON.stringify(select(updateStatus.contentUpdate,
    ['enabled', 'state', 'policy', 'configurationRevision', 'skillsRevision', 'latestRevision', 'downloadedBytes', 'totalBytes', 'message']), null, 2))
  if (updateStatus) add('update-status.json', JSON.stringify(select(updateStatus.update ?? updateStatus,
    ['state', 'phase', 'enabled', 'policy', 'currentVersion', 'latestVersion', 'downloadedBytes', 'totalBytes', 'installOnNextStart', 'checkedAt', 'error', 'message']), null, 2))
  for (const name of ['desktop-host.log', 'startup-error.log', 'host.log', 'desktop-shell.log', 'dsh-web.log', 'update.log', 'desktop-host.log.1']) {
    if (remaining <= 0) { files.push({ name: 'logs/' + name, status: 'budget-exhausted' }); continue }
    await collect(logs, name, 'logs/' + name)
  }
  const marker = value => select(value, ['schemaVersion', 'shell', 'distribution', 'productVersion', 'dshVersion', 'startedAt', 'state', 'phase', 'code', 'error', 'message', 'completedAt', 'imported', 'skipped', 'copied', 'total', 'status'])
  await collect(logs, 'desktop-start.json', 'metadata/desktop-start.json', true, marker)
  await collect(home, '.eduwork-migration.json', 'metadata/migration.json', true, marker)
  await collect(home, '.eduwork-desktop-home.json', 'metadata/data-owner.json', true, marker)
  await collect(root, 'release.json', 'metadata/release.json', true, value => select(value, ['schemaVersion', 'version', 'channel', 'shell', 'product', 'distribution', 'builtAt', 'dshVersion']))
  await collect(root, 'data/state/update-preferences.json', 'metadata/update-preferences.json', true, value => select(value, ['schemaVersion', 'policy', 'channel']))
  await collect(root, 'data/state/updates/update-preferences.json', 'metadata/electron-update-preferences.json', true, value => select(value, ['schemaVersion', 'policy', 'channel']))
  await collect(product, 'assembly.json', 'metadata/assembly.json', true, value => select(value, ['schemaVersion', 'version', 'distribution', 'dshVersion', 'dshCommit', 'runtimeSource', 'runtimeMode', 'pluginMode', 'managedPackages', 'localPlugins']))
  await collect(product, 'desktop-resources.json', 'metadata/resources.json', true, value => ({ schemaVersion: value.schemaVersion, platform: value.platform,
    python: select(value.python, ['version', 'environmentLockSHA256']), resources: Object.keys(value.environment ?? {}) }))
  const packages = []
  // Only package manifests, never a user profile's settings or environment.
  if (product) {
    const manifest = await boundedFile(product, 'd/package.json', 128 * 1024, false)
    if (manifest.body) try {
      const dependencies = JSON.parse(manifest.body).dependencies ?? {}
      for (const name of Object.keys(dependencies).sort().slice(0, 200)) {
        if (!/^(?:@[\w.-]+\/)?[\w.-]+$/u.test(name)) continue
        const info = await boundedFile(product, `d/node_modules/${name}/package.json`, 128 * 1024, false)
        try { packages.push({ name, version: JSON.parse(info.body).version }) }
        catch { packages.push({ name, status: info.status }) }
      }
    } catch { files.push({ name: 'components.json', status: 'invalid-package-manifest' }) }
  }
  add('components.json', JSON.stringify(packages, null, 2))
  const summary = { schemaVersion: 2, generatedAt, product: 'EduWork', version, shell,
    system: { platform: platform(), arch: arch(), release: release(), node: process.versions.node, electron: process.versions.electron },
    configuration: { valid: configuration.valid, organizations: configuration.organizations?.length }, files,
    privacy: { sessionLogExportIsSeparate: true, includesRedactedLogs: true, includesCredentialStore: false, includesProjectFiles: false } }
  const report = add('summary.json', JSON.stringify(summary, null, 2))
  add('README.txt', 'EduWork 故障诊断包\n\n包含：系统及组件版本、配置摘要、启动/更新/迁移标记、近期脱敏桌面日志。\n缺失、读取失败和截断情况见 summary.json；不因一个文件不可读而放弃整个导出。\n不读取凭据存储、浏览器资料、会话正文、附件和项目文件。日志经过脱敏；转交前仍可检查是否有需要隐藏的业务信息。\n具体对话问题，请另外下载该会话的 Session log；诊断包不会自动附上对话。\nPROGRAM / PRODUCT / DSH_HOME / USERPROFILE 为本机路径占位符。\n')
  return { shell, version, phase: 'exported', message: '诊断包已生成。', report,
    filename: `EduWork-diagnostics-${generatedAt.replace(/[-:]/gu, '').replace(/\.\d+Z$/u, 'Z')}.zip`,
    archive: diagnosticZip(entries).toString('base64') }
}
