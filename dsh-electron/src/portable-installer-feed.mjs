import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rename, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { parseXml } from 'builder-util-runtime'
import { load } from 'js-yaml'
import semver from 'semver'
import { portableUpdateEdition } from './portable-updates.mjs'

const repository = 'ECNU/EduWork'
const githubRelease = `https://github.com/${repository}/releases/`
const assetHosts = ['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']
const metadataLimit = 1 << 20
const installerLimit = 2 ** 31
const versionValid = version => typeof version === 'string' && semver.valid(version) === version
const bytesValid = bytes => Number.isSafeInteger(bytes) && bytes > 0 && bytes <= installerLimit
const publicRepository = config => config?.provider === 'github' && config.repository?.toLowerCase() === repository.toLowerCase()

export function portableInstallerSource({ settings, effective, bundled, publisher, platform = process.platform }) {
  if (platform !== 'win32' || settings.portableMigration !== true || settings.dataLayout === 'installed' || settings.sourceAlpha || !effective) return null
  if (settings.distribution === 'eduwork' && publicRepository(bundled) && publicRepository(effective)) return { provider: 'github', repository }
  if (effective.provider !== 'static') return null
  const edition = config => portableUpdateEdition({ configuration: config, distribution: settings.distribution })
  try {
    const { manifestBaseURL, target, distribution } = edition(effective)
    for (const config of [bundled, publisher]) {
      if (!config?.manifestURL || config.provider === 'disabled') continue
      const trusted = edition(config)
      if (trusted.manifestBaseURL === manifestBaseURL && trusted.target === target) {
        return { provider: 'static', manifestBaseURL, target, distribution, productName: settings.productName || 'EduWork' }
      }
    }
  } catch { return null }
  return null
}

const cleanHTTPS = url => url.protocol === 'https:' && !url.username && !url.password && !url.hash
const sameURL = initial => url => url.href === initial.href
const githubAsset = initial => url => cleanHTTPS(url) && !url.port && (sameURL(initial)(url) || assetHosts.includes(url.hostname))
const channelAsset = (channel, file) => url => cleanHTTPS(url) && !url.search && url.origin === channel.origin && url.pathname === new URL(encodeURIComponent(file), channel).pathname

async function resource(fetch, url, allowed, signal) {
  let current = new URL(url)
  for (let hop = 0; hop < 6; hop++) {
    signal.throwIfAborted()
    if (!allowed(current)) throw Error('安装器来源或跳转地址不受信任')
    const response = await fetch(current, { signal, redirect: 'manual', credentials: 'omit', cache: 'no-store' })
    if (response.status === 200 && response.body) return response.body
    await response.body?.cancel()
    if (response.status === 404) return null
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) throw Error(`安装器来源返回 HTTP ${response.status}`)
    current = new URL(location, current)
  }
  throw Error('安装器来源跳转次数过多')
}

