import { constants, createReadStream } from 'node:fs'
import { readdir, lstat, realpath, mkdir, copyFile, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, dirname, basename } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { findSessionCandidates, inspectSession, loadImportFormats, sourceVersion } from './import-inspection.js'

const digest = value => createHash('sha256').update(value).digest('hex')
const inside = (root, path) => { const r = relative(root, path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)) }
async function exists(path) { try { return await lstat(path) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
async function hashFile(path) { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex') }
const ignored = new Set(['node_modules', '.git', '.venv', '__pycache__'])
async function noLinks(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if ((await exists(current))?.isSymbolicLink()) throw Error(`导入路径不能通过目录链接：${current}`)
    if (dirname(current) === current) break
  }
}
async function saveLedger(path, value) {
  await noLinks(path)
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' }); await rename(temporary, path) }
  finally { await rm(temporary, { force: true }) }
}

// Directory links are never followed; an imported tree cannot redirect writes
// out of the current data directory or read files outside the selected source.
async function copyTree(source, target, { mappings = [], warnings = [], progress = () => {}, replace = false, filter = () => true } = {}) {
  const item = await exists(source)
  if (!item) return
  if (item.isSymbolicLink()) { warnings.push(`未复制目录链接：${source}`); return }
  if ((await exists(target))?.isSymbolicLink()) throw Error(`目标位置是目录链接：${target}`)
  if (item.isDirectory()) {
    await mkdir(target, { recursive: true })
    for (const row of await readdir(source)) if (!ignored.has(row)) await copyTree(join(source, row), join(target, row), { mappings, warnings, progress, replace, filter })
  } else if (item.isFile()) {
    if (!filter(source)) return
    const old = await exists(target)
    if (old && !replace) {
      if (old.isFile() && await hashFile(source) === await hashFile(target)) return
      const alternate = `${target}.import-${(await hashFile(source)).slice(0, 12)}`
      mappings.unshift([source, alternate]); warnings.push(`同名文件保留为：${alternate}`)
      return copyTree(source, alternate, { mappings, warnings, progress })
    }
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target, replace ? 0 : constants.COPYFILE_EXCL)
    progress()
  }
}

export async function openImportStore(root, compression = 'zstd') {
  const [{ Context }, { default: Jsonl }] = await Promise.all([import('@deepseek-ai/cordis'), import('@deepseek-ai/dsh-session-persistence-jsonl')])
  const ctx = new Context()
  try { await ctx.plugin(Jsonl, { root, compression }); return { persistence: ctx.sessionPersistence, close: () => ctx.fiber.dispose() } }
  catch (error) { await ctx.fiber.dispose(); throw error }
}

export async function findImportHomes(programRoot, targetHome) {
  const root = await realpath(programRoot), target = await realpath(targetHome)
  if (inside(root, target) || inside(target, root)) throw Error('请选择另一份旧客户端的程序根目录，不能导入当前客户端自身。')
  const data = join(root, 'data'); await noLinks(data)
  const rows = await readdir(data, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') throw Error('没有找到 data 目录，请选择包含程序和 data 的旧客户端根目录。'); throw e })
  const homes = []
  for (const row of rows) {
    if (!row.isDirectory() || row.isSymbolicLink()) continue
    const home = row.name === 'dsh' ? join(data, 'dsh') : /-(electron|wails)$/.test(row.name) ? join(data, row.name, 'dsh') : null
    if (home && (await exists(home))?.isDirectory() && !(await lstat(home)).isSymbolicLink() && (await exists(join(home, 'sessions')))?.isDirectory()) homes.push(home)
  }
  if (!homes.length) throw Error('此目录中没有找到可导入的会话数据。支持 ChatECNU Work 0.2 及 EduWork 的程序根目录。')
  // Read all homes, newest shell first. A source log already contained in a
  // newer imported log is skipped, so retained migration snapshots do not
  // create duplicate conversations.
  homes.sort((a, b) => Number(b.includes('-electron')) - Number(a.includes('-electron')) || Number(b.includes('-wails')) - Number(a.includes('-wails')))
  return { root, homes }
}

function remap(value, mappings) {
  if (typeof value === 'string') {
    for (const [from, to] of mappings) for (const [a, b] of [[from, to], [from.replaceAll('\\', '/'), to.replaceAll('\\', '/')]]) value = value.split(a).join(b)
    return value
  }
  if (Array.isArray(value)) return value.map(row => remap(row, mappings))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, mappings)]))
  return value
}
const prefix = (a, b) => a.length <= b.length && a.every((row, i) => JSON.stringify(row) === JSON.stringify(b[i]))

