import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const INSTALLED_STARTUP_ARGUMENT = '--eduwork-verify-update='
const token = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
const address = id => process.platform === 'win32' ? '\\\\.\\pipe\\eduwork-update-' + id : join(tmpdir(), 'ew-update-' + id + '.sock')

export function installedStartupId(args) {
  const selected = args.filter(arg => arg.startsWith(INSTALLED_STARTUP_ARGUMENT))
  if (!selected.length) return undefined
  const id = selected[0].slice(INSTALLED_STARTUP_ARGUMENT.length)
  if (selected.length !== 1 || !token.test(id)) throw Error('无效的更新启动确认参数')
  return id
}

export function connectInstalledStartup(id, abort) {
  const socket = createConnection(address(id))
  let confirmed = false, sent = false, settle
  const result = new Promise(resolve => { settle = resolve })
  const disconnected = () => {
    if (confirmed || !settle) return
    settle(false); settle = undefined
    abort()
  }
  socket.once('error', disconnected)
  socket.once('close', disconnected)
  socket.on('data', data => {
    if (!sent || data.toString() !== 'A') { socket.destroy(); return }
    confirmed = true
    socket.end('A')
    settle(true)
  })
  return {
    get pending() { return !confirmed },
    ready() {
      if (!socket.destroyed && !sent) { sent = true; socket.write('R') }
      return result
    },
  }
}

export async function superviseInstalledStartup({ start, waitForStop, timeout = 120000, stopTimeout = 15000 }) {
  const id = randomUUID(), server = createServer()
  let child, client, timer, finish
  const completed = new Promise(resolve => { finish = resolve })
  server.on('connection', socket => {
    if (client || !child) { socket.destroy(); return }
    client = socket
    let offered = false
    socket.on('error', () => finish('新版启动确认连接失败'))
    socket.on('data', data => {
      const receipt = data.toString()
      if (!offered && receipt === 'R') {
        offered = true
        socket.write('A')
      } else finish(offered && receipt === 'A' ? '' : '新版启动确认无效')
    })
    socket.on('close', () => finish('新版退出前未完成启动确认'))
  })
  try {
    server.listen(address(id))
    await once(server, 'listening')
    child = start(INSTALLED_STARTUP_ARGUMENT + id)
    const exited = new Promise(resolve => {
      child.once('error', error => { finish('无法启动新版：' + error.message); resolve() })
      child.once('exit', (code, signal) => { finish('新版未完成启动即退出，退出状态 ' + (code ?? signal)); resolve() })
    })
    timer = setTimeout(() => finish('等待新版启动确认超时'), timeout)
    const failure = await completed
    if (!failure && child.exitCode === null && child.signalCode === null) return { ready: true }
    client?.destroy()
    clearTimeout(timer)
    await Promise.race([exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('新版进程仍在运行，已保留两个程序版本')), stopTimeout)
    })])
    await waitForStop()
    return { ready: false, failure: failure || '新版在启动确认期间退出' }
  } finally {
    clearTimeout(timer)
    if (server.listening) server.close()
    client?.destroy()
    child?.unref()
  }
}
