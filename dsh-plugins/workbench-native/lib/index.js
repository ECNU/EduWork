import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { DataImporter } from './data-import.js'
import { skillReadiness } from './skill-readiness.js'
import { requiredCapability, requiredCredential, requiredAccountBinding } from '@chatecnu-work/dsh-skill-control-native/core'

const initializers = []
export default class Workbench extends TypertRemoteService {
  static inject = ['skillManager', 'credentials', 'sessionPersistence']
  constructor(ctx) { super(ctx, 'workbench'); for (const init of initializers) init.call(this); ctx.effect(() => () => this.dataImporter?.close()) }
  async catalog() {
    const skills = [], root = process.env.DSH_BUNDLED_SKILL_DIR
    if (root) for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      try {
        const text = await readFile(join(root, entry.name, 'SKILL.md'), 'utf8')
        const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
        if (!header) continue
        const data = parse(header[1])
        if (typeof data.name !== 'string' || typeof data.description !== 'string') continue
        const readiness = await skillReadiness(this.ctx, {
          credential: requiredCredential(data), binding: requiredAccountBinding(data), capability: requiredCapability(data),
        })
        skills.push({ name: data.name, description: data.description.slice(0, 1024), source: 'builtin',
          ...readiness, removable: false })
      } catch { /* Skip malformed definitions, just like the runtime scanner. */ }
    }
    const personal = await this.ctx.skillManager.list()
    return { skills: [...skills, ...personal.skills.map(row => ({ ...row, available: true, requirement: '', removable: true }))] }
  }
  async desktop(action) {
    if (!['status', 'check-updates', 'diagnostics', 'download-update', 'schedule-update', 'install-update','use-stable-updates','use-development-updates','download-content-update','restart-content-update'].includes(action)) throw new Error('Unsupported desktop action')
    const desktop = this.ctx.get('desktopServices')
    if (desktop?.workbench) return desktop.workbench(action)
    return { shell: 'web', phase: 'web', message: '浏览器用于功能验证；更新与桌面诊断请在客户端中使用。' }
  }
  async notificationView(view) {
    const desktop = this.ctx.get('desktopServices')
    return desktop?.attention ? desktop.attention.view(view) : { desktop: false, target: null, delivery: 'unavailable' }
  }
  importer() {
    if (!process.env.DSH_HOME) throw new Error('当前运行环境没有数据目录。')
    return this.dataImporter ??= new DataImporter({ home: process.env.DSH_HOME, persistence: this.ctx.sessionPersistence,
      register: async (cwd, id) => { const registry = this.ctx.get('workspaceRegistry'); if (registry) await (await registry.create(cwd)).attachSession(id) },
    })
  }
  async importData(path) { return this.importer().start(path) }
  async inspectImport(path) { return this.importer().preview(path) }
  async cancelImport() { return this.importer().cancel() }
  async importStatus() { return this.importer().status() }
}
for (const name of ['catalog', 'desktop', 'notificationView', 'importData', 'importStatus', 'inspectImport', 'cancelImport']) Remote(name)(Workbench.prototype[name], {
  kind: 'method', name, static: false, private: false, addInitializer(init) { initializers.push(init) },
})
