import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { globSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { fullPath, runBundledCli, runNode } from './lib/build-util.mjs'
import { resolveEduworkUpstream, withUpstreamLock } from './lib/upstream.mjs'

const ownPath = fileURLToPath(import.meta.url)
const hash = value => createHash('sha256').update(value).digest('hex')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const present = async path => lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error })
const markerName = '.eduwork-build-tools.json'
const requiredLibraries = ['@deepseek-ai/cosmokit', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-file-reference', '@deepseek-ai/dsh-util-workspace-path']

function inside(root, path) {
  const rel = relative(root, path)
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep) && resolve(root, rel) === resolve(path)
}

export async function libraryDigest(directory) {
  const rows = []
  const walk = async (base, prefix = '') => {
    for (const entry of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = join(base, entry.name), name = prefix + entry.name
      if (entry.isSymbolicLink()) throw new Error(`Build library must not contain links: ${name}`)
      if (entry.isDirectory()) await walk(file, name + '/')
      else if (entry.isFile()) rows.push([name, hash(await readFile(file))])
      else throw new Error(`Unsupported build library entry: ${name}`)
    }
  }
  const stat = await present(directory)
  if (!stat) return null
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Build library must be a real directory')
  await walk(directory)
  return { sha256: hash(JSON.stringify(rows)), files: rows.length }
}

async function toolFiles(upstream) {
  const names = ['node_modules/tsdown/package.json', 'node_modules/lightningcss/package.json', 'node_modules/.pnpm/lock.yaml', `node_modules/.bin/tsdown${process.platform === 'win32' ? '.cmd' : ''}`]
  const files = {}
  for (const name of names) {
    if (!await present(join(upstream, name))) return null
    files[name] = hash(await readFile(join(upstream, name)))
  }
  return files
}

async function context({ upstream, runtimePackages, lockPath }) {
  upstream = resolve(upstream); runtimePackages = resolve(runtimePackages); lockPath = resolve(lockPath)
  if (await present(join(upstream, '.git'))) throw new Error('Refusing to mutate a developer Git checkout')
  if ((await realpath(upstream)).toLowerCase() !== upstream.toLowerCase()) throw new Error('Build source root must not be linked')
  const lock = await json(lockPath), source = await json(join(upstream, '.dsh-source-lock.json'))
  if (source.schemaVersion !== 1 || source.commit !== lock.commit || source.repository !== lock.repository || source.sourceArchiveSHA256 !== lock.sourceArchiveSHA256) throw new Error('Build source archive identity mismatch')
  if (hash(await readFile(join(upstream, 'pnpm-lock.yaml'))) !== lock.pnpmLockSHA256 || (await json(join(upstream, 'package.json'))).version !== lock.packageVersion) throw new Error('Build source version or pnpm lock mismatch')
  for (const file of lock.runtime.source?.buildNormalization?.files ?? []) if (hash(await readFile(join(upstream, file.path))) !== file.afterSHA256) throw new Error(`Build source normalization mismatch: ${file.path}`)
  const runtimeRoot = dirname(runtimePackages), runtime = await json(join(runtimeRoot, '.chatecnu-dsh-runtime.json'))
  if (runtimeRoot === upstream || inside(upstream, runtimeRoot) || inside(runtimeRoot, upstream)) throw new Error('Build source and Runtime must use disjoint directories')
  if ((await realpath(runtimePackages)).toLowerCase() !== runtimePackages.toLowerCase()) throw new Error('Build input Runtime must not be linked')
  const npm = runtime.source === 'npm-lock'
  if (!npm && runtime.source !== 'source-release-pack') throw new Error('Build libraries need an approved npm/source Runtime')
  const proofName = npm ? '.chatecnu-dsh-npm-install-lock.json' : '.chatecnu-dsh-source-install-lock.json'
  const proofBytes = await readFile(join(runtimeRoot, proofName)), inputSHA256 = hash(proofBytes)
  const expectedSHA256 = npm ? lock.runtime.npm?.packageLockSHA256 : lock.runtime.source?.installLockSHA256
  if (runtime.dshVersion !== lock.packageVersion || runtime.dshCommit !== lock.commit || inputSHA256 !== expectedSHA256 || inputSHA256 !== runtime[npm ? 'packageLockSHA256' : 'sourceInstallLockSHA256']) throw new Error('Build library Runtime identity differs from its approved install lock')
  if (runtime.platform && (runtime.platform !== process.platform || runtime.arch !== process.arch)) throw new Error('Build library Runtime belongs to another platform')
  const proof = JSON.parse(proofBytes)
  const policySHA256 = hash(Buffer.concat([await readFile(ownPath), await readFile(join(dirname(ownPath), 'prepare-eduwork-build-tools.ps1'))]))
  const identity = { schemaVersion: 1, kind: 'eduwork-product-client-build-tools', dshCommit: lock.commit, dshVersion: lock.packageVersion, sourceArchiveSHA256: lock.sourceArchiveSHA256, pnpmLockSHA256: lock.pnpmLockSHA256, pnpmVersion: lock.pnpmVersion, nodeVersion: process.version, platform: process.platform, arch: process.arch, policySHA256, runtimeSource: runtime.source, runtimeInstallLockSHA256: inputSHA256 }
  return { upstream, runtimePackages, identity, proof }
}

