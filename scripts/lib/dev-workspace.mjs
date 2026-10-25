import { lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export function insideDirectory(root, target) {
  const suffix = relative(resolve(root), resolve(target))
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep))
}

export function assertBuildOutput(repository, output, inputs = []) {
  const dist = join(repository, 'dist')
  if (insideDirectory(output, repository) ||
      (insideDirectory(repository, output) && (!insideDirectory(dist, output) || resolve(dist) === resolve(output))) ||
      inputs.some(input => insideDirectory(input, output) || insideDirectory(output, input))) {
    throw new Error('Build output must be under dist or outside the checkout, separate from every input')
  }
}

export function developmentPaths(root) {
  root = resolve(root)
  return { root, artifacts: join(root, 'dist/dev'), state: join(root, 'dist/dev-state'),
    desktop: join(root, 'dist/dev/desktop'), experimental: join(root, 'dist/dev/experimental') }
}

// Only disposable, explicitly named development outputs may be overwritten.
// Never follow a redirected dist/dev, or remove persistent state beside it.
export async function resetDevelopmentOutput(root, target) {
  const paths = developmentPaths(root)
  target = resolve(target)
  if (![paths.desktop, paths.experimental].includes(target)) throw new Error('Not a managed development output')
  for (const path of [paths.root, join(paths.root, 'dist'), paths.artifacts, target]) {
    const entry = await lstat(path).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error('Development output must not use directory links')
  }
  if (await lstat(join(target, 'pipeline-checkpoint.json.lock')).catch(error => { if (error.code !== 'ENOENT') throw error })) {
    throw new Error('A build workspace lock exists; finish that build before replacing its output')
  }
  const control = await readFile(join(paths.state, 'web/logs/control.json'), 'utf8')
    .then(JSON.parse).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (control?.assembly && insideDirectory(target, control.assembly)) {
    let alive = false
    try { process.kill(control.pid, 0); alive = true } catch (error) { if (error.code === 'EPERM') alive = true }
    if (alive) throw new Error('Stop the development Web process before rebuilding its product')
  }
  if (process.platform === 'win32') {
    const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "@(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:EDUWORK_DEV_OUTPUT_PREFIX,[StringComparison]::OrdinalIgnoreCase) }).Count"],
    { windowsHide: true, timeout: 15000, env: { ...process.env, EDUWORK_DEV_OUTPUT_PREFIX: target + sep } })
    if (Number(stdout.trim()) !== 0) throw new Error('Close the development APP and Web processes before rebuilding this output')
  }
  await rm(target, { recursive: true, force: true, maxRetries: 3 })
  await mkdir(paths.artifacts, { recursive: true })
}
