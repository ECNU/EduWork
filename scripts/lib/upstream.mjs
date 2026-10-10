// Shared by Runtime preparation and client compilation. Keeps the disposable
// pnpm source tree out of arbitrarily deep user repository paths on Windows,
// and coordinates concurrent builders on one machine. This is the Node.js
// replacement for resolve-eduwork-upstream.ps1 / with-eduwork-upstream-lock.ps1;
// the lock uses an atomic lock directory instead of a Windows named mutex.
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fullPath, isWindows, removeTree, sha256Text, sleep } from './build-util.mjs'

export async function resolveEduworkUpstream(commit, upstream = '') {
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('An exact DSH source commit is required')
  if (upstream) return fullPath(upstream)
  // macOS /var is a system symlink to /private/var. Resolve only the OS
  // temporary parent before creating our cache; explicit linked sources are
  // still rejected by the build-input validation.
  const temporaryRoot = await realpath(tmpdir())
  return fullPath(join(temporaryRoot, `eduwork-dsh-${commit.slice(0, 12)}`))
}

function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// All supported preparation/assembly entry points serialize work on a shared
// source tree through this lock. Recovery removes locks left by dead processes.
export async function withUpstreamLock(upstream, activity, action) {
  let normalized = fullPath(upstream).replace(/[\\/]+$/, '')
  if (isWindows) normalized = normalized.replaceAll('/', '\\').toUpperCase()
  const lockRoot = join(tmpdir(), 'eduwork-upstream-locks')
  const lockDir = join(lockRoot, sha256Text(normalized))
  await mkdir(lockRoot, { recursive: true })
  let announced = false
  let lastMessage = 0
  for (;;) {
    try {
      await mkdir(lockDir)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    let owner = null
    try {
      owner = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'))
    } catch {
      // Owner metadata may not be written yet or the lock may be releasing.
    }
    if (owner && !processAlive(owner.pid)) {
      await removeTree(lockDir)
      console.log(`Recovered source build lock after a stopped process: ${activity}`)
      continue
    }
    const now = Date.now()
    if (!announced) {
      console.log(`Waiting for shared source build lock: ${activity}`)
      announced = true
      lastMessage = now
    } else if (now - lastMessage >= 30000) {
      console.log(`Still waiting for shared source build lock: ${activity}`)
      lastMessage = now
    }
    await sleep(1000)
  }
  try {
    await writeFile(join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, activity, startedAt: new Date().toISOString() }))
    return await action()
  } finally {
    await removeTree(lockDir)
  }
}