export class DataImporter {
  constructor({ home, persistence, openStore = openImportStore, loadFormats = loadImportFormats, register = async () => {} }) { this.home = home; this.persistence = persistence; this.openStore = openStore; this.loadFormats = loadFormats; this.register = register; this.job = null }
  empty() { return { id: '', state: 'idle', message: '', total: 0, completed: 0, imported: 0, skipped: 0, conflicts: 0, files: 0, warnings: [], report: '', source: '', sourceVersion: '', targetFormat: 0, formats: [], scanned: 0, found: 0, excluded: 0, olderCopies: 0, issues: [], failed: 0 } }
  status() { return structuredClone(this.job ?? this.empty()) }
  async close() { await this.running; await this.cleanup() }
  async cleanup() {
    const staging = this.prepared?.staging
    this.prepared = null
    if (staging && dirname(staging) === join(await realpath(this.home), 'imports')) await rm(staging, { recursive: true, force: true })
  }
  async cancel() {
    if (['running', 'scanning'].includes(this.job?.state)) throw Error('正在处理数据，请等待完成。')
    await this.cleanup(); this.job = null; return this.status()
  }
  preview(source) {
    if (['running', 'scanning'].includes(this.job?.state)) throw Error('已有数据检查或导入正在进行，请等待完成。')
    this.job = { ...this.empty(), id: randomUUID(), state: 'scanning', message: '正在检查数据版本与完整性…', source }
    this.running = this.prepare(source).catch(async error => { this.job.state = 'error'; this.job.message = error.message; await this.cleanup() })
    return this.status()
  }
  async prepare(source) {
    await this.cleanup()
    const job = this.job, home = await realpath(this.home), { root, homes } = await findImportHomes(source, home)
    for (const path of ['imports', 'attachments', 'imported-workspaces']) await noLinks(join(home, path))
    const reportRoot = join(home, 'imports'); await mkdir(reportRoot, { recursive: true })
    const staging = join(reportRoot, `.staging-${job.id}`), records = [], formats = await this.loadFormats()
    this.prepared = { root, homes, staging, records }
    job.sourceVersion = await sourceVersion(root); job.targetFormat = formats.currentVersion
    const inventories = []
    let legacyDescriptors = 0
    for (const sourceHome of homes) {
      await noLinks(join(sourceHome, 'sessions'))
      inventories.push({ sourceHome, ...await findSessionCandidates(sourceHome) })
    }
    job.found = inventories.reduce((sum, row) => sum + row.groups.length + row.unknown.length, 0)
    const issue = (path, category, reason) => { job.excluded++; job.scanned++; job.issues.push({ path: relative(root, path), category, reason }) }
    for (const { sourceHome, groups, unknown } of inventories) {
      for (const row of unknown) issue(row.path, 'unsupported', row.reason)
      for (const group of groups) {
        const candidate = group[0]
        if (!job.formats.includes(candidate.version)) job.formats.push(candidate.version)
        job.olderCopies += group.filter(row => row.version < candidate.version).length
        job.message = `正在检查会话 ${job.scanned + 1} / ${job.found}`
        let store, write
        try {
          await noLinks(candidate.path)
          if (group[1]?.version === candidate.version) throw Error('同一代会话存在多份编码文件，无法确定应使用哪份；请先在来源客户端整理')
          const artifact = await inspectSession(candidate, formats)
          const staged = join(staging, String(job.scanned))
          store = await this.openStore(staged)
          write = await store.persistence.create(artifact.header, { inheritedEventCount: artifact.inheritedEventCount })
          await write.append(artifact.events); await write.flush(); await write.close(); write = null
          legacyDescriptors += artifact.legacyDescriptors
          records.push({ staged, header: artifact.header, sourceHome }); job.total++; job.scanned++
        } catch (error) { issue(candidate.path, error.category ?? 'invalid', error.message) }
        finally { await write?.close(); await store?.close() }
      }
    }
    job.formats.sort((a,b) => a-b)
    if (legacyDescriptors) job.warnings.push(`已兼容 ${legacyDescriptors} 份旧子代理描述 v2；正文与原有配置保留，来源文件未修改。`)
    job.state = 'ready'
    job.message = `检查完成：${job.total} 个会话可导入，${job.excluded} 项无法导入。${job.olderCopies ? `另有 ${job.olderCopies} 份旧代文件，按最新代处理。` : ''}`
    job.report = join(reportRoot, `${job.id}.json`)
    await writeFile(job.report, JSON.stringify(job, null, 2), 'utf8')
  }
  start(source) {
    if (this.job?.state !== 'ready' || source !== this.job.id || !this.prepared) throw Error('请先检查来源目录，再确认导入。')
    if (!this.job.total) throw Error('没有可导入的会话，请查看检查结果。')
    this.job.state = 'running'; this.job.message = '正在合并已检查的会话…'
    this.running = this.run().catch(error => { this.job.state = 'error'; this.job.message = error.message }).finally(() => this.cleanup())
    return this.status()
  }
  async run() {
    const job = this.job, home = await realpath(this.home)
    const { root, homes, records } = this.prepared
    for (const path of ['imports', 'attachments', 'imported-workspaces']) await noLinks(join(home, path))
    const reportRoot = join(home, 'imports'); await mkdir(reportRoot, { recursive: true })
    if ((await lstat(reportRoot)).isSymbolicLink()) throw Error('导入目录不能是链接。')
    const ledgerPath = join(reportRoot, 'sessions.json')
    await noLinks(ledgerPath)
    const ledger = JSON.parse(await readFile(ledgerPath, 'utf8').catch(e => { if (e.code === 'ENOENT') return '{}'; throw e }))
    const workspaceCopies = new Map()
    const progress = () => { job.files++; job.message = `正在复制文件… ${job.files} 个` }
    const skipped = async id => {
      job.skipped++
      const snapshot = await this.persistence.stat(id)
      try { if (snapshot?.header.cwd) await this.register(snapshot.header.cwd, id) }
      catch (error) { job.warnings.push(`会话 ${id} 已保留，工作区登记未完成：${error.message}`) }
    }
    try {
      for (const { staged, header, sourceHome } of records) {
        let read, write, store
        try {
          job.message = `正在合并会话 ${job.completed + 1} / ${job.total}`
          store = await this.openStore(staged)
          read = await store.persistence.open(header.id, 'read'); const { events } = await read.read()
          const fingerprint = digest(JSON.stringify({ header: read.header, events })), key = `${header.id}:${fingerprint}`
          if (ledger[key] && await this.persistence.stat(ledger[key])) { await skipped(ledger[key]); continue }
          const existing = await this.persistence.stat(header.id)
          let id = header.id
          if (existing) {
            const current = await this.persistence.open(id, 'read')
            try { if (prefix(events, (await current.read()).events)) { ledger[key] = id; await skipped(id); continue } } finally { await current.close() }
            id = `session-import-${fingerprint.slice(0, 32)}`
            if (await this.persistence.stat(id)) {
              // Without a committed receipt, do not guess whether a previous
              // interrupted import is complete. Preserve both copies.
              id = `${id}-${randomUUID().slice(0, 8)}`
            }
            job.conflicts++
          }
          const mappings = [], sourceKey = digest(sourceHome).slice(0, 16)
          const attachments = join(home, 'attachments', 'imports', sourceKey)
          if (!workspaceCopies.has(sourceHome)) {
            await copyTree(join(sourceHome, 'attachments'), attachments, { mappings, warnings: job.warnings, progress })
            workspaceCopies.set(sourceHome, mappings.slice())
          } else mappings.push(...workspaceCopies.get(sourceHome))
          mappings.push([join(sourceHome, 'attachments'), attachments])
          let cwd = header.cwd
          if (typeof cwd !== 'string' || !cwd) cwd = join(root, 'restored-workspace')
          if (inside(root, resolve(cwd)) && !homes.some(h => inside(h, resolve(cwd)))) {
            if (!(await exists(cwd))?.isDirectory()) job.warnings.push(`原工作区不在此机器上：${cwd}。会话已导入，项目文件需另外复制。`)
            const dest = join(home, 'imported-workspaces', digest(root).slice(0, 16), digest(cwd).slice(0, 12), basename(cwd))
            if (!workspaceCopies.has(cwd)) { await copyTree(cwd, dest, { mappings, warnings: job.warnings, progress }); workspaceCopies.set(cwd, mappings.slice()) }
            else mappings.push(...workspaceCopies.get(cwd))
            mappings.push([cwd, dest]); cwd = dest
          } else if (!isAbsolute(cwd) || !(await exists(cwd))?.isDirectory()) {
            cwd = join(home, 'imported-workspaces', digest(header.cwd).slice(0, 16))
            mappings.push([header.cwd, cwd]); job.warnings.push(`原工作区不在此机器上：${header.cwd}。会话已导入，项目文件需另外复制。`)
          }
          await noLinks(cwd); await mkdir(cwd, { recursive: true })
          const mapped = remap(events, mappings.sort((a, b) => b[0].length - a[0].length))
          write = await this.persistence.create({ ...read.header, id, cwd }, { inheritedEventCount: read.inheritedEventCount })
          await write.append(mapped); await write.flush(); await write.close(); write = null
          ledger[key] = id; job.imported++
          // Durable receipt after each session makes repeat imports safe even
          // if the application is closed halfway through a large migration.
          await saveLedger(ledgerPath, ledger)
          try { await this.register(cwd, id) } catch (error) { job.warnings.push(`会话 ${id} 已保存，工作区登记未完成：${error.message}`) }
        } catch (error) { job.warnings.push(`会话 ${header.id} 未导入：${error.message}`) }
        finally { await read?.close(); await write?.close(); await store?.close(); job.completed++ }
      }
      const failed = job.total - job.imported - job.skipped
      job.failed = failed
      await saveLedger(ledgerPath, ledger)
      job.state = failed === job.total && failed > 0 ? 'error' : 'complete'; job.message = `${failed || job.excluded ? '导入结束（有未导入项）' : '导入完成'}：新增 ${job.imported} 个会话，跳过 ${job.skipped} 个重复会话，保留 ${job.conflicts} 个冲突副本。${job.excluded} 项检查未通过，${failed} 个会话合并失败。`
      job.report = join(reportRoot, `${job.id}.json`)
      await writeFile(job.report, JSON.stringify({ ...job, source: root }, null, 2), 'utf8')
    } finally {
      await this.cleanup()
    }
  }
}
