import {access, stat} from 'node:fs/promises'
import {constants} from 'node:fs'
import {homedir} from 'node:os'
import {delimiter, join, isAbsolute} from 'node:path'
import {Readable, Writable} from 'node:stream'
import {PROTOCOL_VERSION, client, methods, ndJsonStream} from '@agentclientprotocol/sdk'

export async function executable(path) {
  if (!isAbsolute(path)) return false
  try { await access(path, constants.X_OK); return (await stat(path)).isFile() } catch { return false }
}
export async function discover({home = homedir(), path = process.env.PATH ?? '', platform = process.platform} = {}) {
  const dirs = [...new Set([join(home, '.local/bin'), join(home, '.cursor/bin'), ...path.split(delimiter).filter(isAbsolute)])]
  const find = async names => { for (const name of names) if (await executable(name)) return name; return null }
  const suffix = platform === 'win32' ? '.exe' : ''
  const codex = await find(dirs.map(dir => join(dir, 'codex' + suffix)))
  const cursor = await find(dirs.map(dir => join(dir, 'agent' + suffix)))
  const app = platform === 'darwin' && await stat('/Applications/Cursor.app').then(s => s.isDirectory(), () => false)
  return [{id: 'codex', name: 'Codex', kind: 'codex', command: codex, args: [], installed: !!codex},
    {id: 'cursor', name: 'Cursor', kind: 'acp', command: cursor, args: ['acp'], installed: !!cursor || !!app}]
}

// Explicit user-initiated probe only. DSH owns environment filtering and process cleanup.
// ACP initialization checks protocol support, not authentication or task execution.
export async function probe(subprocess, command, args, {acp = false, timeout = 10000} = {}) {
  let child, connection, timer
  let result = {ok: false, message: 'unavailable'}
  try {
    child = subprocess.spawn({argv: [command, ...args], cwd: homedir(),
      stdio: {stdin: acp ? 'pipe' : 'ignore', stdout: acp ? 'pipe' : 'ignore', stderr: 'ignore'}, graceMs: 1000})
    const exited = child.done.then(({exitCode}) => ({ok: !acp && exitCode === 0, message: !acp && exitCode === 0 ? 'connected' : 'unavailable'}))
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve({ok: false, message: 'timeout'}), timeout) })
    const candidates = [exited, deadline]
    if (acp) {
      let bytes = 0
      const input = Readable.toWeb(child.stdout).pipeThrough(new TransformStream({transform(chunk, controller) {
        bytes += chunk.byteLength
        if (bytes > 65536) throw new Error('ACP probe output exceeded limit')
        controller.enqueue(chunk)
      }}))
      connection = client({name: 'eduwork-agent-check'})
        .onRequest(methods.client.session.requestPermission, () => ({outcome: {outcome: 'cancelled'}}))
        .connect(ndJsonStream(Writable.toWeb(child.stdin), input))
      candidates.push(connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
      }).then(response => ({ok: response.protocolVersion === PROTOCOL_VERSION,
        message: response.protocolVersion === PROTOCOL_VERSION ? 'handshake' : 'invalid_response'})))
    }
    result = await Promise.race(candidates)
  } catch { result = {ok: false, message: acp ? 'invalid_response' : 'unavailable'} }
  finally {
    clearTimeout(timer)
    connection?.close()
    if (child) {
      try { child.terminate(); await child.waitForExit() }
      catch { result = {ok: false, message: 'cleanup_failed'} }
    }
  }
  return result
}
