import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// A long-running editor may predate a Windows environment-variable change.
// Read only the supported credential, without logging or persisting its value.
export async function loadDevelopmentEnvironment({ env = process.env, platform = process.platform, readWindowsKey } = {}) {
  if (env.DEEPSEEK_API_KEY || platform !== 'win32') return env
  readWindowsKey ??= async () => {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$value=[Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User'); if(-not $value){$value=[Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','Machine')}; [Console]::Out.Write($value)"],
    { windowsHide: true, encoding: 'utf8', timeout: 10000 })
    return stdout.trim()
  }
  const value = await readWindowsKey()
  if (value) env.DEEPSEEK_API_KEY = value
  return env
}