async function metadata(fetch, url, allowed = sameURL(url)) {
  const body = await resource(fetch, url, allowed, AbortSignal.timeout(15000))
  if (!body) return null
  let bytes = 0
  const chunks = []
  for await (const chunk of body) {
    bytes += chunk.length
    if (bytes > metadataLimit) throw Error('安装器清单超过大小限制')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const githubVersion = tag => typeof tag === 'string' && tag.startsWith('v') && versionValid(tag.slice(1)) ? tag.slice(1) : null

async function githubInstaller(policy, fetch) {
  let version
  if (policy === 'stable') {
    const text = await metadata(fetch, new URL(`https://api.github.com/repos/${repository}/releases/latest`))
    if (text === null) return null
    const row = JSON.parse(text)
    version = githubVersion(row?.tag_name)
    if (!version || row.draft || row.prerelease || semver.prerelease(version)) throw Error('GitHub 正式版标签无效')
  } else {
    const text = await metadata(fetch, new URL(`https://github.com/${repository}/releases.atom`))
    if (text === null) return null
    const feed = parseXml(text)
    if (feed?.name !== 'feed') throw Error('GitHub 开发版发行列表无效')
    const prefix = githubRelease + 'tag/'
    for (const entry of feed.getElements('entry')) {
      const href = entry.elementOrNull('link')?.attributes?.href
      const candidate = href?.startsWith(prefix) && githubVersion(href.slice(prefix.length))
      if (candidate && semver.prerelease(candidate)?.[0] === 'dev') { version = candidate; break }
    }
    if (!version) return null
  }
  const release = `${githubRelease}download/v${version}/`
  const url = new URL(policy === 'stable' ? 'latest.yml' : 'dev.yml', release)
  const text = await metadata(fetch, url, githubAsset(url))
  if (text === null) return null
  const info = load(text)
  const fileName = `EduWork-Setup-${version}-x64.exe`
  const file = Array.isArray(info?.files) && info.files.length === 1 ? info.files[0] : null
  const digest = file?.sha512
  if (info?.version !== version || file?.url !== fileName || info.path !== fileName || info.sha512 !== digest || !bytesValid(file.size)
    || typeof digest !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(digest) || Buffer.from(digest, 'base64').toString('base64') !== digest) throw Error('GitHub 安装器清单无效')
  return { provider: 'github', version, fileName, bytes: file.size, digest, algorithm: 'sha512', url: release + fileName }
}

async function staticInstaller(source, policy, fetch) {
  const channel = new URL(`${source.manifestBaseURL}/${policy}/`)
  const file = `latest-${source.target}.json`
  const text = await metadata(fetch, new URL(file, channel), channelAsset(channel, file))
  if (text === null) return null
  const info = JSON.parse(text)
  const installer = info?.installer
  if (installer === undefined) return null
  const version = info.version
  if (info.schemaVersion !== 1 || info.channel !== policy || info.target !== source.target || info.distribution !== source.distribution
    || !versionValid(version) || (policy === 'stable' && semver.prerelease(version))
    || !Array.isArray(info.artifacts) || !info.artifacts.some(row => row?.shell === 'electron' && row.flavor === 'offline')) throw Error('静态安装器清单与当前发行不符')
  const fileName = `${source.productName}-Setup-${version}-x64.exe`
  if (installer?.fileName !== fileName || !bytesValid(installer.bytes) || typeof installer.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(installer.sha256)
    || typeof installer.url !== 'string' || !channelAsset(channel, fileName)(new URL(installer.url))) throw Error('静态安装器资产无效')
  return { provider: 'static', version, fileName, bytes: installer.bytes, digest: installer.sha256.toLowerCase(), algorithm: 'sha256', url: installer.url }
}

export async function discoverPortableInstaller({ source, policy, version, fetch = globalThis.fetch }) {
  if (!source || !['stable', 'development'].includes(policy) || !versionValid(version)) return null
  const discover = channel => source.provider === 'github' ? githubInstaller(channel, fetch) : staticInstaller(source, channel, fetch)
  const rows = await Promise.allSettled((policy === 'stable' ? ['stable'] : ['stable', 'development']).map(discover))
  const candidates = rows.flatMap(row => row.status === 'fulfilled' && row.value ? [row.value] : [])
  if (!candidates.length) {
    const failure = rows.find(row => row.status === 'rejected')
    if (failure) throw failure.reason
    return null
  }
  return candidates.filter(row => semver.gte(row.version, version)).sort((left, right) => semver.rcompare(left.version, right.version))[0] ?? null
}

export async function downloadPortableInstaller({ installer, cache, signal, onProgress, fetch = globalThis.fetch }) {
  const timeout = AbortSignal.timeout(12 * 60 * 1000)
  signal = signal ? AbortSignal.any([signal, timeout]) : timeout
  signal.throwIfAborted()
  await mkdir(cache, { recursive: true })
  const directory = await mkdtemp(join(cache, `installer-${process.pid}-`))
  const output = join(directory, installer.fileName), part = `${output}.part`
  try {
    const url = new URL(installer.url)
    const body = await resource(fetch, url, installer.provider === 'github' ? githubAsset(url) : channelAsset(new URL('.', url), installer.fileName), signal)
    if (!body) throw Error('安装器未找到')
    const hash = createHash(installer.algorithm)
    let bytes = 0, reported = 0
    const report = stage => {
      onProgress?.({ stage, downloadedBytes: bytes, totalBytes: installer.bytes })
      reported = bytes
    }
    await pipeline(Readable.fromWeb(body), new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length
      if (bytes > installer.bytes) return callback(Error('安装器超出预期大小'))
      hash.update(chunk)
      try {
        if (!reported || bytes - reported >= 128 * 1024) report('downloading')
      } catch (error) { return callback(error) }
      callback(null, chunk)
    } }), createWriteStream(part, { flags: 'wx', mode: 0o600 }), { signal })
    if (bytes !== reported) report('downloading')
    signal.throwIfAborted()
    report('verifying')
    if (bytes !== installer.bytes || hash.digest(installer.algorithm === 'sha512' ? 'base64' : 'hex') !== installer.digest) throw Error('安装器校验失败')
    await rename(part, output)
    return output
  } catch (error) {
    await unlink(part).catch(() => {})
    await rmdir(directory).catch(() => {})
    throw error
  }
}
