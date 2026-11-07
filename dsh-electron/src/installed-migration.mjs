import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { acquireInstanceMutex, instanceIdentity, releaseInstanceMutex } from './install-mutex.mjs'
import { MIGRATION_RECEIPT, migratePortableToInstalled, recoverPortableMigration } from './portable-migration.mjs'
import { prepareWritableRoot, WRITABLE_ROOT_MARKER } from './writable-root.mjs'

async function readOwnedJSON(path, maximumBytes = 32 * 1024 * 1024) {
  const info = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  if (!info) return null
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximumBytes) throw new Error(`数据归属记录不是有效文件：${path}`)
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`数据归属记录格式无效：${path}`)
  return value
}

async function atomicJSON(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

export function migrationSourceArgument(args) {
  const indices = args.flatMap((value, index) => value === '--eduwork-migrate-source' ? [index] : [])
  if (!indices.length) return undefined
  const source = args[indices[0] + 1]
  if (indices.length !== 1 || typeof source !== 'string' || !isAbsolute(source) || source.length > 32767) {
    throw new Error('旧便携版目录参数无效')
  }
  return resolve(source)
}

export function migrationRelaunchArgs(args) {
  const source = migrationSourceArgument(args)
  if (!source) return [...args]
  const index = args.indexOf('--eduwork-migrate-source')
  return [...args.slice(0, index), ...args.slice(index + 2)]
}

export const pendingMigrationFile = (writableRoot, distribution) => join(dirname(writableRoot), `.${distribution}-portable-migration.json`)

export async function rememberPortableSource({ programRoot, writableRoot, settings, sourceRoot }) {
  if (settings.appId !== `org.eduwork.${settings.distribution}.electron` || !/^[a-z0-9-]+$/u.test(settings.distribution)
    || typeof sourceRoot !== 'string' || !isAbsolute(sourceRoot)) throw new Error('旧便携版迁移参数无效')
  const mutex = await acquireInstanceMutex('setup', writableRoot, '另一个窗口正在准备安装数据')
  try {
    if (!await installedDataNeedsSetup(writableRoot, settings, sourceRoot)) return
    const file = pendingMigrationFile(writableRoot, settings.distribution)
    const pending = await readOwnedJSON(file)
    const request = { schemaVersion: 1, distribution: settings.distribution, appId: settings.appId,
      sourceRoot: resolve(sourceRoot), programRoot: resolve(programRoot), writableRoot: resolve(writableRoot), phase: 'selected' }
    if (pending) {
      if (['sourceRoot', 'programRoot', 'writableRoot'].some(key => typeof pending[key] !== 'string'
        || instanceIdentity(pending[key]) !== instanceIdentity(request[key]))) throw new Error('还有其他未完成迁移，已保留现场')
      return
    }
    await mkdir(dirname(file), { recursive: true })
    await atomicJSON(file, request)
  } finally { await releaseInstanceMutex(mutex) }
}

export async function installedDataNeedsSetup(writableRoot, settings, sourceRoot) {
  const marker = await readOwnedJSON(join(writableRoot, WRITABLE_ROOT_MARKER))
  if (!marker) return true
  if (marker.schemaVersion !== 1 || marker.layout !== 'installed' || marker.distribution !== settings.distribution) {
    throw new Error('个人数据目录属于其他发行版，已停止且未覆盖')
  }
  if (sourceRoot) {
    const receipt = await readInstalledMigration(writableRoot, settings.distribution)
    if (!receipt || instanceIdentity(receipt.source.root) !== instanceIdentity(sourceRoot)) {
      throw new Error('安装版已有个人数据，不能再覆盖导入旧目录')
    }
  }
  return false
}

/** Finish the data decision before the normal Electron profile or Host opens W. */
export async function prepareInstalledData({ programRoot, writableRoot, settings, sourceRoot, choose, preview,
  onProgress = () => {}, migrate = migratePortableToInstalled, recover = recoverPortableMigration,
  initialize = prepareWritableRoot }) {
  if (!/^[a-z0-9-]+$/u.test(settings.distribution) || settings.appId !== `org.eduwork.${settings.distribution}.electron`) {
    throw new Error('安装版发行身份无效')
  }
  programRoot = resolve(programRoot); writableRoot = resolve(writableRoot)
  const mutex = await acquireInstanceMutex('setup', writableRoot, '另一个窗口正在准备安装数据，请等待完成')
  const pendingFile = pendingMigrationFile(writableRoot, settings.distribution)
  try {
    const pending = await readOwnedJSON(pendingFile)
    if (pending && (pending.schemaVersion !== 1 || pending.distribution !== settings.distribution
      || pending.appId !== settings.appId || typeof pending.sourceRoot !== 'string' || !isAbsolute(pending.sourceRoot)
      || !['selected', 'copying', 'fresh'].includes(pending.phase)
      || typeof pending.programRoot !== 'string' || typeof pending.writableRoot !== 'string'
      || instanceIdentity(pending.programRoot) !== instanceIdentity(programRoot)
      || instanceIdentity(pending.writableRoot) !== instanceIdentity(writableRoot))) throw new Error('上次迁移记录不匹配，已保留现场')
    const initializeFresh = () => initialize({ root: writableRoot, distribution: settings.distribution,
      product: join(programRoot, 'resources/product'), productVersion: settings.productVersion })
    if (pending?.phase === 'fresh') {
      await initializeFresh()
      await rm(pendingFile)
      return { action: 'relaunch', migrated: false }
    }
    if (!await installedDataNeedsSetup(writableRoot, settings, sourceRoot)) {
      if (pending) {
        const receipt = await readInstalledMigration(writableRoot, settings.distribution)
        if (!receipt || instanceIdentity(receipt.source.root) !== instanceIdentity(pending.sourceRoot)) {
          throw new Error('个人数据目录与待恢复迁移不一致，未覆盖任何数据')
        }
        await rm(pendingFile)
      }
      return { action: 'continue' }
    }
    const state = await lstat(writableRoot).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
    if (state && (!state.isDirectory() || state.isSymbolicLink() || (await readdir(writableRoot)).length)) {
      throw new Error('个人数据目录已有内容但没有有效归属记录，请保留现场，不要覆盖')
    }
    if (pending && sourceRoot && instanceIdentity(sourceRoot) !== instanceIdentity(pending.sourceRoot)) {
      throw new Error('请先完成上一次迁移，不能切换到其他旧目录')
    }
    const choice = await choose({ sourceRoot: pending?.sourceRoot ?? sourceRoot, recovering: Boolean(pending && pending.phase !== 'selected') })
    if (!choice) return { action: 'quit' }
    if (choice.action === 'fresh') {
      if (pending && pending.phase !== 'selected') throw new Error('请先恢复上一次迁移，原数据已保留')
      if (pending) await atomicJSON(pendingFile, { ...pending, phase: 'fresh' })
      await initializeFresh()
      if (pending) await rm(pendingFile)
      return { action: 'relaunch', migrated: false }
    }
    if (choice.action !== 'import' || typeof choice.sourceRoot !== 'string' || !isAbsolute(choice.sourceRoot)) throw new Error('请选择旧便携版的程序目录')
    sourceRoot = resolve(choice.sourceRoot)
    if (pending?.phase === 'copying' && instanceIdentity(sourceRoot) !== instanceIdentity(pending.sourceRoot)) throw new Error('请先完成上一次迁移，不能切换到其他旧目录')
    const options = { sourceRoot, targetRoot: programRoot, writableRoot, onProgress }
    let plan = await migrate({ ...options, dryRun: true })
    if (plan.recovery) {
      if (!['restore', 'cleanup-stale'].includes(plan.recovery.action)) {
        throw new Error(`迁移需要人工检查，已保留旧数据：${plan.recovery.action}`)
      }
      if (!await preview(plan)) return { action: 'quit' }
      await recover(options)
      plan = await migrate({ ...options, dryRun: true })
    }
    if (plan.space?.error || plan.space?.freeBytes < plan.space?.requiredBytes) throw new Error('磁盘空间不足或无法确认空间，请释放空间后重试')
    if (!await preview(plan)) return { action: 'quit' }
    await mkdir(dirname(pendingFile), { recursive: true })
    await atomicJSON(pendingFile, { schemaVersion: 1, distribution: settings.distribution, appId: settings.appId,
      sourceRoot, programRoot, writableRoot, phase: 'copying' })
    const result = await migrate(options)
    await rm(pendingFile)
    return { action: 'relaunch', migrated: true, receipt: result.receipt }
  } finally { await releaseInstanceMutex(mutex) }
}

export async function readInstalledMigration(writableRoot, distribution) {
  const receipt = await readOwnedJSON(join(writableRoot, MIGRATION_RECEIPT), Infinity)
  if (!receipt) return null
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'eduwork-portable-to-installed-v1'
    || receipt.target?.distribution !== distribution || instanceIdentity(receipt.target.root) !== instanceIdentity(writableRoot)
    || !['activated', 'started', 'verified'].includes(receipt.state)
    || typeof receipt.source?.root !== 'string' || !isAbsolute(receipt.source.root)
    || typeof receipt.source?.handoffRoot !== 'string' || !isAbsolute(receipt.source.handoffRoot)
    || dirname(receipt.source.root) !== dirname(receipt.source.handoffRoot)
    || !receipt.source.handoffRoot.startsWith(receipt.source.root + '.handoff-')) throw new Error('便携数据迁移回执无效，旧数据仍需保留')
  return receipt
}

export async function recordInstalledMigrationStartup({ writableRoot, distribution, verifyCredentials, shouldContinue = () => true }) {
  const receipt = await readInstalledMigration(writableRoot, distribution)
  if (!receipt || receipt.state !== 'activated' || !shouldContinue()) return receipt
  await verifyCredentials()
  if (!shouldContinue()) return receipt
  receipt.state = 'started'
  receipt.startup = { hostReady: true, credentialsReadable: true, at: new Date().toISOString() }
  await atomicJSON(join(writableRoot, MIGRATION_RECEIPT), receipt)
  return receipt
}

export async function confirmInstalledMigration(writableRoot, distribution) {
  const receipt = await readInstalledMigration(writableRoot, distribution)
  if (!receipt || !['started', 'verified'].includes(receipt.state)) throw new Error('请先成功启动新版并检查迁入的数据')
  if (receipt.state === 'verified') return receipt
  receipt.state = 'verified'; receipt.confirmedAt = new Date().toISOString()
  await atomicJSON(join(writableRoot, MIGRATION_RECEIPT), receipt)
  return receipt
}
