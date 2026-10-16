import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// Explicit diagnostic/repair helper. Ordinary startup must not call it: an
// absent expected ACE or denied WRITE_DAC does not prove the sandbox cannot run.
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
