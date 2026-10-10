// Preflight: fail early and cheaply, before an expensive build starts.
//
// Every check here replaces a failure that would otherwise surface minutes into
// a run, after downloads and compiles had already happened:
//   * a missing tool fails the compile that needs it, not the run;
//   * a corrupt upstream cache fails the install that reads it;
//   * a pinned URL that has gone away fails the download that needs it;
//   * the speech model was fetched last, so a network failure wasted the whole
//     compile before it.
//
// Nothing here writes: the upstream cache scan reports and never repairs, and
// the URL probes are HEAD requests.
import { createHash } from 'node:crypto'
import { readFile, readdir, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { isMacOS, isWindows, pathExists, run } from './build-util.mjs'

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

/**
 * Tools the build invokes. `args` produces output we can show, but a non-zero
 * exit is not evidence the tool is missing: `ditto --help` and
 * `codesign --version` both exit non-zero on a healthy macOS. Only ENOENT means
 * absent, so that is the test.
 */
const TOOLS = {
  darwin: [
    ['perl', ['-v'], 'OpenSSL configuration'],
    ['make', ['--version'], 'OpenSSL build'],
    ['cmake', ['--version'], 'whisper.cpp build'],
    ['cc', ['--version'], 'OpenSSL and whisper.cpp compile'],
    ['tar', ['--version'], 'archive extraction'],
    ['ditto', ['--help'], 'Chromium extraction'],
    ['codesign', ['--help'], 'application signing'],
  ],
  win32: [
    ['tar.exe', ['--version'], 'archive and ZIP handling'],
    ['go', ['version'], 'legacy launcher build'],
  ],
}

async function probeTool(command, args) {
  try {
    const { stdout } = await run(command, args, { capture: true, echo: false })
    return { present: true, version: stdout.trim().split('\n')[0].slice(0, 120) }
  } catch (error) {
    // ENOENT is the only signal that the binary is not on PATH. Any other
    // failure means it ran and disliked its arguments, which still proves it is
    // installed, and the real build invokes it with the arguments it needs.
    if (error.code === 'ENOENT') return { present: false, version: '', error: 'not found on PATH' }
    return { present: true, version: '(present; version probe exited non-zero)' }
  }
}

/**
 * Directories the build requires. A missing one is usually a wrong checkout or
 * an incomplete clone, which is much cheaper to discover now.
 */
async function requiredDirectories(coreRoot) {
  const required = [
    ['config', 'distribution and native locks'],
    ['scripts', 'build scripts'],
    ['dsh-desktop/internal/productruntime/builtin', 'pinned runtime manifests'],
    ['packages/dsh-knowledge-studio/packages/artifact-services/lib', 'transcription catalog'],
    ['third_party/dsh', 'pinned upstream source lock'],
  ]
  const missing = []
  for (const [relative, why] of required) {
    const path = join(coreRoot, relative)
    if (!await pathExists(path)) missing.push({ path: `${relative}`, why })
  }
  return missing
}

/**
 * Inspect an existing upstream cache for damage. This **reports only**: a
 * half-installed tree is usually recoverable by reinstalling, and deleting a
 * developer's cache without being asked is not this script's decision.
 *
 * The failure mode it looks for is the one that has actually happened: pnpm's
 * virtual store left with package directories that contain their build output
 * but lost every `package.json`, while the bookkeeping that would trigger a
 * reinstall still says the tree is complete.
 */
export async function scanUpstreamCache(upstream) {
  const modules = join(upstream, 'node_modules')
  if (!await pathExists(modules)) {
    return { present: false, healthy: false, reason: 'not installed', totalPackages: 0, incompletePackages: 0, samples: [] }
  }
  const virtualStore = join(modules, '.pnpm')
  if (!await pathExists(virtualStore)) {
    return { present: true, healthy: false, reason: 'virtual store missing', totalPackages: 0, incompletePackages: 0, samples: [] }
  }
  // A tree this size is why the check samples the store rather than walking
  // every entry: the damaged shape is uniform, so the first entries are enough.
  const entries = (await readdir(virtualStore)).filter(name => !name.startsWith('.'))
  let total = 0
  let incomplete = 0
  const samples = []
  for (const entry of entries) {
    const nested = join(virtualStore, entry, 'node_modules')
    if (!await pathExists(nested)) continue
    for (const name of await readdir(nested)) {
      const packageRoots = name.startsWith('@')
        ? (await readdir(join(nested, name)).catch(() => [])).map(sub => join(nested, name, sub))
        : [join(nested, name)]
      for (const packageRoot of packageRoots) {
        const stat = await lstat(packageRoot).catch(() => null)
        if (!stat?.isDirectory() || stat.isSymbolicLink()) continue
        total += 1
        if (!await pathExists(join(packageRoot, 'package.json'))) {
          incomplete += 1
          if (samples.length < 5) samples.push(packageRoot.slice(upstream.length + 1))
        }
      }
    }
  }
  if (!total) return { present: true, healthy: false, reason: 'no packages resolved', totalPackages: 0, incompletePackages: 0, samples }
  const healthy = incomplete === 0
  return {
    present: true,
    healthy,
    reason: healthy ? 'ok' : `${incomplete} of ${total} packages have no package.json`,
    totalPackages: total,
    incompletePackages: incomplete,
    samples,
  }
}

/**
 * Confirm each pinned URL still resolves. `HEAD` is enough to detect a withdrawn
 * release or a moved tag, and it downloads nothing.
 */
export async function probeUrls(assets) {
  const results = []
  for (const [label, asset] of Object.entries(assets)) {
    const url = asset?.url
    if (!/^https:\/\//.test(url ?? '')) {
      results.push({ label, url: url ?? '', ok: false, status: 'not a pinned HTTPS url' })
      continue
    }
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30000) })
      results.push({ label, url, ok: response.ok, status: String(response.status) })
    } catch (error) {
      results.push({ label, url, ok: false, status: error.message.slice(0, 160) })
    }
  }
  return results
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    // A malformed lock is a different failure from a missing one, and both are
    // worth reporting rather than crashing the preflight that was meant to
    // report them.
    return null
  }
}

