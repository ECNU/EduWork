import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const stripWindowsAlias = path => process.platform === 'win32'
  ? path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/i, '').replace(/^\\\\\.\\/i, '')
  : path

export const comparablePath = path => {
  let value = stripWindowsAlias(resolve(path))
  if (process.platform === 'win32') value = value.toLowerCase()
  return value
}

export const instanceIdentity = target => {
  const resolved = resolve(target)
  const suffix = []
  let current = resolved
  for (;;) {
    try {
      const real = realpathSync.native ? realpathSync.native(current) : realpathSync(current)
      return comparablePath(join(real, ...suffix.reverse()))
    } catch {
      const parent = dirname(current)
      if (parent === current) return comparablePath(resolved)
      suffix.push(basename(current))
      current = parent
    }
  }
}

export const instanceMutexAddress = (scope, target) => {
  const hash = createHash('sha256').update(`${scope}\0${instanceIdentity(target)}`).digest('hex').slice(0, 32)
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\eduwork-${scope}-${hash}`
    : join(tmpdir(), `eduwork-${scope}-${hash}.sock`)
}

function listenMutex(server, address) {
  return new Promise((resolveListen, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error) }
    const onListening = () => { server.off('error', onError); resolveListen() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(address)
  })
}

function canConnect(address) {
  return new Promise(resolveConnect => {
    const socket = connect(address)
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      socket.destroy()
      resolveConnect(value)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    setTimeout(() => finish(false), 500).unref()
  })
}

export async function acquireInstanceMutex(scope, target, busyMessage = `Another process is using ${scope}`) {
  const address = instanceMutexAddress(scope, target)
  let server = createServer(socket => socket.destroy())
  try {
    await listenMutex(server, address)
    return server
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error
    if (process.platform === 'win32' || await canConnect(address)) throw new Error(`${busyMessage}: ${target}`)
    await rm(address, { force: true })
    server = createServer(socket => socket.destroy())
    try {
      await listenMutex(server, address)
      return server
    } catch (retryError) {
      if (retryError.code === 'EADDRINUSE') throw new Error(`${busyMessage}: ${target}`)
      throw retryError
    }
  }
}

export async function releaseInstanceMutex(server) {
  if (!server) return
  await new Promise(resolveClose => server.close(() => resolveClose()))
}
