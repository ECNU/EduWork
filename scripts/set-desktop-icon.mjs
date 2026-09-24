// Embeds and verifies the EduWork icon in a Windows candidate executable.
// The actual patching needs Win32 resource APIs (BeginUpdateResource) and GDI
// verification, so this wrapper runs the reviewed set-desktop-icon.ps1 through
// Windows PowerShell, which ships with Windows itself. No PowerShell 7 install
// is required, and no other platform runs this step.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { fullPath, isMainModule, isWindows, run } from './lib/build-util.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function setDesktopIcon({ executable, shell = '' } = {}) {
  if (!isWindows) throw new Error('Executable icon resources exist on Windows only')
  if (shell && !['wails', 'electron'].includes(shell)) throw new Error('Shell must be wails or electron')
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  const script = join(scriptRoot, 'set-desktop-icon.ps1')
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Executable', fullPath(executable)]
  if (shell) args.push('-Shell', shell)
  await run(powershell, args)
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      executable: { type: 'string' },
      shell: { type: 'string' },
    },
  })
  if (!values.executable) throw new Error('Use --executable <exe> [--shell wails|electron]')
  await setDesktopIcon({ executable: values.executable, shell: values.shell ?? '' })
}
