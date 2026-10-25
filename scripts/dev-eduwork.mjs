// Local development only. Publishing and installed applications are separate.
import { spawn } from 'node:child_process'
import { mkdir, stat, open } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadDevelopmentEnvironment } from './lib/dev-environment.mjs'
import { developmentPaths } from './lib/dev-workspace.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const paths = developmentPaths(root)
const { values, positionals } = parseArgs({ allowPositionals: true, options: { experimental: { type: 'boolean' } } })
const command = positionals[0] ?? 'status'
const output = values.experimental ? paths.experimental : paths.desktop
await loadDevelopmentEnvironment()

if (command === 'build') {
  if (values.experimental) throw new Error('Experimental builds require their declared source recipe; use dist/dev/experimental for its output')
  const { localDesktopPipeline } = await import('./local-desktop-pipeline.mjs')
  await localDesktopPipeline({ coreRoot: root, skipInstall: true, verifySnapshot: false })
} else if (['start', 'restart', 'stop', 'status'].includes(command)) {
  if (values.experimental) throw new Error('For experimental Web use dev-eduwork-web.mjs with an explicit private configuration')
  process.argv = [process.execPath, join(root, 'scripts/dev-eduwork-web.mjs'), command]
  await import('./dev-eduwork-web.mjs')
} else if (command === 'desktop') {
  if (process.platform !== 'win32') throw new Error('This development desktop launcher currently supports Windows; use the built application on macOS')
  const candidate = join(output, 'desktop/electron-candidate')
  const executable = join(candidate, 'EduWork-Electron.exe')
  await stat(executable).catch(() => { throw new Error(`Build the development desktop first: ${executable}`) })
  const data = join(paths.state, values.experimental ? 'experimental-desktop' : 'desktop')
  await mkdir(join(data, 'logs'), { recursive: true })
  const log = await open(join(data, 'logs/launcher.log'), 'w')
  try {
    const child = spawn(executable, [], { cwd: candidate, detached: true, windowsHide: true,
      env: { ...process.env, EDUWORK_DESKTOP_TEST_DATA_ROOT: data, EDUWORK_CONFIG_FILE: join(data, 'config/eduwork.jsonc') },
      stdio: ['ignore', log.fd, log.fd] })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    child.unref()
    console.log(`Development desktop launched (PID ${child.pid}). Data: ${data}`)
  } finally { await log.close() }
} else throw new Error('Use build, desktop [--experimental], start, restart, stop, or status')
