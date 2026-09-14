import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat, symlink } from 'node:fs/promises'
import path from 'node:path'
export const root = path.resolve(import.meta.dirname, '..')
const runtimeRoot = process.env.MEMORY_RUNTIME ? path.resolve(process.env.MEMORY_RUNTIME) : root
const require = createRequire(path.join(runtimeRoot, 'package.json'))
export const runtimeVersion = require('@deepseek-ai/dsh/package.json').version
if (process.env.MEMORY_EXPECTED_DSH_VERSION) assert.equal(runtimeVersion, process.env.MEMORY_EXPECTED_DSH_VERSION)
export async function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, ...options })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(executable + ' failed (' + code + '): ' + stderr + stdout)))
  })
}
export async function prepare() {
  await mkdir(path.join(root, 'artifacts'), { recursive: true })
  const directory = await mkdtemp(path.join(root, 'artifacts', 'host-'))
  // This is a fresh test profile. Nothing here reads the user's DSH_HOME.
  const dshHome = path.join(directory, 'data')
  const profile = path.join(dshHome, 'profiles', 'memory-test')
  const packageDir = path.join(profile, 'node_modules', '@eduwork', 'dsh-memory')
  await mkdir(packageDir, { recursive: true })
  if (runtimeRoot !== root) {
    // Link dependencies only inside this disposable profile. Resolve them to the
    // prepared runtime, never to the development checkout's older node_modules.
    const modules = path.join(runtimeRoot, 'node_modules')
    for (const name of await readdir(modules)) {
      if (name.startsWith('.') || name === '@eduwork') continue
      const target = path.join(modules, name)
      if (!(await stat(target)).isDirectory()) continue
      await symlink(target, path.join(profile, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir')
    }
  }
  const tarball = process.env.MEMORY_TARBALL
  assert.ok(tarball, 'Set MEMORY_TARBALL to the npm pack artifact under test')
  await command('tar', ['-xf', path.resolve(tarball), '--strip-components=1', '-C', packageDir])
  const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json')))
  const expected = JSON.parse(await readFile(path.join(root, 'package.json')))
  assert.equal(manifest.name, '@eduwork/dsh-memory')
  assert.equal(manifest.version, expected.version)
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    name: 'memory-test', private: true,
    dependencies: { '@eduwork/dsh-memory': manifest.version },
    dsh: { profile: { patchReload: 'startup', bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@eduwork/dsh-memory'] } },
  }, null, 2))
  const entry = path.join(path.dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js')
  const env = { ...process.env, DSH_HOME: dshHome }
  const args = [entry, '--profile', 'memory-test']
  const dump = await command(process.execPath, [...args, '--dump-config'], { env })
  await writeFile(path.join(directory, 'config.yml'), dump.stdout)
  assert.match(dump.stdout, /@eduwork\/dsh-memory/)
  assert.match(dump.stdout, /local_memory: sqlite/)
  assert.match(dump.stdout, /openAt: first-search/)
  assert.doesNotMatch(dump.stdout, /@chatecnu-work|dsh-desktop-boundary|session-persistence-sqlite/)
  return { directory, env, args, package: `${manifest.name}@${manifest.version}`, dsh: runtimeVersion }
}
export async function start() {
  const state = await prepare()
  const server = spawn(process.execPath, [...state.args, '--port', '0', '--no-open'], { env: state.env, cwd: root, windowsHide: true })
  let stdout = '', stderr = ''
  server.stderr.on('data', data => { stderr += data })
  const url = await new Promise((resolve, reject) => {
    server.on('error', reject)
    server.on('exit', code => reject(new Error('Host exited before ready: ' + code + ' ' + stderr)))
    server.stdout.on('data', data => {
      stdout += data
      const match = stdout.match(/dsh web:\s+(http:\/\/127[.]0[.]0[.]1:[0-9]+\/\?token=[^\s]+)/)
      if (match) resolve(match[1])
    })
  })
  const stop = async () => {
    if (server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve))
      server.kill()
      await exited
    }
    await writeFile(path.join(state.directory, 'stdout.log'), stdout.replace(/token=[^\s&]+/g, 'token=REDACTED'))
    await writeFile(path.join(state.directory, 'stderr.log'), stderr)
  }
  return { ...state, url, stop }
}
