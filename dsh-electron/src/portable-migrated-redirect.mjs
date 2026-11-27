import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { migrationIntentStore, readPortableMigrationReceipt, sameMigrationPath } from './first-run-migration-intent.mjs'

export function portableMigrationEnabled({ settings, testRoot, platform = process.platform }) {
  return platform === 'win32' && !testRoot && settings.portableMigration === true
    && settings.dataLayout !== 'installed' && !settings.sourceAlpha
}

export function portableRedirectGate({ root, settings, localAppData, testRoot, platform, read = readPortableMigrationReceipt }) {
  if (!portableMigrationEnabled({ settings, testRoot, platform })) return
  const { distribution } = settings
  try {
    const sourceRoot = realpathSync(root)
    const store = migrationIntentStore({ localAppData, distribution, platform })
    const receipt = read(join(store.directory, distribution), { distribution, sourceRoot })
    if (receipt) return { receipt }
    const intent = store.read({ isolateInvalid: true })
    if (sameMigrationPath(intent?.sourceRoot, sourceRoot)) return { store, intent }
  } catch (error) { return { error } }
}

export async function handlePortableRedirect({ gate, canResume, launch, choose, withdraw, fail }) {
  if (!gate) return 'normal'
  try {
    if (gate.error) throw gate.error
    if (gate.receipt) await launch({ mode: 'redirect' })
    else {
      const available = await canResume(gate.intent.id)
      const choice = await choose(available)
      if (choice === 'resume' && available) await launch({ mode: 'redirect', intentId: gate.intent.id })
      if (choice === 'withdraw') {
        await withdraw()
        return 'relaunch'
      }
    }
  } catch (error) { await fail(error, Boolean(gate.receipt)) }
  return 'exit'
}

export function portableRedirectDialogs(showMessageBox) {
  return {
    choose: async available => {
      const actions = [...(available ? ['resume'] : []), 'withdraw', 'exit']
      const { response } = await showMessageBox({ type: 'question', title: '上次迁移到安装版尚未完成',
        message: available ? '安装版已就绪，打开安装版即可继续完成数据迁移。' : '当前未检测到可继续迁移的安装版。',
        detail: available ? '如暂不迁移，可选择「取消迁移并继续用旧版」，仅清除未完成的迁移记录，原数据不会修改。'
          : '可选择「取消迁移并继续用旧版」，回到旧客户端后再重新点击「升级并迁移」。原数据未做任何修改。',
        buttons: [...(available ? ['打开安装版继续迁移'] : []), '取消迁移并继续用旧版', '退出'], noLink: true,
        defaultId: available ? 0 : actions.length - 1, cancelId: actions.length - 1 })
      return actions[response]
    },
    fail: (error, migrated) => showMessageBox({ type: 'error', title: '无法打开 EduWork 安装版',
      message: migrated ? '数据已迁移到安装版，旧客户端不再启动以免产生两份数据。请重新安装 EduWork 安装版后再打开。' : '迁移尚未完成，原便携数据未被修改。',
      detail: error.message }),
  }
}
