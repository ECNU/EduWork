// Shared quit decision for the default and native shells. The Host owns task state.
const fallback = {
  en: {
    quitTitle: 'Quit the application?', quit: 'Quit', cancel: 'Cancel',
    quitActiveTasks: 'Quitting will interrupt running or queued tasks.',
    quitScheduledTasks: 'Scheduled reminders cannot run while the application is closed.',
    quitActiveAndScheduledTasks: 'Quitting will interrupt running or queued tasks and pause scheduled reminders.',
  },
  zh: {
    quitTitle: '确定退出应用？', quit: '退出', cancel: '取消',
    quitActiveTasks: '退出将中断正在运行或排队的任务。',
    quitScheduledTasks: '应用关闭后，定时任务无法运行。',
    quitActiveAndScheduledTasks: '退出将中断正在运行或排队的任务，定时任务也无法运行。',
  },
}

export class DesktopQuitConfirmation {
  pending
  disposed = false
  constructor(options) { this.options = options }
  confirm() {
    if (this.disposed) return Promise.resolve(false)
    if (this.pending) { this.options.focus(); return this.pending }
    const pending = this.decide().finally(() => { if (this.pending === pending) this.pending = undefined })
    this.pending = pending
    return pending
  }
  dispose() { this.disposed = true }
  async decide() {
    const inspection = this.options.inspect()
    if (inspection === undefined) return true
    const state = await inspection.catch(() => ({ activeTasks: true, scheduledTasks: false }))
    if (this.disposed) return false
    if (!state.activeTasks && !state.scheduledTasks) return true
    const locale = this.options.locale()
    const messages = { ...fallback[locale.id.startsWith('zh') ? 'zh' : 'en'], ...locale.messages }
    const prompt = state.activeTasks
      ? state.scheduledTasks ? 'quitActiveAndScheduledTasks' : 'quitActiveTasks'
      : 'quitScheduledTasks'
    const windows = (this.options.platform ?? process.platform) === 'win32'
    const result = await this.options.show({
      type: windows ? 'none' : 'warning',
      ...(windows && this.options.icon ? { icon: this.options.icon } : {}),
      title: messages.aboutProduct ?? messages.application,
      message: messages.quitTitle, detail: messages[prompt],
      buttons: [messages.quit, messages.cancel], defaultId: 0, cancelId: 1, noLink: true,
    })
    return !this.disposed && result.response === 0
  }
}

// Reuse the existing Host byte transport; no renderer snapshot or private IPC protocol.
export async function inspectLegacyDesktopQuit(host) {
  const response = await host.fetch(new Request('dsh-app://app/_eduwork/quit-inspection', { signal: AbortSignal.timeout(5000) }))
  if (!response.ok) throw Error('Desktop task inspection unavailable')
  const state = await response.json()
  if (typeof state.activeTasks !== 'boolean' || typeof state.scheduledTasks !== 'boolean') throw Error('Invalid desktop task inspection')
  return state
}
