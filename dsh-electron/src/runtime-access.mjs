import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// Run before app readiness / BrowserWindow creation. This also covers an old
// updater installing new files without preserving their Windows ACLs, and ZIP
// extraction by tools that cannot carry NTFS permissions.
export function ensureRuntimeAccess({ root, platform = process.platform, execute = execFileSync }) {
  if (platform !== 'win32') return
  const helper = join(root, 'resources/update/EduWork-Updater.exe')
  try {
    execute(helper, ['ensure-runtime-access', '--root', root], { windowsHide: true, timeout: 15000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (cause) {
    const detail = String(cause.stderr || cause.message || cause).trim().slice(0, 4096)
    throw new Error(`无法准备 Windows 程序运行权限。请检查安装目录权限或联系维护者。\n${detail}`, { cause })
  }
}
