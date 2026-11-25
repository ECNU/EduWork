import { lstat, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import semver from 'semver'
import { firstRunPending } from './first-run.mjs'
import { migrationIntentStore, sameMigrationPath } from './first-run-migration-intent.mjs'
import { importPortableData, inspectPortableSource } from './portable-import.mjs'

export function installedMigrationIntent({ platform = process.platform, dataLayout, openStore = migrationIntentStore, ...options }) {
  if (platform !== 'win32' || dataLayout !== 'installed') return
  try {
    const store = openStore({ ...options, platform })
    const intent = store.read()
    if (intent) return { store, intent }
  } catch (error) { return { error } }
}

export async function readPortableMigrationReceipt(targetRoot, { distribution, sourceRoot, intentId }) {
  const path = join(targetRoot, '.eduwork-migration.json')
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size > 1 << 20 || !sameMigrationPath(path, await realpath(path))) return
    const receipt = JSON.parse(await readFile(path, 'utf8'))
    if (receipt?.schemaVersion === 2 && receipt.state === 'imported' && receipt.distribution === distribution
      && sameMigrationPath(receipt.sourceRoot, sourceRoot) && (intentId === undefined || receipt.intentId === intentId)) return receipt
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
}

export async function resolveInstalledMigration({ targetRoot, version, intent, store, error,
  conflict, failed, useProgress, finish = async () => {}, inspect = inspectPortableSource, importSource = importPortableData }) {
  const pending = () => firstRunPending({ userRoot: targetRoot, platform: 'win32', dataLayout: 'installed' })
  const clear = async () => { if (!await store.remove(intent.id)) throw Error('迁移意图已变更，请退出后重试') }
  const settle = async receipt => {
    await finish(receipt)
    await clear()
    return { action: 'imported', receipt }
  }
  const decide = async () => {
    const receipt = await readPortableMigrationReceipt(targetRoot, { ...intent, intentId: intent.id })
    if (receipt) return settle(receipt)
    if (!await conflict()) return { action: 'cancel' }
    await clear()
    return { action: 'relaunch' }
  }
  try {
    if (error) throw error
    if (!await pending()) return await decide()
    if (!semver.valid(version) || semver.lt(version, intent.installerVersion)) throw Error('安装版版本低于迁移所需版本，请更新后重试')
    const source = await inspect({ sourceRoot: intent.sourceRoot, distribution: intent.distribution })
    if (!sameMigrationPath(source.root, intent.sourceRoot) || source.version !== intent.sourceVersion) throw Error('旧客户端目录或版本与迁移意图不符')
    let receipt
    try {
      receipt = await useProgress(onProgress => importSource({ sourceRoot: source.root, targetRoot,
        distribution: intent.distribution, intentId: intent.id, sourceVersion: intent.sourceVersion, onProgress }))
    } catch (error) {
      if (!await pending()) return await decide()
      throw error
    }
    return await settle(receipt)
  } catch (error) {
    await failed(error)
    return { action: 'cancel' }
  }
}

export function installedMigrationDialogs(showMessageBox) {
  return {
    conflict: async () => (await showMessageBox({ type: 'warning', title: '安装版已有数据',
      message: '不会合并或覆盖安装版已有数据。', detail: '保留现有安装版会结束本次迁移，旧便携目录保持原样。',
      buttons: ['保留现有安装版', '取消退出核对'], cancelId: 1, defaultId: 1, noLink: true })).response === 0,
    failed: error => showMessageBox({ type: 'error', title: '迁移未完成', message: error.message,
      detail: '旧目录未修改。迁移意图仍保留，请核对后重新打开安装版。' }),
  }
}
