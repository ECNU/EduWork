// Prepares the pinned DSH upstream source (verified archive download or Git
// checkout) and optionally runs the locked official build. Node.js port of
// sync-dsh-upstream.ps1.
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import {
  capture, copyFileTo, download, ensureDir, fullPath, isFile, isMainModule, isWindows,
  nodeBundledCli, pathExists, readJSON, readdirNames, removeTree, run, runBundledCli,
  sha256File, writeJSON,
} from '../../scripts/lib/build-util.mjs'
import { testDshCompatibility } from './test-dsh-compatibility.mjs'

const scriptRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = fullPath(join(scriptRoot, '..', '..'))

async function installLockedSourceArchive({ destination, lock, sourceArchive }) {
  const commit = String(lock.commit)
  const archiveSHA256 = String(lock.sourceArchiveSHA256).toLowerCase()
  let replaceRecognized = false
  if (await pathExists(destination)) {
    const marker = join(destination, '.dsh-source-lock.json')
    if (await isFile(marker)) {
      const current = await readJSON(marker)
      if (String(current.commit) === commit && String(current.sourceArchiveSHA256).toLowerCase() === archiveSHA256) return
      if (Number(current.schemaVersion) === 1 && String(current.repository) === String(lock.repository)) {
        replaceRecognized = true
      }
    }
    if (!replaceRecognized) {
      throw new Error(`Refusing to replace an unrecognized DSH source directory: ${destination}`)
    }
  }
  const temporary = join(tmpdir(), `chatecnu-dsh-${randomUUID().replaceAll('-', '')}`)
  const archive = join(temporary, 'source.tar.gz')
  const extract = join(temporary, 'extract')
  try {
    await ensureDir(extract)
    if (sourceArchive) {
      if (!await isFile(sourceArchive)) throw new Error(`DSH source archive cache is missing: ${sourceArchive}`)
      await copyFileTo(sourceArchive, archive)
    } else {
      await download(String(lock.sourceArchiveURL), archive)
    }
    const actualSHA256 = await sha256File(archive)
    if (actualSHA256 !== archiveSHA256) throw new Error(`DSH source archive SHA-256 mismatch: ${actualSHA256}`)
    await run('tar', ['-xzf', archive, '-C', extract], { echo: false })
    const entries = await readdirNames(extract)
    const sourceName = entries[0]
    if (!sourceName) throw new Error('DSH source archive did not contain a root directory.')
    const destinationParent = dirname(destination)
    const incoming = join(destinationParent, `.dsh-source-incoming-${randomUUID().replaceAll('-', '')}`)
    const previous = join(destinationParent, `.dsh-source-previous-${randomUUID().replaceAll('-', '')}`)
    await ensureDir(destinationParent)
    await rename(join(extract, sourceName), incoming)
    await writeJSON(join(incoming, '.dsh-source-lock.json'), {
      schemaVersion: 1,
      repository: String(lock.repository),
      commit,
      sourceArchiveSHA256: archiveSHA256,
    })
    try {
      if (replaceRecognized) await rename(destination, previous)
      await rename(incoming, destination)
      await removeTree(previous)
    } catch (error) {
      if (!await pathExists(destination) && await pathExists(previous)) {
        await rename(previous, destination)
      }
      throw error
    } finally {
      await removeTree(incoming)
    }
  } finally {
    await removeTree(temporary)
  }
}

export async function syncDshUpstream({ upstream = join(repositoryRoot, '.research/upstream/deepseek-harness'), sourceArchive = '', lockPath = '', skipBuild = false } = {}) {
  lockPath = fullPath(lockPath || join(repositoryRoot, 'third_party/dsh/LOCK.json'))
  const lock = await readJSON(lockPath)
  const commit = String(lock.commit)
  const pnpmVersion = String(lock.pnpmVersion)
  upstream = fullPath(upstream)
  if (sourceArchive) sourceArchive = fullPath(sourceArchive)

  if (!await pathExists(join(upstream, '.git'))) {
    await installLockedSourceArchive({ destination: upstream, lock, sourceArchive })
  }

  if (await pathExists(join(upstream, '.git'))) {
    const actual = await capture('git', ['-C', upstream, 'rev-parse', 'HEAD'])
    if (actual !== commit) {
      await run('git', ['-C', upstream, 'fetch', 'origin', commit, '--depth=1'])
        .catch(() => { throw new Error(`Cannot fetch locked DSH commit ${commit}. The archive fallback is used only for a clean source directory.`) })
      await run('git', ['-C', upstream, 'checkout', '--detach', commit])
    }
  }

  await testDshCompatibility({ upstream, lockPath })

  if (!skipBuild) {
    if (lock.runtime?.source?.buildNormalization) {
      await run(process.execPath, [join(repositoryRoot, 'scripts/patch-eduwork-source-reproducibility.mjs'), '--upstream', upstream, '--lock', lockPath])
        .catch(() => { throw new Error('Reviewed source build normalization failed') })
    }
    let proxyDirectory = null
    const environment = { DSH_CLIENT_COMMIT_HASH: commit }
    try {
      if (isWindows) {
        // Lifecycle scripts invoke `pnpm` by name; provide the locked proxy on
        // PATH so they resolve the pinned corepack pnpm instead of a global one.
        const corepackScript = await nodeBundledCli('corepack')
        if (!corepackScript) throw new Error('Corepack JavaScript entry not found beside Node.js')
        proxyDirectory = join(tmpdir(), `chatecnu-pnpm-proxy-${randomUUID().replaceAll('-', '')}`)
        await ensureDir(proxyDirectory)
        const proxy = join(proxyDirectory, 'pnpm.exe')
        await run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', proxy, join(scriptRoot, 'pnpm-proxy-windows.go')])
        environment.Path = `${proxyDirectory};${process.env.Path ?? process.env.PATH ?? ''}`
        environment.CHATECNU_PNPM_NODE = process.execPath
        environment.CHATECNU_COREPACK_JS = corepackScript
        environment.CHATECNU_PNPM_VERSION = pnpmVersion
      }
      const pnpm = args => runBundledCli('corepack', [`pnpm@${pnpmVersion}`, ...args], { cwd: upstream, env: environment })
      await pnpm(['install', '--frozen-lockfile'])
      await pnpm(['run', 'clean'])
      await pnpm(['run', 'build:official'])
      const releasePackRoot = join(upstream, 'dist', 'chatecnu-source-runtime')
      await removeTree(releasePackRoot)
      const sourcePackage = await readJSON(join(upstream, 'package.json'))
      const packInvocation = sourcePackage.scripts?.['release:pack'] ? ['run', 'release:pack'] : ['exec', 'tsx', 'scripts/release/pack.ts']
      await pnpm([...packInvocation, '--family', 'vendor', '--out', 'dist/chatecnu-source-runtime/vendor', '--concurrency', '4'])
      await pnpm([...packInvocation, '--family', 'dsh', '--out', 'dist/chatecnu-source-runtime/dsh', '--concurrency', '4'])
    } finally {
      if (proxyDirectory) await removeTree(proxyDirectory)
    }
  }

  console.log(`DSH ready: ${commit}`)
}

if (isMainModule(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      upstream: { type: 'string' },
      'source-archive': { type: 'string' },
      lock: { type: 'string' },
      'skip-build': { type: 'boolean' },
    },
  })
  await syncDshUpstream({
    ...(values.upstream ? { upstream: values.upstream } : {}),
    sourceArchive: values['source-archive'] ?? '',
    lockPath: values.lock ?? '',
    skipBuild: Boolean(values['skip-build']),
  })
}
