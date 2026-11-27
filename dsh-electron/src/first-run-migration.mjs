import semver from 'semver'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { firstRunPending } from './first-run.mjs'
import { migrationIntentStore, readPortableMigrationReceipt, sameMigrationPath } from './first-run-migration-intent.mjs'
import { importPortableData, inspectPortableSource } from './portable-import.mjs'

export function installedMigrationIntent({ platform = process.platform, dataLayout, openStore = migrationIntentStore, ...options }) {
  if (platform !== 'win32' || dataLayout !== 'installed') return
  try {
    const store = openStore({ ...options, platform })
    const intent = store.read({ isolateInvalid: true })
    if (intent) return { store, intent }
  } catch (error) { return { error } }
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
    const receipt = readPortableMigrationReceipt(targetRoot, { ...intent, intentId: intent.id })
    if (receipt) {
      await rm(join(targetRoot, '.eduwork-import-progress.json'), { force: true }).catch(() => {})
      return settle(receipt)
    }
    if (!await conflict()) return { action: 'cancel' }
    await clear()
    return { action: 'relaunch' }
  }
  let release
  try {
    if (error) throw error
    release = await store.claim(intent.id)
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
  } finally { await release?.() }
}

export function installedMigrationDialogs(showMessageBox) {
  return {
    conflict: async () => (await showMessageBox({ type: 'warning', title: '安装版已有数据',
      message: '安装版目录中已存在数据，系统不会自动覆盖或合并。',
      detail: '选择「保留现有安装版」将结束本次迁移并直接打开安装版，原便携目录保持原样；选择「退出以便核对」将暂不启动，可核对数据目录或打开旧便携版取消本次迁移。',
      buttons: ['保留现有安装版', '退出以便核对'], cancelId: 1, defaultId: 1, noLink: true })).response === 0,
    failed: error => showMessageBox({ type: 'error', title: '迁移未完成', message: error.message,
      detail: '旧目录未修改。迁移意图仍保留，请核对后重新打开安装版。' }),
  }
}
