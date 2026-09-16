import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const MAX_BODY = 512 * 1024
const REF = /^[A-Za-z_][A-Za-z0-9_]{0,511}$/u

export class EncryptedVault {
  constructor(path, encryption) {
    this.path = path
    this.encryption = encryption
    this.queue = Promise.resolve()
  }
  async flush() { await this.queue }
  async read() {
    let bytes
    try { bytes = await readFile(this.path) } catch (error) { if (error.code === 'ENOENT') return Object.create(null); throw error }
    const value = JSON.parse(this.encryption.decryptString(bytes))
    if (value.schemaVersion !== 1 || !value.values || typeof value.values !== 'object' || Array.isArray(value.values)) throw new Error('Invalid encrypted vault')
    for (const [key, secret] of Object.entries(value.values)) if (!REF.test(key) || typeof secret !== 'string') throw new Error('Invalid encrypted vault entry')
    return Object.assign(Object.create(null), value.values)
  }
  async operation(operation, ref, value) {
    if (typeof ref !== 'string' || !REF.test(ref)) throw new Error('Invalid credential reference')
    if (operation === 'set' && (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 256 * 1024)) throw new Error('Invalid credential value')
    if (!['resolve', 'describe', 'set', 'unset'].includes(operation)) throw new Error('Invalid credential operation')
    const result = this.queue.then(async () => {
      const values = await this.read()
      if (operation === 'set' || operation === 'unset') {
        if (operation === 'set') values[ref] = value
        else delete values[ref]
        const encrypted = this.encryption.encryptString(JSON.stringify({ schemaVersion: 1, values }))
        await mkdir(dirname(this.path), { recursive: true })
        const temporary = this.path + '.pending'
        await writeFile(temporary, encrypted, { mode: 0o600 })
        await rename(temporary, this.path)
      }
      return { configured: Object.hasOwn(values, ref), writable: true, source: 'os-encrypted-vault',
        ...(operation === 'resolve' && Object.hasOwn(values, ref) ? { value: values[ref] } : {}) }
    })
    this.queue = result.catch(() => {})
    return result
  }
}

export function externalBrowserURL(value) {
  if (typeof value !== 'string' || value.length > 32768) throw new Error('Invalid external URL')
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported external URL')
  return url.href
}

export async function startNativeBridge({ vault, openExternal, openConfiguration, workbench }) {
  const token = randomBytes(32).toString('base64url')
  const authorization = Buffer.from('Bearer ' + token)
  const sockets = new Set()
  let closing = false, shutdown
  const server = createServer(async (request, response) => {
    if (closing) { response.writeHead(503).end(); return }
    response.setHeader('Cache-Control', 'no-store')
    const actual = Buffer.from(request.headers.authorization || '')
    if (request.method !== 'POST' || request.headers.origin || actual.length !== authorization.length || !timingSafeEqual(actual, authorization)) {
      response.writeHead(403).end(); return
    }
    try {
      let length = 0
      const parts = []
      for await (const part of request) {
        length += part.length
        if (length > MAX_BODY) { response.writeHead(413).end(); request.destroy(); return }
        parts.push(part)
      }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
      if (closing) { response.writeHead(503).end(); return }
      if (request.url === '/v1/extensions/workbench') {
        if (!body || Object.keys(body).length !== 1 || !['status','check-updates','diagnostics','download-update','schedule-update','install-update','use-stable-updates','use-development-updates','download-content-update','restart-content-update'].includes(body.action)) throw new Error('Invalid desktop action')
        if (!workbench) { response.writeHead(501).end(); return }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(await workbench(body.action))); return
      }
      if (request.url === '/v1/extensions/open-configuration') {
        if (!body || Object.keys(body).length !== 1 || !['config', 'examples'].includes(body.target)) throw new Error('Invalid configuration target')
        if (!openConfiguration) { response.writeHead(501).end(); return }
        await openConfiguration(body.target)
        response.writeHead(204).end(); return
      }
      if (request.url === '/v1/desktop/open-external') {
        await openExternal(externalBrowserURL(body.url))
        response.writeHead(204).end(); return
      }
      const operation = /^\/v1\/credentials\/(resolve|describe|set|unset)$/u.exec(request.url || '')?.[1]
      if (!operation) { response.writeHead(404).end(); return }
      const result = await vault.operation(operation, body.ref, body.value)
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result))
    } catch { response.writeHead(400).end('Native operation failed') }
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 20_000
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return {
    bootstrap: { schemaVersion: 1, instanceCredential: randomBytes(32).toString('base64url'), nativeBridge: { baseURL: 'http://127.0.0.1:' + server.address().port, token } },
    close() {
      if (shutdown) return shutdown
      closing = true
      shutdown = (async () => {
        for (const socket of sockets) socket.destroy()
        await new Promise(resolve => server.close(resolve))
        // A request can already have entered the serialized write queue when
        // its socket closes. Persist that encrypted operation before app quit.
        await vault.flush()
      })()
      return shutdown
    },
  }
}
