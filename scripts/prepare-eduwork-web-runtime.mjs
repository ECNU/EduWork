// Prepares the pinned DSH Web Runtime cache (npm or source mode). Node.js port
// of prepare-eduwork-web-runtime.ps1.
import { dirname, join, parse } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { fullPath, isFile, isMainModule, pathExists, readJSON, runNode, sha256File } from './lib/build-util.mjs'
import { resolveEduworkUpstream, withUpstreamLock } from './lib/upstream.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))

export async function prepareWebRuntime({ coreRoot = join(scriptRoot, '..'), output, upstream = '', dshLockPath = '', source = 'npm' } = {}) {
  coreRoot = fullPath(coreRoot)
  output = fullPath(output)
  if (!['npm', 'source'].includes(source)) throw new Error('Runtime source must be npm or source')
  if (output === parse(output).root || output === coreRoot) throw new Error('Runtime output must name a dedicated build directory')
  const defaultLock = source === 'npm' ? 'third_party/dsh/release-v0.1.5-rc.2/LOCK.json' : 'third_party/dsh/development-v0.1.5-rc.1/LOCK.json'
  const lockPath = dshLockPath ? fullPath(dshLockPath) : join(coreRoot, defaultLock)
  const lock = await readJSON(lockPath)
  if (source === 'npm') {
    if (lock.runtime?.npm?.available !== true) throw new Error('Selected lock has no approved npm Runtime; use the release lock or explicit source mode for development')
    const identityPath = join(output, '.chatecnu-dsh-runtime.json')
    if (await isFile(identityPath)) {
      const identity = await readJSON(identityPath)
      const proof = join(output, '.chatecnu-dsh-npm-install-lock.json')
      if (identity.source === 'npm-lock' && identity.platform === process.platform && identity.arch === process.arch &&
        identity.dshVersion === lock.packageVersion && identity.dshCommit === lock.commit &&
        identity.packageLockSHA256 === lock.runtime.npm.packageLockSHA256 &&
        await isFile(proof) && await sha256File(proof) === lock.runtime.npm.packageLockSHA256) {
        console.log(`Locked npm Runtime already prepared: ${output}`)
        return
      }
      throw new Error('Runtime cache belongs to another build or source. Select a new output directory.')
    }
    if (await pathExists(output)) throw new Error('Refusing to overwrite an unrecognized runtime directory')
    await runNode(join(coreRoot, 'dsh-desktop/scripts/prepare-dsh-runtime.mjs'), [
      '--output', output, '--lock', lockPath, '--source', 'npm',
      '--manifest', join(dirname(lockPath), lock.runtime.npm.manifest),
    ]).catch(() => { throw new Error('Pinned npm Runtime preparation failed') })
    return
  }
  const resolvedUpstream = await resolveEduworkUpstream(lock.commit, upstream)
  await withUpstreamLock(resolvedUpstream, 'prepare pinned Runtime', async () => {
    // Recheck after acquiring the lock: another preparer may have finished while
    // this process waited. The source verification, build and pack also stay locked.
    const identityPath = join(output, '.chatecnu-dsh-runtime.json')
    if (await isFile(identityPath)) {
      const identity = await readJSON(identityPath)
      if (identity.source === 'source-release-pack' && identity.dshVersion === lock.packageVersion &&
        identity.dshCommit === lock.commit && identity.sourceInstallLockSHA256 === lock.runtime.source.installLockSHA256) {
        console.log(`Locked Runtime already prepared: ${output}`)
        return
      }
      throw new Error('Runtime cache belongs to another build. Select a new output directory.')
    }
    if (await pathExists(output)) throw new Error('Refusing to overwrite an unrecognized runtime directory')
    const environment = { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }
    const { syncDshUpstream } = await import(pathToFileURL(join(coreRoot, 'dsh-desktop/scripts/sync-dsh-upstream.mjs')).href)
    const previousElectronSkip = process.env.ELECTRON_SKIP_BINARY_DOWNLOAD
    process.env.ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    try {
      await syncDshUpstream({ upstream: resolvedUpstream, lockPath, skipBuild: true })
        .catch(error => { throw new Error(`Pinned source verification failed: ${error.message}`) })
      const lockFolder = dirname(lockPath)
      const baseManifest = await isFile(join(lockFolder, 'runtime-base.json'))
        ? join(lockFolder, 'runtime-base.json')
        : join(coreRoot, 'third_party/dsh/development-v0.1.5-rc.1/runtime-base.json')
      await runNode(join(coreRoot, 'dsh-desktop/scripts/prepare-dsh-runtime.mjs'), [
        '--output', output, '--lock', lockPath, '--source', 'source',
        '--manifest', baseManifest, '--upstream', resolvedUpstream,
      ], { env: environment }).catch(() => { throw new Error('Pinned source Runtime preparation failed') })
    } finally {
      if (previousElectronSkip === undefined) delete process.env.ELECTRON_SKIP_BINARY_DOWNLOAD
      else process.env.ELECTRON_SKIP_BINARY_DOWNLOAD = previousElectronSkip
    }
  })
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'core-root': { type: 'string' },
      output: { type: 'string' },
      upstream: { type: 'string' },
      'dsh-lock': { type: 'string' },
      source: { type: 'string' },
    },
  })
  if (!values.output) throw new Error('Use --output <runtime-directory> [--core-root <repo>] [--upstream <cache>] [--dsh-lock <LOCK.json>] [--source npm|source]')
  await prepareWebRuntime({
    ...(values['core-root'] ? { coreRoot: values['core-root'] } : {}),
    output: values.output,
    upstream: values.upstream ?? '',
    dshLockPath: values['dsh-lock'] ?? '',
    source: values.source ?? 'npm',
  })
}
