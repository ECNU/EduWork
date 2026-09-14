import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { patchWindowsRuntime } from './patch-dsh-windows-runtime.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument.startsWith('--')) throw new Error(`unexpected argument: ${argument}`)
    const [key, inline] = argument.slice(2).split('=', 2)
    const value = inline ?? argv[++index]
    if (!value) throw new Error(`--${key} needs a value`)
    values[key] = value
  }
  if (!values.output || !values.lock) {
    throw new Error('usage: node prepare-dsh-runtime.mjs --output <runtime-dir> --lock <LOCK.json> [--source npm|source] [--manifest <npm package.json>] [--upstream <verified source>]')
  }
  return {
    output: resolve(values.output),
    lock: resolve(values.lock),
    source: values.source,
    reusePacks: values['reuse-packs'] === 'true',
    manifest: values.manifest === undefined ? undefined : resolve(values.manifest),
    upstream: values.upstream === undefined ? undefined : resolve(values.upstream),
  }
}

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function executable(command) {
  if (process.platform !== 'win32' || !command.toLowerCase().endsWith('.cmd')) return { command, prefix: [] }
  return { command: process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe', prefix: ['/d', '/s', '/c', command] }
}

async function run(command, args, cwd, capture = false, environment = undefined) {
  const resolved = executable(command)
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(resolved.command, [...resolved.prefix, ...args], {
      cwd,
      env: environment,
      shell: false,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      windowsHide: true,
    })
    let stdout = ''
    if (capture) child.stdout.on('data', chunk => { stdout += chunk })
    child.once('error', reject)
    child.once('exit', code => {
      if (code === 0) resolvePromise(stdout.trim())
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

async function windowsPnpmProxy(lock) {
  if (process.platform !== 'win32') return undefined
  const corepackScript = join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
  await readFile(corepackScript).catch(() => {
    throw new Error(`Corepack JavaScript entry not found beside Node.js: ${corepackScript}`)
  })
  const directory = await mkdtemp(join(tmpdir(), 'chatecnu-pnpm-proxy-'))
  const executablePath = join(directory, 'pnpm.exe')
  const sourcePath = join(scriptDirectory, 'pnpm-proxy-windows.go')
  await run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', executablePath, sourcePath], scriptDirectory)
  const environment = { ...process.env }
  const pathKey = Object.keys(environment).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  environment[pathKey] = `${directory};${environment[pathKey] ?? ''}`
  environment.CHATECNU_PNPM_NODE = process.execPath
  environment.CHATECNU_COREPACK_JS = corepackScript
  environment.CHATECNU_PNPM_VERSION = lock.pnpmVersion
  return { directory, environment }
}

function resolveNpm() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function resolveCorepack() {
  return process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
}

function resolvePnpm() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

// Only reviewed repository tarballs enter runtime preparation. A sibling
// development checkout or junction is never a release dependency.
async function stageProductTarballs(output, lockPath, manifest) {
  const repository = resolve(dirname(lockPath), '..', '..')
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (!spec.startsWith('file:.product-tarballs/')) continue
    if (!/^(?:@eduwork\/)?[a-z0-9][a-z0-9.-]+$/.test(name)) throw new Error(`Invalid locked product package: ${name}`)
    // Repository directories retain their historical names; npm identities
    // move into the organization's scope and are checked against the lock.
    const packageLockPath = join(repository, 'third_party', name.replace(/^@eduwork\//,''), 'LOCK.json')
    const contract = await readJSON(packageLockPath)
    if (contract.name !== name || !contract.tarball || basename(contract.tarball) !== contract.tarball
      || spec !== `file:.product-tarballs/${contract.tarball}`) throw new Error(`Product tarball contract mismatch: ${name}`)
    const source = join(dirname(packageLockPath), contract.tarball)
    if ((await realpath(source)).toLowerCase() !== resolve(source).toLowerCase()) throw new Error(`Linked product tarball: ${name}`)
    const bytes = await readFile(source)
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
    if (sha256(bytes) !== contract.tarballSHA256 || integrity !== contract.npm?.integrity) throw new Error(`Product tarball integrity mismatch: ${name}`)
    await mkdir(join(output, '.product-tarballs'), {recursive:true})
    await cp(source, join(output, '.product-tarballs', contract.tarball))
  }
}

async function assertInstalled(output, lock, source, extra = {}) {
  const installedDSH = await readJSON(join(output, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))
  if (installedDSH.version !== lock.packageVersion) {
    throw new Error(`installed DSH version mismatch: ${installedDSH.version}`)
  }
  const compatibilityPatches = await patchWindowsRuntime(output)
  await writeFile(join(output, '.chatecnu-dsh-runtime.json'), `${JSON.stringify({
    schemaVersion: 2,
    dshCommit: lock.commit,
    dshVersion: installedDSH.version,
    source,
    platform: process.platform,
    arch: process.arch,
    entry: 'node_modules/@deepseek-ai/dsh/lib/bin.js',
    generatedAt: new Date().toISOString(),
    ...extra,
    compatibilityPatches,
  }, null, 2)}\n`)
}

export function validateNpmRuntimeLock({ manifest, packageLock, packageLockBytes, lock }) {
  const npmContract = lock.runtime?.npm
  if (npmContract?.available !== true || typeof npmContract.packageLockSHA256 !== 'string') {
    throw new Error(`DSH ${lock.packageVersion} has no approved npm runtime yet; use --source source`)
  }
  const packageLockHash = sha256(packageLockBytes)
  if (packageLockHash !== npmContract.packageLockSHA256) {
    throw new Error(`DSH npm package-lock hash mismatch: ${packageLockHash}`)
  }
  if (packageLock.lockfileVersion !== 3 || !packageLock.packages?.['']) throw new Error('npm runtime requires a complete v3 package lock')
  const requestedVersion = manifest.dependencies?.['@deepseek-ai/dsh']
  const lockedVersion = packageLock.packages?.['node_modules/@deepseek-ai/dsh']?.version
  if (requestedVersion !== lock.packageVersion || lockedVersion !== lock.packageVersion) {
    throw new Error(`DSH npm lock mismatch: contract=${lock.packageVersion}, manifest=${requestedVersion}, npm-lock=${lockedVersion}`)
  }
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
        || packageLock.packages[''][field]?.[name] !== version) throw new Error(`Unpinned npm runtime root: ${name}`)
      if (name.startsWith('@eduwork/')) throw new Error(`Product plugin belongs in the separate distribution lock: ${name}`)
    }
  }
  for (const [path, entry] of Object.entries(packageLock.packages)) {
    if (!path) continue
    let url
    try { url = new URL(entry.resolved) } catch { throw new Error(`Non-registry runtime dependency: ${path}`) }
    if (entry.link || url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org'
      || url.username || url.password || url.search || url.hash
      || !/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity ?? '')) throw new Error(`Unverified registry runtime dependency: ${path}`)
    if (/(?:^|\/)node_modules\/@deepseek-ai\/dsh(?:-[^/]+)?$/.test(path) && entry.version !== lock.packageVersion) throw new Error(`Mixed DSH runtime versions: ${path}`)
  }
  return packageLockHash
}

async function prepareNpm({ output, manifestPath, lock, lockPath }) {
  manifestPath ??= resolve(dirname(lockPath), lock.runtime?.npm?.manifest ?? 'npm-runtime/package.json')
  const manifest = await readJSON(manifestPath)
  const packageLockPath = join(dirname(manifestPath), 'package-lock.json')
  const packageLockBytes = await readFile(packageLockPath)
  const packageLock = JSON.parse(packageLockBytes.toString('utf8'))
  const packageLockHash = validateNpmRuntimeLock({ manifest, packageLock, packageLockBytes, lock })
  const existing = await lstat(output).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (existing) throw new Error('Refusing to overwrite an existing npm runtime directory; choose a new cache')
  await mkdir(output, { recursive: true })
  await cp(manifestPath, join(output, 'package.json'))
  await cp(packageLockPath, join(output, 'package-lock.json'))
  await run(resolveNpm(), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], output)
  await cp(packageLockPath, join(output, '.chatecnu-dsh-npm-install-lock.json'))
  await assertInstalled(output, lock, 'npm-lock', { packageLockSHA256: packageLockHash, registry: 'https://registry.npmjs.org', sourceArchiveSHA256: lock.sourceArchiveSHA256 })
}

