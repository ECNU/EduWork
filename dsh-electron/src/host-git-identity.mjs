import { readdirSync, statSync } from 'node:fs'
import { homedir as defaultHomedir } from 'node:os'
import path from 'node:path'

const LAUNCHD_DIR = /^com\.apple\.launchd\.[A-Za-z0-9]+$/
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

function pathHasUsrBin(pathValue) {
  if (pathValue == null || pathValue === '') return false
  return pathValue.split(path.delimiter).some(entry => entry === '/usr/bin')
}

function isSocketAt(stat, filePath) {
  try {
    const st = stat(filePath)
    return st.isSocket?.() ?? st.isSocket === true
  } catch {
    return false
  }
}

function discoverLaunchdSshSocket(socketRoot, listDir, stat) {
  let bestPath = null
  let bestMtime = -1
  let entries
  try {
    entries = listDir(socketRoot)
  } catch {
    return null
  }
  for (const name of entries) {
    if (!LAUNCHD_DIR.test(name)) continue
    const dir = path.join(socketRoot, name)
    const listener = path.join(dir, 'Listeners')
    if (!isSocketAt(stat, listener)) continue
    let mtime
    try {
      mtime = stat(listener).mtimeMs ?? stat(listener).mtime.getTime()
    } catch {
      continue
    }
    if (mtime > bestMtime) {
      bestMtime = mtime
      bestPath = listener
    }
  }
  return bestPath
}

function resolveSshAuthSock(env, socketRoot, listDir, stat) {
  const current = env.SSH_AUTH_SOCK
  if (current && isSocketAt(stat, current)) {
    return { status: 'inherited', value: current }
  }
  const discovered = discoverLaunchdSshSocket(socketRoot, listDir, stat)
  if (discovered) {
    return { status: 'discovered', value: discovered }
  }
  if (Object.hasOwn(env, 'SSH_AUTH_SOCK')) {
    delete env.SSH_AUTH_SOCK
  }
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
  const stat = options.stat ?? statSync
  const socketRoot = options.socketRoot ?? '/private/tmp'
  const homedirFn = options.homedir ?? defaultHomedir

  const ssh = resolveSshAuthSock(env, socketRoot, listDir, stat)
  if (ssh.status === 'discovered') {
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
