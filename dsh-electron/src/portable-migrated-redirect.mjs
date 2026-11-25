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
    const intent = store.read()
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
      const { response } = await showMessageBox({ type: 'question', title: '还有一次待处理的迁移',
        message: available ? '可以在安装版继续迁移。' : '未找到满足迁移要求的安装版。',
        detail: available ? '撤销只清除待迁移记录，不修改旧数据。' : '可退出并重新运行验证过的迁移安装器，或撤销待迁移后从旧客户端重新开始。',
        buttons: [...(available ? ['打开安装版'] : []), '撤销待迁移', '退出'], noLink: true,
        defaultId: available ? 0 : actions.length - 1, cancelId: actions.length - 1 })
      return actions[response]
    },
    fail: (error, migrated) => showMessageBox({ type: 'error', title: '未能打开 EduWork 安装版',
      message: migrated ? '数据已经迁移。请重新安装同一发行版，旧工作台不会启动。' : '迁移仍待处理，旧数据未修改。',
      detail: error.message }),
  }
}
