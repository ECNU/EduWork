// A device-gated relay in front of the DSH host.
//
// The original relay in `start-mobile-host.mjs` is a raw TCP pipe: it forwards
// bytes and lets the Host's own cookie decide who gets in. That is enough to put
// a phone on the same host, but it cannot express the two things the issue asks
// for — a device is either holding a valid Host cookie or it is not, and the only
// way to withdraw access is to invalidate the cookie for everyone and restart.
//
// This relay keeps the pipe for everything it does not need to understand, and
// adds one gate in front of it:
//
//   1. Every ordinary request must carry a device credential cookie. A request
//      without one is answered by the relay itself and never reaches the Host.
//   2. The credential is a secret whose digest is all that is stored. A device
//      gets one by redeeming a single-use invitation, which is consumed before
//      it is validated so a replay and a typo leave identical state behind.
//   3. A device that redeems an invitation is *pending* until a human confirms
//      it on this machine. Pending is not trusted.
//   4. Every socket a device holds is registered against it, including
//      WebSocket upgrades. Revoking destroys them — refusing later requests is
//      not revocation, because an established stream keeps delivering events
//      until something closes it.
//
// Verified with `node:test` in `test/listener.test.mjs` against a fake host, so
// the assertions can be about what does and does not reach the Host — which is
// the acceptance question, not an implementation detail.
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { DEVICE_STATUS, confirmDevice, emptyRegistry, listDevices, normalizeRegistry, revokeDevice, upsertDevice } from './registry.js'
import { createInvitation, emptyInvitations, redeemInvitation } from './pairing.js'
import { authenticate, credentialFor, emptyCredentials, issueCredential, revokeCredential } from './credentials.js'
import { LiveConnections } from './connections.js'

/** The cookie the phone carries between requests. */
export const DEVICE_COOKIE = 'eduwork_device'
/** Path prefix served by the relay itself rather than forwarded. */
export const CONTROL_PREFIX = '/__remote'

/**
 * Shown between redeeming an invitation and being confirmed on the machine.
 * Deliberately self-contained: no external asset, no framework, and no state of
 * its own, so it works on a phone that has never seen this page before.
 */
const WAITING_PAGE = `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>等待本机确认</title><style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px;text-align:center}
main{max-width:22rem}h1{font-size:1.25rem;margin:0 0 .75rem}
p{margin:.5rem 0;opacity:.8}.dot{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;
background:currentColor;margin-right:.5rem;animation:p 1.2s ease-in-out infinite}
@keyframes p{0%,100%{opacity:.25}50%{opacity:1}}
.bad{opacity:1;font-weight:600}</style></head><body><main>
<h1><span class="dot"></span>等待这台电脑上确认</h1>
<p>请回到电脑上运行脚本的那个窗口，按 <b>y</b> 授权这台设备。</p>
<p id="note">正在等待…</p>
</main><script>
const note=document.getElementById('note');
const next=new URLSearchParams(location.search).get('next')||'/';
async function poll(){
  try{
    const r=await fetch('${CONTROL_PREFIX}/status',{cache:'no-store'});
    if(r.ok){
      const {status}=await r.json();
      if(status==='trusted'){note.textContent='已授权，正在进入…';location.replace(next);return}
      if(status==='revoked'){note.className='bad';note.textContent='这台设备已被撤销，请重新配对。';return}
    }
  }catch(e){}
  setTimeout(poll,1500);
}
poll();
</script></body></html>`

const PAIRING_TTL_MS = 10 * 60 * 1000
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
/**
 * How stale `lastUsedAt` may get before it is written again.
 *
 * Authentication happens on every request, so persisting on each one turns a
 * single page load into hundreds of whole-file rewrites. The stamp says a device
 * is alive; it does not need to be to the second, so it is refreshed at most
 * once a minute. Nothing else about a request is written at all.
 */
const LAST_USED_QUIET_MS = 60 * 1000

function nowIso() {
  return new Date().toISOString()
}

/** Read the device credential out of a Cookie header. */
export function readDeviceCookie(header) {
  if (typeof header !== 'string' || header === '') return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() !== DEVICE_COOKIE) continue
    const value = decodeURIComponent(part.slice(index + 1).trim())
    const dot = value.indexOf('.')
    if (dot <= 0 || dot === value.length - 1) return undefined
    return { deviceId: value.slice(0, dot), secret: value.slice(dot + 1) }
  }
  return undefined
}

/**
 * Persistent device state: who is paired, what proves it, and which invitations
 * are outstanding. Kept in one file so a half-written revocation cannot leave
 * the registry and the credentials disagreeing.
 */
