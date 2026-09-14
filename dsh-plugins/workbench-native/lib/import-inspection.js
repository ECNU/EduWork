import { createReadStream } from 'node:fs'
import { readdir, lstat, readFile } from 'node:fs/promises'
import { join, relative, basename, dirname, sep } from 'node:path'
import { zstdDecompress } from 'node:zlib'
import { promisify } from 'node:util'
import { sessionFrames } from './import-zstd.js'
import { normalizeLegacyImportRow } from './import-legacy.js'
const decompress = promisify(zstdDecompress)

export const loadImportFormats = async () => (await import('@deepseek-ai/dsh-session-format-catalog')).sessionFormatCatalog

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

export async function inspectSession(candidate, formats) {
  const before = await lstat(candidate.path)
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
      restore = formats.createRestore(row, { recovery: 'strict', validation: 'current' })
    } else {
      const normalized = normalizeLegacyImportRow(row, candidate.version)
      if (normalized !== row) legacyDescriptors++
      restore.decodeRow(normalized)
    }
  }
  if (!restore) throw Error('会话文件为空')
  const artifact = restore.finish(), after = await lstat(candidate.path)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('检查期间来源文件发生变化，请退出旧客户端再重试')
  return { ...artifact, legacyDescriptors }
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
