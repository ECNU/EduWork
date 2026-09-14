import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { loadUserConfig } from './user-config.mjs'
import { versionParts } from './release-policy.mjs'
export function compareVersions(a, b) {
  const [an, ap] = versionParts(a), [bn, bp] = versionParts(b)
  for (let i = 0; i < 3; i++) if (an[i] !== bn[i]) return Math.sign(an[i] - bn[i])
  if (!ap || !bp) return ap ? -1 : bp ? 1 : 0
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) continue
    if (ap[i] === undefined) return -1
    if (bp[i] === undefined) return 1
    const na = /^\d+$/u.test(ap[i]), nb = /^\d+$/u.test(bp[i])
    if (na && nb) return Math.sign(Number(ap[i]) - Number(bp[i]))
    if (na !== nb) return na ? -1 : 1
    return ap[i] < bp[i] ? -1 : 1
  }
  return 0
}

/** Portable candidates check their product feed. Installation stays with the
 * verified legacy updater / future packaged Electron updater, never a DSH feed. */
export async function checkDesktopUpdates({ updates = {}, version, shell, fetcher = fetch, platform = process.platform, arch = process.arch }) {
  if (!updates.manifestURL) return { phase: 'unconfigured', message: '此版本尚未配置更新渠道。可在 config/eduwork.jsonc 的 updates 中配置；更多示例见 config/examples。', url: updates.releasesURL }
  try {
    const endpoint = new URL(updates.manifestURL)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw Error('更新渠道必须使用 HTTPS')
    const response = await fetcher(endpoint.href, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } })
    if (!response.ok) throw Error(`更新检查失败（HTTP ${response.status}）`)
    const reader = response.body.getReader(), chunks = []; let size = 0
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 262144) throw Error('更新清单过大'); chunks.push(value) } }
    finally { await reader.cancel().catch(() => {}) }
    const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (versionParts(manifest.version)[1]) throw Error('更新渠道不能发布开发构建；请使用公开发行版本')
    const target = `${platform === 'win32' ? 'windows' : platform}-${arch}`
    if (manifest.schemaVersion !== 1 || manifest.target !== target || !Array.isArray(manifest.artifacts)) throw Error('更新渠道与当前平台不匹配')
    const artifact = manifest.artifacts.find(item => item.shell === shell)
    if (!artifact) throw Error('此渠道未提供当前桌面壳的更新，请联系发行方')
    if (compareVersions(manifest.version, version) <= 0) return { phase: 'current', message: `当前版本 ${version} 已是此渠道的最新版本。` }
    // No package execution or automatic cross-shell switching from a tray click.
    // The old Go transition updater separately verifies ZIP hashes and migration.
    const url = new URL(updates.releasesURL || artifact.url)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (!updates.releasesURL && url.origin !== endpoint.origin)) throw Error('更新下载地址无效')
    return { phase: 'available', version: manifest.version, message: `发现新版本 ${manifest.version}（当前 ${version}）。此绿色版可打开发布页面下载；请退出应用后再替换程序，保留 data 和 config。`, url: url.href }
  } catch (error) { return { phase: 'error', message: error.message || '无法检查更新，请稍后重试。' } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [config, version, shell] = process.argv.slice(2)
  if (!config || !['wails', 'electron'].includes(shell)) throw Error('Expected config, version and shell')
  console.log(JSON.stringify(await checkDesktopUpdates({ updates: loadUserConfig(config).updates, version, shell })))
}
