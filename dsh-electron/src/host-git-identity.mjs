import { readdirSync, lstatSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir as defaultHomedir } from 'node:os'
import path from 'node:path'

const LAUNCHD_DIR = /^com\.apple\.launchd\.[A-Za-z0-9]+$/
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

function pathHasUsrBin(pathValue) {
  if (pathValue == null || pathValue === '') return false
  return pathValue.split(path.delimiter).some(entry => entry === '/usr/bin')
}

function isOwnedAt(lstat, filePath, uid, kind) {
  if (!Number.isInteger(uid)) return false
  try {
    const entry = lstat(filePath)
    return entry.uid === uid && !entry.isSymbolicLink() && entry[kind]()
  } catch {
    return false
  }
}

function isOwnedSocket(lstat, filePath, uid) {
  return typeof filePath === 'string' && path.isAbsolute(filePath)
    && isOwnedAt(lstat, path.dirname(filePath), uid, 'isDirectory')
    && isOwnedAt(lstat, filePath, uid, 'isSocket')
}

function ownedExplicitSocket(lstat, realpath, filePath, uid) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !Number.isInteger(uid)) return undefined
  try {
    const original = lstat(filePath)
    const parent = lstat(path.dirname(filePath))
    if (parent.isSymbolicLink() && parent.uid !== uid) return undefined
    if (original.uid !== uid || (!original.isSocket() && !original.isSymbolicLink())) return undefined
    // A user-selected agent may use an alias (for example a third-party agent).
    // Pass the verified canonical target to the Host, so a mutable alias cannot
    // redirect it after validation. Discovery never follows aliases.
    const target = realpath(filePath)
    return isOwnedSocket(lstat, target, uid) ? target : undefined
  } catch {
    return undefined
  }
}

function launchdSshAuthSock() {
  try {
    return execFileSync('/bin/launchctl', ['getenv', 'SSH_AUTH_SOCK'], {
      encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

function discoverLaunchdSshSocket(socketRoot, listDir, lstat, uid) {
  let bestPath = null
  let bestMtime = -Infinity
  let entries
  try {
    entries = listDir(socketRoot).sort()
  } catch {
    return null
  }
  // Prefer the newest owned socket; lexical order breaks timestamp ties.
  // The current user's launchd environment takes precedence over this fallback.
  for (const name of entries) {
    if (!LAUNCHD_DIR.test(name)) continue
    const listener = path.join(socketRoot, name, 'Listeners')
    if (!isOwnedSocket(lstat, listener, uid)) continue
    let mtime
    try {
      mtime = lstat(listener).mtimeMs
    } catch {
      continue
    }
    if (Number.isFinite(mtime) && mtime > bestMtime) {
      bestMtime = mtime
      bestPath = listener
    }
  }
  return bestPath
}

function resolveSshAuthSock(env, socketRoot, listDir, lstat, realpath, uid, readLaunchdSocket) {
  const current = ownedExplicitSocket(lstat, realpath, env.SSH_AUTH_SOCK, uid)
  if (current) {
    return { status: 'inherited', value: current }
  }
  let sessionSocket
  try { sessionSocket = readLaunchdSocket() } catch { /* Fall back to owned launchd sockets. */ }
  const session = ownedExplicitSocket(lstat, realpath, sessionSocket, uid)
  if (session) {
    return { status: 'launchd', value: session }
  }
  const discovered = discoverLaunchdSshSocket(socketRoot, listDir, lstat, uid)
  if (discovered) {
    return { status: 'discovered', value: discovered }
  }
  delete env.SSH_AUTH_SOCK
  return { status: 'absent', value: undefined }
}

function applyHome(env, homedirFn) {
  const current = env.HOME
  if (current == null || current === '') {
    env.HOME = homedirFn()
    return 'filled'
  }
  return 'kept'
}

function applyPath(env) {
  const current = env.PATH
  if (current == null || current === '') {
    env.PATH = SYSTEM_PATH
    return
  }
  if (!pathHasUsrBin(current)) {
    env.PATH = current + path.delimiter + SYSTEM_PATH
  }
}

export function applyHostGitIdentity(env, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== 'darwin') {
    return {
      ssh: 'skipped',
      home: 'kept',
      systemGitOnPath: pathHasUsrBin(env.PATH),
    }
  }

  const listDir = options.listDir ?? readdirSync
  const lstat = options.lstat ?? lstatSync
  const realpath = options.realpath ?? realpathSync
  const uid = options.uid ?? process.getuid?.()
  const readLaunchdSocket = options.launchdSshAuthSock ?? launchdSshAuthSock
  const socketRoot = options.socketRoot ?? '/private/tmp'
  const homedirFn = options.homedir ?? defaultHomedir

  const ssh = resolveSshAuthSock(env, socketRoot, listDir, lstat, realpath, uid, readLaunchdSocket)
  if (ssh.value) {
    env.SSH_AUTH_SOCK = ssh.value
  }

  const home = applyHome(env, homedirFn)
  applyPath(env)

  return {
    ssh: ssh.status,
    home,
    systemGitOnPath: pathHasUsrBin(env.PATH),
  }
}