export async function prepareBuildTools(options) {
  const { upstream, runtimePackages, identity, proof } = await context(options)
  const receiptPath = join(upstream, markerName)
  const old = await present(receiptPath) ? await json(receiptPath) : null
  const files = await toolFiles(upstream)
  const toolIdentityKeys = ['dshCommit', 'pnpmLockSHA256', 'pnpmVersion', 'nodeVersion', 'platform', 'arch', 'policySHA256']
  const installNeeded = !files || !old || toolIdentityKeys.some(key => old[key] !== identity[key]) || JSON.stringify(old.toolFiles) !== JSON.stringify(files)
  if (options.phase === 'status') return { ...identity, installNeeded }
  if (options.phase !== 'prepare') throw new Error('Use --phase status or prepare')
  if (!files) throw new Error('Pinned pnpm compiler dependencies have not been installed')
  // These imports load the native bundler/CSS dependencies as well. Mere .cmd
  // presence does not prove an --ignore-scripts install is usable.
  const require = createRequire(join(upstream, 'package.json'))
  await import(pathToFileURL(require.resolve('tsdown')).href)
  const css = await import(pathToFileURL(require.resolve('lightningcss')).href)
  css.transform({ filename: 'probe.css', code: Buffer.from('.probe { color: red }') })
  const libraries = [], expectedNames = new Set(requiredLibraries)
  const manifests = globSync(['vendor/*/package.json', 'packages/*/*/package.json', 'apps/*/package.json', 'native/system/package.json', 'native/system/packages/*/package.json'], { cwd: upstream }).sort()
  for (const manifestPath of manifests) {
    const packageRoot = dirname(join(upstream, manifestPath)), manifest = await json(join(upstream, manifestPath))
    if (!manifest.name?.startsWith('@deepseek-ai/')) continue
    const inputPackage = join(runtimePackages, manifest.name), entry = proof.packages[`node_modules/${manifest.name}`]
    if (!entry || !await present(join(inputPackage, 'package.json'))) continue
    if ((await realpath(inputPackage)).toLowerCase() !== inputPackage.toLowerCase()) throw new Error(`Linked build input package: ${manifest.name}`)
    const inputManifest = await json(join(inputPackage, 'package.json'))
    if (entry.version !== inputManifest.version || inputManifest.name !== manifest.name || inputManifest.version !== manifest.version) throw new Error(`Build library package identity mismatch: ${manifest.name}`)
    const input = join(inputPackage, 'lib'), output = join(packageRoot, 'lib'), digest = await libraryDigest(input)
    if (!digest) continue
    // Only generated lib directories inside the verified archive are managed.
    // RuntimePackages is read-only and must remain entirely separate.
    if (!inside(upstream, output) || inside(runtimePackages, output) || (await realpath(packageRoot)).toLowerCase() !== packageRoot.toLowerCase()) throw new Error('Build library destination escaped the verified archive')
    const previous = await libraryDigest(output)
    const changed = previous?.sha256 !== digest.sha256
    if (changed) { await rm(output, { recursive: true, force: true }); await cp(input, output, { recursive: true }) }
    const installed = await libraryDigest(output)
    if (installed?.sha256 !== digest.sha256) throw new Error(`Build library copy verification failed: ${manifest.name}`)
    libraries.push({ name: manifest.name, version: manifest.version, workspacePath: manifestPath.replaceAll('\\', '/').replace(/\/package\.json$/, ''), inputLibSHA256: digest.sha256, installedLibSHA256: installed.sha256, files: digest.files, changed })
    expectedNames.delete(manifest.name)
  }
  if (expectedNames.size) throw new Error(`Required inline build libraries are missing: ${[...expectedNames].join(', ')}`)
  const receipt = { ...identity, preparedAt: new Date().toISOString(), ignoreScripts: true, toolFiles: files, libraries }
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n')
  return { ...identity, libraryPackages: libraries.length, replacedLibraries: libraries.filter(item => item.changed).length, librariesSHA256: hash(JSON.stringify(libraries.map(({ changed, ...item }) => item))) }
}

