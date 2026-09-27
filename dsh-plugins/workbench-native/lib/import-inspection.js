import { createReadStream } from 'node:fs'
import { readdir, lstat, readFile } from 'node:fs/promises'
import { join, relative, basename, dirname, sep } from 'node:path'
import { zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { sessionFrames } from './import-zstd.js'
import { normalizeLegacyImportRow } from './import-legacy.js'
const decompress = promisify(zstdDecompress)

export async function loadImportFormats(load = name => import(name)) {
  const module = await load('@deepseek-ai/dsh-session-format-catalog')
  return { ...module.sessionFormatCatalog, historical: module.historicalSessionFormatCatalog,
    forChildren: module.createSessionFormatCatalogWithChildren }
}

// Inspect every physical candidate, including names that the normal DSH list
// hides. A future generation must never fall back to an older copy silently.
export async function findSessionCandidates(home) {
  const root = join(home, 'sessions'), groups = new Map(), unknown = []
  async function walk(dir) {
    for (const row of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, row.name)
      if (row.isSymbolicLink()) { unknown.push({ path, reason: '目录链接不导入' }); continue }
      if (row.isDirectory()) { await walk(path); continue }
      if (!row.isFile() || !/\.jsonl(?:\.zstd)?$/i.test(row.name)) continue
      const match = /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/.exec(row.name)
      if (!match || relative(root, path).split(sep).length !== 3) {
        unknown.push({ path, reason: '无法识别的会话文件名或目录布局' }); continue
      }
      const version = match[1] ? Number(match[1]) : 0
      if (!Number.isSafeInteger(version)) { unknown.push({ path, reason: '会话格式版本号无效' }); continue }
      const group = groups.get(dir) ?? []
      group.push({ path, version, compression: match[2] ? 'zstd' : 'none' }); groups.set(dir, group)
    }
  }
  await walk(root)
  return { groups: [...groups.values()].map(rows => rows.sort((a, b) => b.version - a.version)), unknown }
}

async function* chunks(path, compression) {
  if (compression !== 'zstd') { yield* createReadStream(path); return }
  // DSH appends independent frames; Node stops after the first one and may
  // accept incomplete input. Check the container, then decode every frame.
  const bytes = await readFile(path)
  for (const frame of sessionFrames(bytes)) yield await decompress(frame)
}

async function* lines(path, compression) {
  const decoder = new TextDecoder('utf8', { fatal: true })
  let pending = ''
  for await (const chunk of chunks(path, compression)) {
    pending += decoder.decode(chunk, { stream: true })
    let end
    while ((end = pending.indexOf('\n')) !== -1) {
      yield pending.slice(0, end).replace(/\r$/, ''); pending = pending.slice(end + 1)
    }
  }
  pending += decoder.decode()
  if (pending) yield pending.replace(/\r$/, '')
}

const sameFile = (before, after) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === after[key])

export async function inspectSession(candidate, formats, { onHeader = () => {} } = {}) {
  const before = await lstat(candidate.path, { bigint: true })
  let restore, line = 0, legacyDescriptors = 0
  for await (const text of lines(candidate.path, candidate.compression)) {
    line++
    let row
    try { row = JSON.parse(text) } catch { throw Error(`第 ${line} 行不是有效 JSON；文件可能损坏或写入未完成`) }
    if (line === 1) {
      const result = formats.readHeader(row)
      if (result.status === 'unsupported') throw Object.assign(Error(`数据格式 v${result.storedVersion} 不受当前版本支持，请更新客户端后重试`), { category: 'unsupported' })
      if (result.status === 'malformed') throw Error(`会话头无效：${result.reason}`)
      if (result.storedVersion !== candidate.version) throw Error(`文件名是 v${candidate.version}，会话头是 v${result.storedVersion}，版本不一致`)
      if (result.header.id !== basename(dirname(candidate.path))) throw Error('会话 ID 与所在目录不一致')
      onHeader(result.header, before)
      restore = formats.createRestore(row, { recovery: 'strict', validation: 'current' })
    } else {
      const normalized = normalizeLegacyImportRow(row, candidate.version)
      if (normalized !== row) legacyDescriptors++
      restore.decodeRow(normalized)
    }
  }
  if (!restore) throw Error('会话文件为空')
  const artifact = restore.finish(), after = await lstat(candidate.path, { bigint: true })
  if (!sameFile(before, after)) throw Error('检查期间来源文件发生变化，请退出旧客户端再重试')
  return { ...artifact, legacyDescriptors }
}

// V4 migration needs the complete direct-child inventory of ONE source home.
// Decode historical evidence with the official V0–V3 catalog first; discard
// bodies after extracting descriptors, then let the official V4 edge migrate.
export async function prepareImportCatalogs(groups, formats, checkPath, progress = () => {}) {
  const errors = new Map(), children = new Map(), witnesses = new Map()
  if (!formats.forChildren) {
    if (formats.currentVersion >= 4) throw Error('当前 Runtime 缺少旧会话关系迁移接口，请使用完整客户端重试')
    return { errors, forSession: () => formats, validate: async () => {} }
  }
  for (const group of groups) {
    const candidate = group[0]
    let header, artifact
    progress(candidate)
    try {
      await checkPath(candidate.path)
      if (group[1]?.version === candidate.version) throw Error('同一代会话存在多份编码文件，无法确定应使用哪份；请先在来源客户端整理')
      artifact = await inspectSession(candidate, candidate.version <= 3 ? formats.historical : formats, {
        onHeader(value, identity) { header = value; witnesses.set(candidate.path, identity) },
      })
    } catch (error) { errors.set(candidate.path, error) }
    if (header?.origin !== 'subagent' || !header.parentSession) continue
    const descriptors = artifact?.events.filter(event => event.type === 'subagent/descriptor' && event.seq >= artifact.inheritedEventCount) ?? []
    const facts = children.get(header.parentSession) ?? []
    // A readable child header with an unreadable body remains an explicit
    // unknown child, matching native persistence; the child itself is excluded.
    facts.push({ childId: header.id, childCreatedAt: header.createdAt,
      descriptorCount: descriptors.length, descriptor: descriptors[0]?.data ?? null })
    children.set(header.parentSession, facts)
  }
  return {
    errors,
    forSession: candidate => formats.forChildren(children.get(basename(dirname(candidate.path))) ?? []),
    async validate() {
      for (const [path, before] of witnesses) {
        if (!sameFile(before, await lstat(path, { bigint: true })))
          throw Error('检查期间来源文件发生变化，请退出旧客户端再重试')
      }
    },
  }
}

// Product version is supplementary metadata only. Missing release metadata
// never prevents a readable session from being imported.
export async function sourceVersion(root) {
  for (const path of ['release.json', 'product/release.json', 'resources/product/release.json', 'resources/product/assembly.json', 'product/assembly.json']) {
    try {
      const file = join(root, path), stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) continue
      const data = JSON.parse(await readFile(file, 'utf8'))
      const version = data.version ?? data.productVersion
      if (typeof version === 'string' && /^[0-9][a-zA-Z0-9.+-]{0,79}$/.test(version)) return version
    } catch { /* Optional, untrusted metadata is never authoritative. */ }
  }
  return ''
}
