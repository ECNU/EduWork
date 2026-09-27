import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { ElectronBrowserRuntime } from './browser-runtime.mjs'
import { BrowserProtocol } from './browser-protocol.mjs'

export async function startBrowserServer({ BrowserWindow, panel, WebSocketServer, version, onDiagnostic = () => {} }) {
  const token = randomBytes(32).toString('base64url'), expected = Buffer.from('Bearer ' + token)
  const server = createServer((_request, response) => response.writeHead(403).end())
  const ws = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false })
  const clients = new Map(), owners = new Set()
  let closing = false
  server.on('upgrade', (request, socket, head) => {
    const actual = Buffer.from(request.headers.authorization || '')
    if (closing || request.headers.origin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    let requested
    try { requested = new URL(request.url, 'http://127.0.0.1') } catch { socket.destroy(); return }
    const owner = requested.searchParams.get('owner')
    requested.searchParams.delete('owner')
    const route = /^\/(render|managed)(?:\?mode=(background|visible))?$/.exec(requested.pathname + requested.search)
    if (closing || !route || (owner !== null && (!owner || owner.length > 200 || route[1] !== 'managed' || owners.has(owner)))) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    ws.handleUpgrade(request, socket, head, client => {
      const emit = message => { if (client.readyState === 1) client.send(JSON.stringify(message)) }
      if (owner) owners.add(owner)
      const runtime = panel && owner ? panel.runtimeFor(owner) : new ElectronBrowserRuntime({ BrowserWindow })
      const protocol = new BrowserProtocol({ runtime, emit, version, purpose: route[1], mode: route[1] === 'render' ? 'background' : route[2] ?? 'background' })
      clients.set(client, protocol)
      client.on('message', async bytes => {
        let message
        try {
          message = JSON.parse(bytes.toString())
          if (!Number.isSafeInteger(message.id) || typeof message.method !== 'string') throw Error('Invalid protocol command')
          onDiagnostic({ method: message.method })
          const result = await protocol.command(message)
          emit({ id: message.id, ...(message.sessionId ? { sessionId: message.sessionId } : {}), result })
        } catch (error) {
          onDiagnostic({ method: message?.method, error: error.message })
          if (message?.id) emit({ id: message.id, ...(message.sessionId ? { sessionId: message.sessionId } : {}), error: { code: -32000, message: error.message } })
          else client.close(1008)
        }
      })
      client.on('error', () => client.terminate())
      client.on('close', () => { protocol.close(); clients.delete(client); if (owner) owners.delete(owner) })
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return {
    connection: { baseURL: `ws://127.0.0.1:${server.address().port}`, token },
    async close() {
      if (closing) return
      closing = true
      for (const [client, protocol] of clients) { protocol.close(); client.terminate() }
      await new Promise(resolve => ws.close(resolve))
      await new Promise(resolve => server.close(resolve))
    },
  }
}