function platformAllowed(manifest) {
  const allowed = (values, current) => {
    if (!Array.isArray(values) || values.length === 0) return true
    if (values.includes(`!${current}`)) return false
    const positives = values.filter(value => typeof value === 'string' && !value.startsWith('!'))
    return positives.length === 0 || positives.includes(current) || positives.includes('any')
  }
  return allowed(manifest.os, process.platform) && allowed(manifest.cpu, process.arch)
}

async function packedManifest(tarball, cwd) {
  const raw = await run('tar', ['-xOzf', tarball, 'package/package.json'], cwd, true)
  const manifest = JSON.parse(raw)
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`packed DSH package has no name/version: ${tarball}`)
  }
  return manifest
}

async function assertSource(upstream, lock) {
  const markerPath = join(upstream, '.dsh-source-lock.json')
  const marker = await readJSON(markerPath).catch(() => undefined)
  if (marker === undefined) {
    const actualCommit = await run('git', ['rev-parse', 'HEAD'], upstream, true).catch(() => undefined)
    if (actualCommit !== lock.commit) {
      throw new Error(`DSH Git source does not match ${lock.repository}@${lock.commit}: ${upstream}`)
    }
    await run('git', ['diff', '--quiet', '--ignore-submodules', '--exit-code', '--', '.'], upstream)
    await run('git', ['diff', '--cached', '--quiet', '--ignore-submodules', '--exit-code', '--', '.'], upstream)
  } else if (marker.schemaVersion !== 1 || marker.repository !== lock.repository
    || marker.commit !== lock.commit || marker.sourceArchiveSHA256 !== lock.sourceArchiveSHA256) {
    throw new Error(`DSH source is not the archive verified by ${lock.repository}@${lock.commit}: ${upstream}`)
  }
  const root = await readJSON(join(upstream, 'package.json'))
  if (root.version !== lock.packageVersion) {
    throw new Error(`DSH source version mismatch: expected ${lock.packageVersion}, got ${root.version}`)
  }
  const pnpmLockHash = sha256(await readFile(join(upstream, 'pnpm-lock.yaml')))
  if (pnpmLockHash !== lock.pnpmLockSHA256) {
    throw new Error(`DSH source pnpm-lock hash mismatch: ${pnpmLockHash}`)
  }
}

