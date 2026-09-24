// Shared cross-platform helpers for the EduWork build scripts. These replace
// the PowerShell-only primitives (safe path joins, link-rejecting copies,
// pinned downloads, native tool execution) with one Node.js implementation
// that behaves identically on Windows, macOS and Linux.
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'

export const isWindows = process.platform === 'win32'
export const isMacOS = process.platform === 'darwin'
const caseInsensitivePaths = isWindows || isMacOS

export function fullPath(path) {
  return resolve(path)
}

function samePrefix(prefix, path) {
  if (caseInsensitivePaths) return path.toLowerCase().startsWith(prefix.toLowerCase())
  return path.startsWith(prefix)
}

export function isInside(root, path) {
  const prefix = fullPath(root).replace(/[\\/]+$/, '') + sep
  return samePrefix(prefix.slice(0, -1), fullPath(path)) && (fullPath(path).length === prefix.length - 1 || samePrefix(prefix, fullPath(path)))
}

// Mirror of the PowerShell Child() guard: a declared-relative path must stay
// inside its root without parent traversal or absolute segments.
export function childPath(root, relative) {
  if (!relative || isAbsolute(relative) || String(relative).split(/[/\\]/).includes('..')) {
    throw new Error(`Expected a path inside its declared root: ${relative}`)
  }
  const rootPath = fullPath(root).replace(/[\\/]+$/, '')
  const target = fullPath(join(rootPath, relative))
  if (!samePrefix(rootPath + sep, target)) throw new Error('Path leaves its declared root')
  return target
}

export async function statEntry(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
    throw error
  }
}

export async function pathExists(path) {
  return Boolean(await statEntry(path))
}

export async function isFile(path) {
  return Boolean((await statEntry(path))?.isFile())
}

export async function isDirectory(path) {
  return Boolean((await statEntry(path))?.isDirectory())
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

export async function removeTree(path) {
  await rm(path, { recursive: true, force: true, maxRetries: 3 })
}

export async function readdirNames(path) {
  return (await readdir(path)).sort((a, b) => a.localeCompare(b, 'en'))
}

export async function copyFileTo(source, destination) {
  await ensureDir(dirname(destination))
  await copyFile(source, destination)
}

export async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

// UTF-8 without BOM, trailing newline, like PowerShell Set-Content utf8NoBOM.
export async function writeJSON(path, value, { space = 2 } = {}) {
  await writeFile(path, JSON.stringify(value, null, space) + '\n')
}

export async function writeText(path, text, { trailingNewline = true } = {}) {
  await writeFile(path, trailingNewline && !text.endsWith('\n') ? text + '\n' : text)
}

export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

export function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export async function sha512Integrity(path) {
  return 'sha512-' + createHash('sha512').update(await readFile(path)).digest('base64')
}

export async function download(url, file, { sha256 = '', retries = 3 } = {}) {
  if (!/^https:\/\//.test(url)) throw new Error(`Downloads require HTTPS: ${url}`)
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`Downloads require a pinned SHA-256: ${url}`)
  await ensureDir(dirname(file))
  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${url}`)
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file))
      if (sha256) {
        const actual = await sha256File(file)
        if (actual !== sha256) throw new Error(`Resource hash mismatch: ${file} (${actual})`)
      }
      return file
    } catch (error) {
      lastError = error
      await removeTree(file)
      if (attempt < retries) await sleep(5000)
    }
  }
  throw lastError
}

export function sleep(milliseconds) {
  return new Promise(done => setTimeout(done, milliseconds))
}

// Link-rejecting recursive copy, the shared behaviour of the reviewed
// PowerShell Copy-Tree helpers. Files may overwrite files; links always fail
// unless `skipLinks` selects the robocopy /XJ behaviour of omitting them.
// `excludeFile`/`excludeDir` mirror robocopy /XF and /XD name filters.
export async function copyTree(source, destination, { skipLinks = false, excludeFile, excludeDir } = {}) {
  const sourceStat = await statEntry(source)
  if (!sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) throw new Error(`Copy source must be a real directory: ${source}`)
  const destinationStat = await statEntry(destination)
  if (destinationStat) {
    if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink()) throw new Error(`Copy destination must be a real directory: ${destination}`)
  } else {
    await mkdir(destination, { recursive: true })
  }
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const target = join(destination, entry.name)
    if (entry.isSymbolicLink()) {
      if (skipLinks) continue
      throw new Error(`Copy does not follow links: ${from}`)
    }
    if (entry.isDirectory()) {
      if (excludeDir?.(entry.name)) continue
      await copyTree(from, target, { skipLinks, excludeFile, excludeDir })
    } else if (entry.isFile()) {
      if (excludeFile?.(entry.name)) continue
      const existing = await statEntry(target)
      if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error(`Copy target must be a real file: ${target}`)
      await cp(from, target, { force: true })
    } else {
      throw new Error(`Unsupported copy entry: ${from}`)
    }
  }
}

// Copy that preserves internal symlinks (for example node_modules/.bin) the
// way robocopy /XJ + Copy-Item -Recurse handled the prepared runtime cache.
export async function copyTreePreservingLinks(source, destination) {
  await cp(source, destination, { recursive: true, verbatimSymlinks: true })
}

export async function assertNoLinks(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Linked payload entry: ${path}`)
    if (entry.isDirectory()) await assertNoLinks(path)
  }
}