// Full provisioning flow (the former prepare-eduwork-build-tools.ps1): verify
// the pinned disposable source archive, normalize it, then install and prepare
// the compiler workspace under the shared upstream lock.
export async function provisionBuildTools({ coreRoot = join(dirname(ownPath), '..'), runtimePackages, upstream = '', dshLockPath = '', sourceArchive = '' } = {}) {
  coreRoot = fullPath(coreRoot)
  runtimePackages = fullPath(runtimePackages)
  const lockPath = dshLockPath ? fullPath(dshLockPath) : join(coreRoot, 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json')
  const lock = await json(lockPath)
  const resolvedUpstream = await resolveEduworkUpstream(lock.commit, upstream)
  await withUpstreamLock(resolvedUpstream, 'prepare product client build tools', async () => {
    // Builds use a disposable verified archive, never a developer Git checkout.
    if (await present(join(resolvedUpstream, '.git'))) throw new Error('Product build tools require a disposable source archive cache, not a developer Git checkout')
    const { syncDshUpstream } = await import(pathToFileURL(join(coreRoot, 'dsh-desktop/scripts/sync-dsh-upstream.mjs')).href)
    await syncDshUpstream({
      upstream: resolvedUpstream,
      lockPath,
      skipBuild: true,
      ...(sourceArchive ? { sourceArchive: fullPath(sourceArchive) } : {}),
    }).catch(error => { throw new Error(`Pinned build source verification failed: ${error.message}`) })
    await runNode(join(coreRoot, 'scripts/patch-eduwork-source-reproducibility.mjs'), ['--upstream', resolvedUpstream, '--lock', lockPath])
      .catch(() => { throw new Error('Pinned client build normalization failed') })
    const status = await prepareBuildTools({ upstream: resolvedUpstream, runtimePackages, lockPath, phase: 'status' })
    if (status.installNeeded) {
      // Only the compiler dependency tree is prepared. No lifecycle scripts,
      // official Runtime build or source release packing runs.
      await runBundledCli('corepack', [`pnpm@${lock.pnpmVersion}`, 'install', '--frozen-lockfile', '--ignore-scripts'], {
        cwd: resolvedUpstream,
        env: { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
      }).catch(error => { throw new Error(`Pinned client build tool dependency installation failed: ${error.message}`) })
    }
    await prepareBuildTools({ upstream: resolvedUpstream, runtimePackages, lockPath, phase: 'prepare' })
    console.log(`Product client build tools ready: ${resolvedUpstream}`)
  })
  return resolvedUpstream
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { upstream: { type: 'string' }, 'runtime-packages': { type: 'string' }, lock: { type: 'string' }, phase: { type: 'string' }, 'core-root': { type: 'string' }, 'source-archive': { type: 'string' } } })
  if (!values['runtime-packages']) throw new Error('Use --runtime-packages <verified-runtime/node_modules> [--upstream <archive-cache>] [--lock <LOCK.json>] --phase status|prepare|provision')
  if ((values.phase ?? 'prepare') === 'provision') {
    await provisionBuildTools({
      ...(values['core-root'] ? { coreRoot: values['core-root'] } : {}),
      runtimePackages: values['runtime-packages'],
      upstream: values.upstream ?? '',
      dshLockPath: values.lock ?? '',
      sourceArchive: values['source-archive'] ?? '',
    })
  } else {
    if (!values.upstream || !values.lock) throw new Error('Use --upstream <archive-cache> --runtime-packages <verified-runtime/node_modules> --lock <LOCK.json> --phase status|prepare')
    console.log(JSON.stringify(await prepareBuildTools({ upstream: values.upstream, runtimePackages: values['runtime-packages'], lockPath: values.lock, phase: values.phase ?? 'prepare' })))
  }
}
