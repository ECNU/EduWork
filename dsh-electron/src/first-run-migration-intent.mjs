import { randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, renameSync, unlinkSync } from 'node:fs'
import { link, mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

const distributionPattern = /^[a-z0-9][a-z0-9-]{0,99}$/
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const versionPattern = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/
const fields = ['schemaVersion', 'id', 'distribution', 'sourceRoot', 'sourceVersion', 'installerVersion', 'createdAt']

const missing = error => { if (error.code !== 'ENOENT') throw error; return null }
export const sameMigrationPath = (left, right) => typeof left === 'string' && typeof right === 'string'
  && isAbsolute(left) && isAbsolute(right) && resolve(left).toLowerCase() === resolve(right).toLowerCase()

export function readPortableMigrationReceipt(targetRoot, { distribution, sourceRoot, intentId }) {
  const path = join(targetRoot, '.eduwork-migration.json')
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.size > 1 << 20 || !sameMigrationPath(path, realpathSync(path))) return
    const receipt = JSON.parse(readFileSync(path, 'utf8'))
    if (receipt?.schemaVersion === 2 && receipt.state === 'imported' && receipt.distribution === distribution
      && sameMigrationPath(receipt.sourceRoot, sourceRoot) && (intentId === undefined || receipt.intentId === intentId)) return receipt
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
}

export function migrationIntentStore({ localAppData, testRoot, distribution, platform = process.platform }) {
  if (platform !== 'win32') return null
  if (!distributionPattern.test(distribution ?? '') || !isAbsolute(testRoot || localAppData || '')) throw Error('迁移意图目录无效')
  const directory = testRoot ? resolve(testRoot) : join(localAppData, 'EduWork')
  const path = join(directory, `${distribution}.portable-migration.json`)
  const validate = row => {
    if (!row || Object.keys(row).length !== fields.length || fields.some(field => !Object.hasOwn(row, field))
      || row.schemaVersion !== 1 || row.distribution !== distribution || typeof row.id !== 'string' || !idPattern.test(row.id)
      || typeof row.sourceRoot !== 'string' || !isAbsolute(row.sourceRoot) || row.sourceRoot.includes('\0')
      || !['sourceVersion', 'installerVersion'].every(field => typeof row[field] === 'string' && versionPattern.test(row[field]))
      || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw Error('迁移意图无效，请核对后重试')
    return row
  }
  const read = ({ isolateInvalid = false } = {}) => {
    try {
      const info = lstatSync(path)
      if (!info.isFile() || info.size > 8192 || !lstatSync(directory).isDirectory()) throw Error('迁移意图文件无效')
      const data = readFileSync(path, 'utf8')
      try { return validate(JSON.parse(data)) }
      catch (error) {
        if (!isolateInvalid) throw error instanceof SyntaxError ? Error('迁移意图无法读取') : error
        const current = lstatSync(path)
        if (current.dev !== info.dev || current.ino !== info.ino || current.mtimeMs !== info.mtimeMs || current.size !== info.size) return read()
        const backup = join(directory, `${distribution}.portable-migration.invalid-${Date.now()}-${randomUUID()}.json`)
        renameSync(path, backup)
        console.warn(`[portable migration] 已隔离损坏的迁移意图：${backup}`)
        return null
      }
    } catch (error) { return missing(error) }
  }
  return {
    path, directory, read,
    async claim(id) {
      if (!idPattern.test(id ?? '')) throw Error('迁移意图无效')
      const prefix = `${distribution}.migration-${id}-`, name = `${prefix}${process.pid}-${randomUUID()}`
      const claim = join(directory, name)
      await writeFile(claim, '', { flag: 'wx', mode: 0o600 })
      const release = () => unlink(claim).catch(error => { missing(error) })
      try {
        for (const entry of await readdir(directory)) {
          if (entry === name || !entry.startsWith(prefix)) continue
          const owner = Number(entry.slice(prefix.length).split('-')[0])
          if (!Number.isSafeInteger(owner) || owner <= 0 || owner > 0x7fffffff) continue
          let active = true
          try { process.kill(owner, 0) }
          catch (error) { if (error.code === 'ESRCH') active = false }
          if (active) throw Error('另一个客户端正在处理迁移，请稍后重试')
          await unlink(join(directory, entry)).catch(error => { missing(error) })
        }
        if (read()?.id !== id) throw Error('迁移意图已变更，请退出后重试')
        return release
      } catch (error) { await release(); throw error }
    },
    async write({ sourceRoot, sourceVersion, installerVersion }) {
      const row = validate({ schemaVersion: 1, id: randomUUID(), distribution, sourceRoot, sourceVersion, installerVersion, createdAt: new Date().toISOString() })
      await mkdir(directory, { recursive: true })
      if (!lstatSync(directory).isDirectory()) throw Error('迁移意图目录不是实际目录')
      const temporary = `${path}.${row.id}.tmp`
      await writeFile(temporary, JSON.stringify(row) + '\n', { flag: 'wx', mode: 0o600, flush: true })
      try { await link(temporary, path) }
      catch (error) { if (error.code === 'EEXIST') throw Error('已有待处理的迁移，请先完成或撤销'); throw error }
      finally { await unlink(temporary).catch(() => {}) }
      return row
    },
    remove(id) {
      if (!id || read()?.id !== id) return false
      try { unlinkSync(path); return true }
      catch (error) { missing(error); return false }
    },
  }
}
