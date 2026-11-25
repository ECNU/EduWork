import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { sameMigrationPath } from './first-run-migration-intent.mjs'

export async function refreshPortableShortcuts({ desktop, sourceRoot, executable, appId, read, write, warn }) {
  let entries
  try { entries = await readdir(desktop, { withFileTypes: true }) }
  catch (error) { warn(error); return }
  const oldTargets = ['EduWork-Electron.exe', 'EduWork.exe', 'ChatECNU-Work.exe'].map(name => join(sourceRoot, name))
  for (const entry of entries) {
    if (!entry.isFile() || !/\.lnk$/i.test(entry.name)) continue
    const path = join(desktop, entry.name)
    try {
      const { target } = read(path)
      if (!oldTargets.some(oldTarget => sameMigrationPath(target, oldTarget))) continue
      if (!write(path, 'update', { target: executable, cwd: dirname(executable), args: '', icon: executable,
        iconIndex: 0, appUserModelId: appId })) throw Error(`无法更新快捷方式：${entry.name}`)
    } catch (error) { warn(error) }
  }
}