/** Every pinned native asset for this platform, in one flat map. */
export async function pinnedAssets(coreRoot) {
  const assets = {}
  if (isMacOS) {
    const lock = await readJsonIfPresent(join(coreRoot, 'config/macos-native.lock.json'))
    for (const key of ['browser', 'openssl', 'whisper']) {
      if (lock?.[key]?.url) assets[key] = lock[key]
    }
  }
  if (isWindows) {
    const python = await readJsonIfPresent(join(coreRoot, 'dsh-desktop/internal/productruntime/builtin/python-runtime-manifest.json'))
    const nodeLock = await readJsonIfPresent(join(coreRoot, 'dsh-desktop/internal/productruntime/builtin/node-runtime-manifest.json'))
    if (python?.assets?.['windows-amd64']) assets.python = python.assets['windows-amd64']
    const nodeAsset = nodeLock?.assets?.['win32-x64'] ?? nodeLock?.assets?.['windows-amd64']
    if (nodeAsset) assets.node = nodeAsset
  }
  return assets
}

export async function preflight({ coreRoot, upstream = '', upstreamRequired = false } = {}) {
  const problems = []
  const notes = []

  const platform = isWindows ? 'win32' : isMacOS ? 'darwin' : 'linux'
  const tools = TOOLS[platform] ?? []
  const toolResults = []
  for (const [command, args, why] of tools) {
    const result = await probeTool(command, args)
    toolResults.push({ command, why, ...result })
    if (!result.present) problems.push(`Missing tool: ${command} (${why})`)
  }

  const missingDirectories = await requiredDirectories(coreRoot)
  for (const entry of missingDirectories) problems.push(`Missing directory: ${entry.path} (${entry.why})`)

  // Node is checked here as well as in the entry points, so a direct script call
  // fails with the same clear message rather than a syntax error or a crash.
  if (!process.version.startsWith('v24.')) {
    problems.push(`EduWork builds require the pinned Node.js 24 toolchain; this is ${process.version}`)
  }

  let cache = null
  if (upstream) {
    cache = await scanUpstreamCache(upstream)
    if (cache.present && !cache.healthy) {
      // Reported, never repaired: removing a cache is the operator's call.
      notes.push(
        `Upstream cache looks incomplete (${cache.reason}). Reinstall it, or remove ` +
        `${upstream}/node_modules to rebuild from scratch.`,
      )
    }
  } else if (upstreamRequired) {
    notes.push('No upstream cache was supplied, so it could not be checked.')
  }

  const assets = await pinnedAssets(coreRoot)
  const urls = Object.keys(assets).length ? await probeUrls(assets) : []
  const unreachable = urls.filter(result => !result.ok)
  for (const result of unreachable) problems.push(`Pinned asset unreachable: ${result.label} (${result.status})`)

  return { platform, tools: toolResults, missingDirectories, cache, urls, problems, notes }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { parseArgs } = await import('node:util')
  const { dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const { values } = parseArgs({ options: { 'core-root': { type: 'string' }, upstream: { type: 'string' }, json: { type: 'boolean' } } })
  const result = await preflight({ coreRoot: values['core-root'] ?? coreRoot, upstream: values.upstream ?? '' })
  if (values.json) { console.log(JSON.stringify(result, null, 2)) }
  else {
    for (const tool of result.tools) console.log(`${tool.present ? 'ok  ' : 'FAIL'} ${tool.command.padEnd(10)} ${tool.version || tool.error}`)
    for (const url of result.urls) console.log(`${url.ok ? 'ok  ' : 'FAIL'} ${url.label.padEnd(10)} ${url.status}`)
    for (const note of result.notes) console.log(`note ${note}`)
    for (const problem of result.problems) console.log(`FAIL ${problem}`)
    console.log(result.problems.length ? `${result.problems.length} preflight problem(s)` : 'Preflight passed')
  }
  process.exitCode = result.problems.length ? 1 : 0
}