async function prepareSource({ output, upstream, manifestPath, lock, lockPath, reusePacks = false }) {
  if (upstream === undefined) throw new Error('--upstream is required for --source source')
  if (lock.runtime?.source?.available !== true) {
    throw new Error(`DSH ${lock.packageVersion} has no approved source release-pack install lock; use --source npm`)
  }
  await assertSource(upstream, lock)
  let sourceBuildNormalization
  if (lock.runtime.source.buildNormalization !== undefined) {
    const { patchEduworkSourceReproducibility } = await import('../../scripts/patch-eduwork-source-reproducibility.mjs')
    sourceBuildNormalization = await patchEduworkSourceReproducibility({ upstream, lockPath })
  }
  const pnpm = `pnpm@${lock.pnpmVersion}`
  await run(resolveCorepack(), ['prepare', pnpm, '--activate'], upstream)
  const pnpmCommand = resolvePnpm()
  const packRoot = join(upstream, 'dist', 'chatecnu-source-runtime')
  const vendorPack = join(packRoot, 'vendor')
  const dshPack = join(packRoot, 'dsh')
  if (!reusePacks) {
  const proxy = await windowsPnpmProxy(lock)
  // An archive has no Git repository of its own. Never let the official build
  // infer the containing product repository's HEAD as the upstream identity.
  const buildEnvironment = { ...(proxy?.environment ?? process.env), DSH_CLIENT_COMMIT_HASH: lock.commit }
  try {
    await run(pnpmCommand, ['install', '--frozen-lockfile'], upstream, false, buildEnvironment)
    // Ignored build outputs survive a Git checkout, so a clean commit does not
    // prove those generated inputs belong to the requested revision.
    await run(pnpmCommand, ['run', 'clean'], upstream, false, buildEnvironment)
    // The DSH family packer accepts only artifacts produced with the official
    // public client profile. A plain build is intentionally rejected upstream.
    await run(pnpmCommand, ['run', 'build:official'], upstream, false, buildEnvironment)
    const sourceManifest = await readJSON(join(upstream, 'package.json'))
    // 0.1.5's packer uses npm_execpath from the lifecycle to launch pnpm.
    const packInvocation = sourceManifest.scripts?.['release:pack']
      ? ['run', 'release:pack'] : ['exec', 'tsx', 'scripts/release/pack.ts']
    await run(pnpmCommand, [...packInvocation, '--family', 'vendor', '--out', vendorPack, '--concurrency', '4'], upstream, false, buildEnvironment)
    await run(pnpmCommand, [...packInvocation, '--family', 'dsh', '--out', dshPack, '--concurrency', '4'], upstream, false, buildEnvironment)
  } finally {
    if (proxy !== undefined) await rm(proxy.directory, { recursive: true, force: true })
  }

  }
  if (lock.runtime.source.officialClientBuild === true) {
    const record = await readJSON(join(upstream, '.dsh-build/client-build-environment.json'))
    if (record.environment?.DSH_CLIENT_COMMIT_HASH !== lock.commit.slice(0, 7)
      || record.environment?.DSH_CLIENT_VERSION !== lock.packageVersion
      || record.environment?.DSH_CLIENT_BUILD_PROFILE !== 'official') {
      throw new Error('Official source client identity differs from the selected DSH lock; rebuild its packs')
    }
  }
  // Reused packs still pass identity checks and the recorded install lock's
  // integrity verification during npm ci; this only avoids rebuilding them.
  const tarballs = []
  for (const directory of [vendorPack, dshPack]) {
    for (const filename of (await readdir(directory)).filter(name => name.endsWith('.tgz')).sort()) {
      const path = join(directory, filename)
      const bytes = await readFile(path)
      tarballs.push({ path, manifest: await packedManifest(path, upstream), sha256: sha256(bytes) })
    }
  }
  if (tarballs.length === 0) throw new Error('DSH official release pack produced no tarballs')
  const identities = new Map()
  for (const item of tarballs) {
    const previous = identities.get(item.manifest.name)
    if (previous !== undefined) throw new Error(`duplicate packed DSH package: ${item.manifest.name}`)
    identities.set(item.manifest.name, item)
  }
  const cli = identities.get('@deepseek-ai/dsh')
  if (cli?.manifest.version !== lock.packageVersion) {
    throw new Error(`official release pack does not contain @deepseek-ai/dsh@${lock.packageVersion}`)
  }

  const sourceContract = lock.runtime?.source
  if (typeof sourceContract?.installManifest !== 'string'
    || typeof sourceContract.installLock !== 'string'
    || typeof sourceContract.installLockSHA256 !== 'string') {
    throw new Error('LOCK.json has no reviewed source Runtime install lock')
  }
  const sourceManifestPath = resolve(dirname(lockPath), sourceContract.installManifest)
  const sourceLockPath = resolve(dirname(lockPath), sourceContract.installLock)
  const sourceLockBytes = await readFile(sourceLockPath)
  const sourceLockHash = sha256(sourceLockBytes)
  if (sourceLockHash !== sourceContract.installLockSHA256) {
    throw new Error(`DSH source Runtime package-lock hash mismatch: ${sourceLockHash}`)
  }
  const sourceManifest = await readJSON(sourceManifestPath)
  const sourcePackageLock = JSON.parse(sourceLockBytes.toString('utf8'))
  if (sourcePackageLock.packages?.['node_modules/@deepseek-ai/dsh']?.version !== lock.packageVersion) {
    throw new Error('DSH source Runtime install lock does not contain the locked CLI')
  }
  for (const item of tarballs) {
    const declared = platformAllowed(item.manifest)
      ? sourceManifest.dependencies?.[item.manifest.name]
      : sourceManifest.optionalDependencies?.[item.manifest.name]
    const expected = `file:.source-tarballs/${basename(item.path)}`
    if (declared !== expected) {
      throw new Error(`source Runtime manifest does not lock ${item.manifest.name} to ${expected}`)
    }
  }
  const declaredPackedNames = [
    ...Object.entries(sourceManifest.dependencies ?? {}),
    ...Object.entries(sourceManifest.optionalDependencies ?? {}),
  ].filter(([, value]) => typeof value === 'string' && value.startsWith('file:.source-tarballs/'))
    .map(([name]) => name)
  if (declaredPackedNames.length !== identities.size || declaredPackedNames.some(name => !identities.has(name))) {
    throw new Error('source Runtime manifest and official release-pack identities differ')
  }
  const baseManifest = manifestPath === undefined ? { dependencies: {} } : await readJSON(manifestPath)
  for (const [name, version] of Object.entries(baseManifest.dependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/') && sourceManifest.dependencies?.[name] !== version) {
      throw new Error(`source Runtime manifest external dependency mismatch: ${name}`)
    }
  }
  for (const [name, version] of Object.entries(baseManifest.optionalDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/') && sourceManifest.optionalDependencies?.[name] !== version) throw new Error(`source Runtime optional dependency mismatch: ${name}`)
  }

  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  // npm on Windows does not reliably decode non-ASCII absolute file: URLs.
  // Stage the verified tarballs below the target and install by relative spec.
  const tarballStage = join(output, '.source-tarballs')
  await mkdir(tarballStage, { recursive: true })
  for (const item of tarballs) {
    const filename = basename(item.path)
    await cp(item.path, join(tarballStage, filename))
  }
  await cp(sourceManifestPath, join(output, 'package.json'))
  await cp(sourceLockPath, join(output, 'package-lock.json'))
  await stageProductTarballs(output, lockPath, sourceManifest)
  try {
    await run(resolveNpm(), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], output)
  } finally {
    await rm(tarballStage, { recursive: true, force: true })
    await rm(join(output, '.product-tarballs'), {recursive:true,force:true})
  }
  await cp(join(output, 'package-lock.json'), join(output, '.chatecnu-dsh-source-install-lock.json'))
  await rm(join(output, 'package-lock.json'))
  // The tarball staging directory is intentionally ephemeral. Leave a valid,
  // human-readable inventory behind instead of dangling file: references.
  const installedDependencies = Object.fromEntries(await Promise.all(Object.keys(sourceManifest.dependencies ?? {}).map(async name => [name, (await readJSON(join(output, 'node_modules', name, 'package.json'))).version])))
  await writeFile(join(output, 'package.json'), `${JSON.stringify({
    name: 'chatecnu-work-dsh-source-runtime',
    version: '0.0.0',
    private: true,
    description: `Installed ${sourceBuildNormalization ? 'reviewed normalized source' : 'official release'} packs from ${lock.repository}@${lock.commit}`,
    dependencies: installedDependencies,
    optionalDependencies: Object.fromEntries(Object.keys(sourceManifest.optionalDependencies ?? {}).map(name => [name, identities.get(name)?.manifest.version ?? sourceManifest.optionalDependencies[name]])),
  }, null, 2)}\n`)
  const packRecords = tarballs.map(item => ({
    name: item.manifest.name,
    version: item.manifest.version,
    sha256: item.sha256,
  })).sort((left, right) => left.name.localeCompare(right.name))
  const packManifestSHA256 = sha256(Buffer.from(JSON.stringify(packRecords)))
  await writeFile(join(output, '.chatecnu-dsh-source-pack.json'), `${JSON.stringify({
    schemaVersion: 1,
    repository: lock.repository,
    commit: lock.commit,
    sourceBuildNormalization,
    packages: packRecords,
  }, null, 2)}\n`)
  await assertInstalled(output, lock, 'source-release-pack', {
    sourceArchiveSHA256: lock.sourceArchiveSHA256,
    sourceBuildNormalization,
    pnpmLockSHA256: lock.pnpmLockSHA256,
    sourceInstallLockSHA256: sourceLockHash,
    packManifestSHA256,
    packedPackages: packRecords.length,
  })
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const lock = await readJSON(options.lock)
  const source = options.source ?? lock.runtime?.defaultSource ?? 'npm'
  if (source === 'npm') await prepareNpm({ output: options.output, manifestPath: options.manifest, lock, lockPath: options.lock })
  else if (source === 'source') await prepareSource({ output: options.output, upstream: options.upstream, manifestPath: options.manifest, lock, lockPath: options.lock, reusePacks: options.reusePacks })
  else throw new Error(`unsupported DSH runtime source: ${source}`)
  console.log(`ChatECNU Work ${source} runtime prepared at ${options.output}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