function formatCommand(command, args) {
  return [command, ...args].join(' ')
}

// Run a native executable. Throws on non-zero exit. `echo: false` silences
// pass-through output; `capture: true` returns trimmed stdout instead.
// `replaceEnv: true` uses `env` as the complete child environment.
export function run(command, args = [], { cwd, env, capture = false, echo = !capture, allowFailure = false, logStream, replaceEnv = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? (replaceEnv ? env : { ...process.env, ...env }) : process.env,
      stdio: ['ignore', capture || logStream ? 'pipe' : echo ? 'inherit' : 'ignore', capture || logStream ? 'pipe' : echo ? 'inherit' : 'ignore'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    if (child.stdout) child.stdout.on('data', chunk => {
      if (capture) stdout += chunk
      else if (echo) process.stdout.write(chunk)
      logStream?.write(chunk)
    })
    if (child.stderr) child.stderr.on('data', chunk => {
      if (capture) stderr += chunk
      else if (echo) process.stderr.write(chunk)
      logStream?.write(chunk)
    })
    child.on('error', rejectPromise)
    child.on('close', code => {
      if (code === 0 || allowFailure) {
        resolvePromise({ code, stdout: stdout.trim(), stderr: stderr.trim() })
      } else {
        const parts = capture ? [stderr.trim(), stdout.trim()].filter(Boolean) : []
        const detail = parts.length ? `: ${parts.join(' ')}` : ''
        rejectPromise(new Error(`${formatCommand(command, args)} failed with exit code ${code}${detail}`))
      }
    })
  })
}

export async function capture(command, args = [], options = {}) {
  const { stdout } = await run(command, args, { ...options, capture: true })
  return stdout
}

export function runNode(script, args = [], options = {}) {
  return run(process.execPath, [script, ...args], options)
}

// Resolve the JavaScript entry of a tool bundled with Node.js (corepack, npm)
// so Windows never needs the .cmd shims that require a shell to spawn.
export async function nodeBundledCli(name) {
  const entries = {
    corepack: 'node_modules/corepack/dist/corepack.js',
    npm: 'node_modules/npm/bin/npm-cli.js',
  }
  const entry = entries[name]
  if (!entry) throw new Error(`Unknown bundled Node.js tool: ${name}`)
  const nodeDirectory = dirname(process.execPath)
  for (const root of [nodeDirectory, join(nodeDirectory, '..', 'lib')]) {
    const candidate = join(root, ...entry.split('/'))
    if (await isFile(candidate)) return candidate
  }
  return null
}

export async function runBundledCli(name, args = [], options = {}) {
  const script = await nodeBundledCli(name)
  if (script) return runNode(script, args, options)
  if (isWindows) throw new Error(`${name} was not found beside the Node.js runtime; use the pinned Node.js 24 toolchain`)
  return run(name, args, options).catch(error => {
    if (error.code === 'ENOENT') throw new Error(`${name} is neither bundled with this Node.js nor on PATH; use the pinned Node.js 24 toolchain`)
    throw error
  })
}

export function isMainModule(importMetaUrl) {
  return Boolean(process.argv[1]) && importMetaUrl === pathToFileURL(resolve(process.argv[1])).href
}

export async function fail(message) {
  console.error(message)
  process.exitCode = 1
}
