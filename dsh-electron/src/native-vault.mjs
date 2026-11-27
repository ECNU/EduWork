import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import { ATTENTION_MAX_BYTES } from './task-notifications.mjs'

const MAX_BODY = 512 * 1024
const REF = /^[A-Za-z_][A-Za-z0-9_]{0,511}$/u

function decodeVault(encryption, bytes) {
  const value = JSON.parse(encryption.decryptString(bytes))
  if (Number.isInteger(value?.schemaVersion) && value.schemaVersion !== 1) {
    throw Object.assign(new Error('Unsupported credential vault version'), { code: 'VAULT_VERSION' })
  }
  if (value?.schemaVersion !== 1 || !value.values || typeof value.values !== 'object' || Array.isArray(value.values)) throw new Error('Invalid encrypted vault')
  for (const [key, secret] of Object.entries(value.values)) if (!REF.test(key) || typeof secret !== 'string') throw new Error('Invalid encrypted vault entry')
  return Object.assign(Object.create(null), value.values)
}

export class EncryptedVault {
  constructor(path, encryption, { confirmReplacement = () => false, onUnreadable = () => {} } = {}) {
    this.path = path
    this.encryption = encryption
    this.confirmReplacement = confirmReplacement
    this.onUnreadable = onUnreadable
    this.queue = Promise.resolve()
  }
  async flush() { await this.queue }
  async read(operation = 'resolve') {
    let bytes
    try { bytes = await readFile(this.path) } catch (error) { if (error.code === 'ENOENT') return Object.create(null); throw error }
    try {
      return decodeVault(this.encryption, bytes)
    } catch (error) {
      if (error.code === 'VAULT_VERSION') throw error
      // A locked keychain and a permanently unreadable vault can look alike.
      // A startup probe can continue signed out; the next read retries the original.
      if (operation === 'resolve' || operation === 'describe') return Object.create(null)
      if (operation !== 'set' || !await this.confirmReplacement()) throw error
      const current = await readFile(this.path)
      if (!current.equals(bytes)) throw new Error('Credential vault changed during recovery; retry')
      try { return decodeVault(this.encryption, current) } catch (retryError) {
        if (retryError.code === 'VAULT_VERSION') throw retryError
      }
      // Keep the original at its live path until the normal atomic write succeeds.
      const aside = `${this.path}.unreadable-${randomBytes(12).toString('hex')}`
      await writeFile(aside, bytes, { flag: 'wx', mode: 0o600 })
      this.onUnreadable({ aside })
      return Object.create(null)
    }
  }
  async operation(operation, ref, value) {
    if (typeof ref !== 'string' || !REF.test(ref)) throw new Error('Invalid credential reference')
    if (operation === 'set' && (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 256 * 1024)) throw new Error('Invalid credential value')
    if (!['resolve', 'describe', 'set', 'unset'].includes(operation)) throw new Error('Invalid credential operation')
    const result = this.queue.then(async () => {
      const values = await this.read(operation)
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

export async function startNativeBridge({ vault, openExternal, openConfiguration, workbench, attention, pet, pickDirectory, workspaceAccess }) {
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
        // The bounded attention snapshot contains up to 200 core and 200 plugin
        // rows, including multibyte titles/previews. Other bridge limits stay put.
        // Per-source queues plus the core Agent allowance; other bridge limits stay put.
        const limit = request.url === '/v1/extensions/attention' ? ATTENTION_MAX_BYTES : MAX_BODY
        if (length > limit) { response.writeHead(413).end(); request.destroy(); return }
        parts.push(part)
      }
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'))
      if (closing) { response.writeHead(503).end(); return }
      if (request.url === '/v1/desktop/pick-directory') {
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new Error('Invalid directory request')
        if (!pickDirectory) { response.writeHead(501).end(); return }
        const controller = new AbortController()
        const disconnected = () => { if (!response.writableEnded) controller.abort() }
        response.once('close', disconnected)
        try {
          if (response.destroyed) controller.abort()
          const path = await pickDirectory(controller.signal)
          if (!response.destroyed) response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ path }))
        } finally { response.removeListener('close', disconnected) }
        return
      }
      if (request.url === '/v1/desktop/workspace-access') {
        if (!body || Object.keys(body).length !== 1 || typeof body.path !== 'string' || body.path.length > 32767 || !isAbsolute(body.path)) throw new Error('Invalid workspace path')
        if (!workspaceAccess) { response.writeHead(501).end(); return }
        const controller = new AbortController()
        const disconnected = () => controller.abort()
        response.once('close', disconnected)
        try {
          if (response.destroyed) controller.abort()
          const result = await workspaceAccess(body.path, controller.signal)
          if (!response.destroyed) response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result))
        } finally { response.removeListener('close', disconnected) }
        return
      }
      if (request.url === '/v1/extensions/attention') {
        if (!attention) { response.writeHead(501).end(); return }
        const result = JSON.stringify(await attention(body))
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(result); return
      }
      if (request.url === '/v1/extensions/pet') {
        if (!pet) { response.writeHead(501).end(); return }
        const result = JSON.stringify(await pet(body))
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(result); return
      }
      if (request.url === '/v1/extensions/workbench') {
        if (!body || Object.keys(body).length !== 1 || !['status','check-updates','diagnostics','download-update','schedule-update','install-update','use-stable-updates','use-development-updates','download-content-update','restart-content-update','enable-automatic-download','disable-automatic-download','enable-software-updates','disable-software-updates','start-portable-migration','dismiss-portable-migration','cancel-portable-migration'].includes(body.action)) throw new Error('Invalid desktop action')
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
