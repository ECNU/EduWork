import { readdir } from 'node:fs/promises'
import { readdirSync } from 'node:fs'

// First launch of the installed layout chooses its data before the target
// directory exists. Native dialogs need no window, browser profile or Host,
// so cancelling leaves both the old client and the new target untouched.

export async function firstRunPending({ userRoot, dataLayout, platform = process.platform, list = readdir }) {
  if (platform !== 'win32' || dataLayout !== 'installed') return false
  try { return (await list(userRoot)).length === 0 }
  catch (error) { if (error.code === 'ENOENT') return true; throw error }
}

// Synchronous form for module-load path activation: the browser profile must
// bind to the target before Chromium initializes os_crypt whenever the first-run
// choice is already settled.
export function firstRunPendingSync({ userRoot, dataLayout, platform = process.platform, list = readdirSync }) {
  if (platform !== 'win32' || dataLayout !== 'installed') return false
  try { return list(userRoot).length === 0 }
  catch (error) { if (error.code === 'ENOENT') return true; throw error }
}

export function firstRunDialogs({ productName = 'EduWork', suggestedSource, showMessageBox, showOpenDialog }) {
  return {
    choose: async () => {
      const { response } = await showMessageBox({ type: 'question', title: `开始使用 ${productName}`,
        message: '如何开始使用？',
        detail: '可以从旧版便携客户端导入会话、附件、设置和凭据，也可以全新开始。导入不会修改旧目录。',
        buttons: ['选择旧目录导入', '全新开始', '取消'], defaultId: 0, cancelId: 2, noLink: true })
      return ['import', 'fresh', 'cancel'][response]
    },
    pickSource: async () => {
      const { canceled, filePaths } = await showOpenDialog({ title: `选择旧版 ${productName} 便携客户端目录`, properties: ['openDirectory'], ...(suggestedSource ? { defaultPath: suggestedSource } : {}) })
      return canceled ? undefined : filePaths[0]
    },
    importFailed: async error => {
      const { response } = await showMessageBox({ type: 'error', title: '导入失败',
        message: '未能导入所选目录的数据',
        detail: `${error.message}\n\n旧目录保持原样，未做任何修改。可以重新选择目录，或取消后检查。`,
        buttons: ['重新选择', '取消'], defaultId: 0, cancelId: 1, noLink: true })
      return response === 0
    },
  }
}

export async function resolveFirstRunData({ choose, pickSource, importSource, importFailed, createTarget }) {
  for (;;) {
    const choice = await choose()
    if (choice === 'cancel') return { action: 'cancel' }
    // A fresh start must materialize the target before the relaunch that rebinds
    // os_crypt; otherwise the successor still sees an empty root and re-prompts.
    if (choice === 'fresh') { await createTarget(); return { action: 'fresh' } }
    const sourceRoot = await pickSource()
    if (!sourceRoot) continue
    try { return { action: 'imported', receipt: await importSource(sourceRoot) } }
    catch (error) { if (!await importFailed(error)) return { action: 'cancel' } }
  }
}