export class DeviceStore {
  #path
  #state

  constructor(path) {
    this.#path = path
    this.#state = this.#load()
  }

  #load() {
    try {
      const raw = JSON.parse(readFileSync(this.#path, 'utf8'))
      return {
        registry: normalizeRegistry(raw.registry),
        credentials: raw.credentials ?? emptyCredentials(),
        invitations: raw.invitations ?? emptyInvitations(),
      }
    } catch {
      return { registry: emptyRegistry(), credentials: emptyCredentials(), invitations: emptyInvitations() }
    }
  }

  #save() {
    mkdirSync(dirname(this.#path), { recursive: true })
    const temporary = `${this.#path}.tmp`
    writeFileSync(temporary, JSON.stringify(this.#state, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, this.#path)
  }

  get registry() {
    return this.#state.registry
  }

  get credentials() {
    return this.#state.credentials
  }

  devices() {
    return listDevices(this.#state.registry)
  }

  device(deviceId) {
    return this.#state.registry.devices.find(device => device.deviceId === deviceId)
  }

  /** Mint a single-use invitation. */
  invite() {
    const { invitations, code, expiresAt } = createInvitation(this.#state.invitations, {
      ttlMs: PAIRING_TTL_MS,
      now: nowIso(),
    })
    this.#state.invitations = invitations
    this.#save()
    return { code, expiresAt }
  }

  /**
   * Redeem an invitation and register the device as pending.
   *
   * The invitation is consumed before its expiry is checked, so a replay, a late
   * attempt and a typo all leave the same state behind and cannot be told apart.
   * When the plugin reports an expired invitation it still hands back the
   * registry that must be persisted, so that write is not skipped.
   */
  redeem(code, name) {
    let invitations
    try {
      invitations = redeemInvitation(this.#state.invitations, code, nowIso()).invitations
    } catch (error) {
      if (error.invitations !== undefined) {
        this.#state.invitations = error.invitations
        this.#save()
      }
      return { ok: false, reason: 'invalid-invitation' }
    }
    // A device id is a fresh identifier every time: a revoked id can never be
    // revived, so re-pairing the same phone is deliberately a new device.
    const deviceId = randomUUID()
    const registry = upsertDevice(
      this.#state.registry,
      { deviceId, publicKey: randomUUID(), name: name || '未命名设备', status: DEVICE_STATUS.PENDING },
      nowIso(),
    )
    const issued = issueCredential(this.#state.credentials, deviceId, nowIso())
    this.#state = { registry, credentials: issued.store, invitations }
    this.#save()
    return { ok: true, deviceId, secret: issued.secret }
  }

  /** Confirm a pending device. Only ever called from this machine. */
  confirm(deviceId) {
    try {
      this.#state.registry = confirmDevice(this.#state.registry, deviceId, undefined, nowIso())
      this.#save()
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: error.message }
    }
  }

  /**
   * Revoke a device.
   *
   * The credential is dropped rather than disabled, so "revoked" and "cannot
   * authenticate" are one state. The caller still has to close the device's live
   * sockets — this method cannot reach them.
   */
  revoke(deviceId) {
    const result = revokeDevice(this.#state.registry, deviceId, nowIso())
    if (result.revoked === undefined || result.revoked === null) return { ok: false, reason: 'unknown-device' }
    const dropped = revokeCredential(this.#state.credentials, deviceId)
    this.#state.registry = result.registry
    this.#state.credentials = dropped.store
    this.#save()
    return { ok: true, device: result.revoked }
  }

  /**
   * Verify a presented credential and note the use.
   *
   * The verdict never depends on the stamp, so the write is skipped while the
   * recorded stamp is still fresh — see `LAST_USED_QUIET_MS`.
   */
  authenticate(deviceId, secret) {
    const previous = credentialFor(this.#state.credentials, deviceId)?.lastUsedAt ?? null
    const now = nowIso()
    const outcome = authenticate(this.#state.credentials, deviceId, secret, now)
    if (!outcome.ok) return false
    this.#state.credentials = outcome.store
    const stale = previous === null || Date.parse(now) - Date.parse(previous) >= LAST_USED_QUIET_MS
    if (stale) this.#save()
    return true
  }
}

function send(response, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  response.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  response.end(payload)
}

/**
 * Whether a socket address is this machine.
 *
 * Node reports an IPv4 peer on a dual-stack listener as `::ffff:127.0.0.1`, so
 * the mapped form has to be unwrapped rather than compared as-is. This decides
 * who may read the device list — it is not an authentication check and must not
 * be used as one.
 */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false
  const unwrapped = address.startsWith('::ffff:') ? address.slice(7) : address
  if (unwrapped === '::1') return true
  const parts = unwrapped.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/u.test(part) && Number(part) <= 255)
}

/**
 * Build the relay.
 *
 * @param options.hostPort  loopback port of the real DSH host.
 * @param options.store     a `DeviceStore`.
 * @param options.onRequest called with a pending device so the operator can
 *                          confirm it; resolves to whether it was confirmed.
 * @param options.upstreamToken returns the Host's launch token, so a freshly
 *                          paired phone can be sent through the Host's own
 *                          token exchange instead of being handed one by us.
 */
export function createGatedRelay({ hostPort, store, onRequest, upstreamToken, log = () => {} }) {
  const connections = new LiveConnections()
  const pendingPrompts = new Map()

  const promptOnce = (deviceId) => {
    if (pendingPrompts.has(deviceId)) return pendingPrompts.get(deviceId)
    const device = store.device(deviceId)
    const answer = Promise.resolve(onRequest?.(device ?? { deviceId, name: '未命名设备' })).then((granted) => {
      if (granted) store.confirm(deviceId)
      pendingPrompts.delete(deviceId)
      return granted
    })
    pendingPrompts.set(deviceId, answer)
    return answer
  }

  /** Decide whether a request may go upstream, and answer it if not. */
  async function gate(request, response) {
    const cookie = readDeviceCookie(request.headers.cookie)
    if (cookie === undefined) return { allowed: false, status: 401, body: '未配对：请在手机上打开配对链接。' }
    if (!store.authenticate(cookie.deviceId, cookie.secret)) {
      return { allowed: false, status: 401, body: '设备凭据无效或已被撤销，请重新配对。' }
    }
    const device = store.device(cookie.deviceId)
    if (device === undefined) return { allowed: false, status: 401, body: '设备不存在。' }
    if (device.status === DEVICE_STATUS.PENDING) {
      const granted = await promptOnce(cookie.deviceId)
      if (!granted) return { allowed: false, status: 403, body: '本机拒绝了这次配对。' }
    }
    if (device.status === DEVICE_STATUS.REVOKED) return { allowed: false, status: 403, body: '该设备已被撤销。' }
    const refreshed = store.device(cookie.deviceId)
    if (refreshed?.status !== DEVICE_STATUS.TRUSTED) return { allowed: false, status: 403, body: '设备未获授权。' }
    return { allowed: true, device: refreshed }
  }

  /** `/__remote/*` is the relay's own surface, never forwarded. */
  function control(request, response, url) {
    if (url.pathname === `${CONTROL_PREFIX}/pair`) {
      const code = url.searchParams.get('token') ?? ''
      const name = url.searchParams.get('name') ?? ''
      const outcome = store.redeem(code, name)
      if (!outcome.ok) {
        log(`配对失败：${outcome.reason}`)
        send(response, 403, '这条配对链接无效或已被使用。请回到电脑上重新生成。')
        return true
      }
      log(`新设备请求接入（${outcome.deviceId}），等待本机确认…`)
      const cookie = `${DEVICE_COOKIE}=${outcome.deviceId}.${outcome.secret}; Path=/; Max-Age=${String(COOKIE_MAX_AGE_SECONDS)}; HttpOnly; SameSite=Lax`
      // Send the phone to a waiting page rather than straight at the host. The
      // device is still pending, so a direct redirect would leave the browser
      // holding a request open until the operator decides, and timing out if they
      // take a moment. The page polls instead, so taking a minute costs nothing.
      const token = upstreamToken?.() ?? ''
      const next = token === '' ? '/' : `/?token=${encodeURIComponent(token)}`
      response.writeHead(302, {
        location: `${CONTROL_PREFIX}/waiting?next=${encodeURIComponent(next)}`,
        'set-cookie': cookie,
        'cache-control': 'no-store',
      })
      response.end()
      return true
    }
    if (url.pathname === `${CONTROL_PREFIX}/waiting`) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(WAITING_PAGE)
      return true
    }
    if (url.pathname === `${CONTROL_PREFIX}/status`) {
      // Only the holder of the credential may ask about it, and it may only ask
      // about itself — the device list stays on this machine.
      const cookie = readDeviceCookie(request.headers.cookie)
      if (cookie === undefined || !store.authenticate(cookie.deviceId, cookie.secret)) {
        send(response, 401, { status: 'unknown' })
        return true
      }
      const device = store.device(cookie.deviceId)
      send(response, 200, { status: device?.status ?? 'unknown', name: device?.name ?? '' })
      return true
    }
    if (url.pathname === `${CONTROL_PREFIX}/devices`) {
      // The device list is the operator's view of this machine, not something a
      // remote client has any use for. Without this check any caller that can
      // reach the relay port — including an unpaired one — could enumerate the
      // paired devices by name and id.
      if (!isLoopbackAddress(request.socket?.remoteAddress)) {
        log(`拒绝了一次来自 ${String(request.socket?.remoteAddress)} 的设备列表读取`)
        send(response, 403, '设备列表只能在本机查看。')
        return true
      }
      send(response, 200, {
        devices: store.devices().map(({ deviceId, name, status, surfaces, lastSeenAt }) => ({
          deviceId,
          name,
          status,
          agent: surfaces.agent,
          lastSeenAt,
        })),
        live: connections.devices(),
      })
      return true
    }
    send(response, 404, 'not found')
    return true
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://relay.invalid')
    if (url.pathname.startsWith(CONTROL_PREFIX)) {
      control(request, response, url)
      return
    }
    gate(request, response)
      .then((verdict) => {
        if (!verdict.allowed) {
          send(response, verdict.status, verdict.body)
          return
        }
        const headers = { ...request.headers }
        // The Host the upstream sees must be the loopback authority the fence
        // expects; the phone's own address is not one the Host trusts.
        headers.host = `127.0.0.1:${String(hostPort)}`
        delete headers.connection
        const upstream = http.request({ host: '127.0.0.1', port: hostPort, method: request.method, path: request.url, headers }, (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
          upstreamResponse.pipe(response)
        })
        const handle = connections.open(verdict.device.deviceId, {
          close: () => {
            upstream.destroy()
            // A response that already finished must not be destroyed, or a
            // reply the relay just wrote would be truncated on the way out.
            if (!response.writableEnded) response.destroy()
          },
        })
        const finish = () => handle.close()
        upstream.on('error', () => {
          // Answer before tearing down: the teardown destroys the response, so
          // sending afterwards would have nowhere to go and the caller would see
          // a dropped connection instead of the 502 that explains it.
          if (!response.headersSent) send(response, 502, '宿主未响应')
          else response.destroy()
          finish()
        })
        response.on('close', finish)
        request.pipe(upstream)
      })
      .catch((error) => {
        log(`中继错误：${error.message}`)
        if (!response.headersSent) send(response, 500, 'relay error')
        else response.destroy()
      })
  })

  // WebSocket and other upgrades are where a phone actually holds a long-lived
  // connection, so they must be gated and tracked too — a revoked device whose
  // socket survives keeps receiving streamed output.
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://relay.invalid')
    if (url.pathname.startsWith(CONTROL_PREFIX)) {
      socket.destroy()
      return
    }
    gate(request, { writeHead: () => {}, end: () => {} })
      .then((verdict) => {
        if (!verdict.allowed) {
          socket.destroy()
          return
        }
        const upstream = http.request({
          host: '127.0.0.1',
          port: hostPort,
          method: request.method,
          path: request.url,
          headers: { ...request.headers, host: `127.0.0.1:${String(hostPort)}` },
        })
        upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
          const lines = [`HTTP/1.1 ${String(upstreamResponse.statusCode)} ${upstreamResponse.statusMessage ?? 'Switching Protocols'}`]
          for (const [key, value] of Object.entries(upstreamResponse.headers)) {
            if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`)
            else if (value !== undefined) lines.push(`${key}: ${value}`)
          }
          socket.write(`${lines.join('\r\n')}\r\n\r\n`)
          if (upstreamHead.length > 0) socket.write(upstreamHead)
          if (head.length > 0) upstreamSocket.write(head)
          socket.pipe(upstreamSocket)
          upstreamSocket.pipe(socket)
        })
        const handle = connections.open(verdict.device.deviceId, {
          close: () => {
            upstream.destroy()
            socket.destroy()
          },
        })
        upstream.on('error', () => handle.close())
        socket.on('close', () => handle.close())
        upstream.end()
      })
      .catch(() => socket.destroy())
  })

  return {
    server,
    store,
    connections,
    /** Revoke a device and tear down everything it currently holds. */
    revoke(deviceId) {
      const closed = connections.closeAll(deviceId)
      const outcome = store.revoke(deviceId)
      log(outcome.ok ? `已撤销设备 ${deviceId}，断开 ${String(closed)} 条连接` : `撤销失败：${outcome.reason}`)
      return { ...outcome, closed }
    },
    listen(port, host, callback) {
      return server.listen(port, host, callback)
    },
    close() {
      connections.closeAllDevices()
      return new Promise((resolve) => server.close(resolve))
    },
  }
}
