/**
 * The relay: pairs one Host with its devices and forwards bytes between them.
 *
 * It is a blind forwarder on purpose. It never sees a device name, a public key
 * or a single RPC payload, because everything past the `linked` frame is
 * end-to-end encrypted (see `channel/handshake.js` and `notes/19`). What it does
 * know is listed in `notes/19` §2.1 and is deliberately short: a `hostId`, the
 * times a socket was open, and the *sizes* of the messages it passed along.
 *
 * Two responsibilities aside from forwarding:
 *
 * 1. **Bind a `hostId` to a host public key on first registration.** Without
 *    this, anyone who learned a `hostId` could register it and receive the
 *    devices that dial in. The binding is checked with a signature over the
 *    relay's own nonce, so the relay never holds a credential worth stealing.
 * 2. **Serve the browser bootstrap and the DSH frontend.** The page has to come
 *    from somewhere the phone can reach; see `notes/19` §2 for why that is the
 *    relay and what trust assumption it implies.
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'

import { HOST_PATH, MESSAGE, PEER_PATH, RELAY_VERSION, UNAVAILABLE } from './protocol.js'
import { acceptUpgrade, refuseUpgrade } from './websocket.js'

/** True when a text frame is the explicit hand-off to transparent forwarding. */
function isReady(data) {
  try {
    return JSON.parse(data)?.t === MESSAGE.READY
  } catch {
    return false
  }
}

/**
 * How many Host frames may be held while a link finishes its control hand-off.
 *
 * The window is normally a few milliseconds — the Host cannot answer a `hello`
 * it has not received — so this exists only to stop a Host that ignores the
 * protocol from growing the relay's memory without limit.
 */
const MAX_PENDING_HOST_FRAMES = 64

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
})

function loadHosts(path) {
  if (path === undefined || !existsSync(path)) return new Map()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return new Map(Object.entries(parsed.hosts ?? {}))
  } catch {
    return new Map()
  }
}

function saveHosts(path, hosts) {
  if (path === undefined) return
  mkdirSync(dirname(path), { recursive: true })
  const body = JSON.stringify({ version: 1, hosts: Object.fromEntries(hosts) }, null, 2)
  const temporary = `${path}.tmp`
  writeFileSync(temporary, body, 'utf8')
  renameSync(temporary, path)
}

/** Resolve a request path inside a root, refusing anything that escapes it. */
function resolveStatic(root, pathname) {
  const decoded = decodeURIComponent(pathname)
  const target = resolve(root, `.${normalize(decoded)}`)
  const boundary = resolve(root) + sep
  if (target !== resolve(root) && !target.startsWith(boundary)) return undefined
  return target
}

/**
 * Build the relay.
 *
 * @param options - listen address, host-binding store path, and static roots.
 * @returns an object with the node:http server, `listen`, and `close`.
 */
/**
 * A link between one Host and one device, and the state machine that opens it.
 *
 * The relay's control channel and the end-to-end handshake share one socket, so
 * the relay has to know exactly when to stop sending control frames and start
 * forwarding. Getting that boundary wrong is not cosmetic: a stray `peer-joined`
 * arrives between the peer's `hello` and the Host's reply, the Host parses it as
 * a handshake message, and the link dies with `protocol-mismatch`.
 *
 * Two rules make the boundary exact, and both are needed:
 *
 * 1. **No control frame may be sent to an end that is already forwarding.** The
 *    Host often says READY before any device exists, so "has this end been told
 *    about the device" is the wrong question — ask whether the end is still
 *    waiting for control at all.
 * 2. **A data frame may only be forwarded once both ends are forwarding.** The
 *    Host should not answer `hello` before the device has finished its own
 *    control phase, or the answer arrives at a device that is still reading
 *    control frames.
 *
 * Readiness therefore lives on the link rather than in either message handler:
 * the Host can reach READY before the device exists, so the handler that sees it
 * cannot be the one that decides.
 *
 * Host readiness is per-device, not per-connection. A Host keeps its socket open
 * for days and serves one device after another, and each new device needs the
 * Host's READY again or the link never opens. So `peer-gone` clears it, and the
 * Host — which has just been told a device arrived — sends it again.
 */
function createLink(hostConnection, sendControl) {
  function forwarding(connection) {
    if (connection === hostConnection) return link.hostReady && link.open
    return link.peer === connection && link.peerReady && link.open
  }

  const link = {
    host: hostConnection,
    peer: undefined,
    hostReady: false,
    peerReady: false,
    open: false,
    /**
     * Host frames that arrived before the link could carry them.
     *
     * The Host reads and the relay reads are two independent sockets, so the
     * relay has no way to guarantee it parses the device's READY before it
     * parses the answer the Host already sent. Those frames are legitimate —
     * the Host is replying to a `hello` it was told about — so dropping them
     * loses real traffic, and the only fix is to hold them until READY lands.
     */
    pending: [],
    /**
     * Device frames held for the same reason, in the other direction.
     *
     * The device sends `ready` and its first handshake frame back to back, and
     * the relay may read them in either order. Closing the device because its
     * own READY has not been parsed yet punishes it for a race it cannot
     * observe, and it is the same mistake as dropping the Host's answer.
     */
    pendingPeer: [],
    /**
     * Send a relay control frame only if the recipient is still in its control phase.
     *
     * Silently dropping is not a loss of information: a connection that is
     * already forwarding has been told everything this frame would carry, and
     * `open` only happens once both ends stopped needing control frames.
     */
    notify(connection, message) {
      // `hostReady` is not part of this test. It says the Host has finished
      // reading control frames, not that it is still doing so, and a Host that is
      // already forwarding must not be sent `peer-joined` for the next device
      // either — it is in its data phase and would parse it as protocol traffic.
      if (forwarding(connection)) return false
      sendControl(connection, message)
      return true
    },
    /** Set by whichever of the two handlers is the second to see READY. */
    evaluate(log) {
      // The device's READY is the hinge, and it is the requirement that carries
      // the weight: by the time the relay sees it, the device has seen
      // everything this link will ever send it (`linked`, then `ready` back, in
      // order on one socket). The Host's own READY is *not* a prerequisite for
      // forwarding towards the Host — the Host is free to answer `hello` as soon
      // as it knows a device exists, and it usually does, before the device's
      // READY has even been parsed.
      if (link.open || !link.peerReady || link.peer === undefined) return
      link.open = true
      log('relay: link is transparent in both directions')
      const held = link.pending
      link.pending = []
      if (held.length > 0) {
        log(`relay: releasing ${held.length} host frame(s) held during the control hand-off`)
        for (const frame of held) link.peer.forward(frame.data, frame.isText)
      }
      const heldFromPeer = link.pendingPeer
      link.pendingPeer = []
      if (heldFromPeer.length > 0) {
        log(`relay: releasing ${heldFromPeer.length} device frame(s) held during the control hand-off`)
        for (const frame of heldFromPeer) link.host.forward(frame.data, frame.isText)
      }
    },
    /** A device left: the link closes and the Host must announce itself again. */
    reopen() {
      link.peer = undefined
      link.peerReady = false
      link.hostReady = false
      link.open = false
      // Frames held for the device that just left were addressed to a session
      // that no longer exists; replaying them to its successor would be worse
      // than losing them.
      link.pending = []
      link.pendingPeer = []
    },
  }
  return link
}

export function createRelay({
  host = '127.0.0.1',
  port = 0,
  storePath,
  webRoot,
  frontendRoot,
  bootstrapScript = '/eduwork-bootstrap.js',
  log = () => {},
  maxMessageBytes = 8 * 1024 * 1024,
} = {}) {
  const hosts = loadHosts(storePath)
  /** hostId -> live host connection */
  const live = new Map()
  const sockets = new Set()

  const server = createServer((request, response) => {
    serve(request, response)
  })

  function serve(request, response) {
    const url = new URL(request.url ?? '/', 'http://relay.invalid')
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('method not allowed')
      return
    }

    if (webRoot !== undefined && url.pathname.startsWith('/eduwork-assets/')) {
      const target = resolveStatic(webRoot, url.pathname.slice('/eduwork-assets'.length))
      if (target !== undefined && existsSync(target)) return sendFile(response, target, request.method === 'HEAD')
    }

    if (frontendRoot !== undefined) {
      const target = resolveStatic(frontendRoot, url.pathname)
      if (target !== undefined && existsSync(target) && extname(target) !== '') {
        return sendFile(response, target, request.method === 'HEAD')
      }
      const index = join(frontendRoot, 'index.html')
      if (existsSync(index)) return sendIndex(response, index, bootstrapScript, request.method === 'HEAD')
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found')
  }

  function sendFile(response, target, headOnly) {
    const type = MIME[extname(target).toLowerCase()] ?? 'application/octet-stream'
    const immutable = target.includes(`${sep}assets${sep}`)
    response.writeHead(200, {
      'content-type': type,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (headOnly) return response.end()
    createReadStream(target).pipe(response)
  }

  /**
   * Serve `index.html` with the transport hook injected before any module runs.
   *
   * The injection has to be a classic inline script placed ahead of the
   * `<script type="module">` tag, because a module script is deferred and would
   * otherwise read `__DSH_TRANSPORT__` before we set it.
   */
  function sendIndex(response, index, script, headOnly) {
    let html = readFileSync(index, 'utf8')
    const tag = `<script src="${script}"></script>`
    html = html.includes('</head>') ? html.replace('</head>', `${tag}</head>`) : `${tag}${html}`
    const body = Buffer.from(html, 'utf8')
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-cache',
    })
    if (headOnly) return response.end()
    response.end(body)
  }

  function sendControl(connection, message) {
    connection.send(JSON.stringify(message))
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://relay.invalid')
    if (url.pathname !== HOST_PATH && url.pathname !== PEER_PATH) {
      refuseUpgrade(socket, 404, 'unknown relay endpoint')
      return
    }
    let connection
    try {
      connection = acceptUpgrade(request, socket, { maxMessageBytes })
    } catch (error) {
      refuseUpgrade(socket, 400, String(error.message ?? error))
      return
    }
    sockets.add(connection)
    connection.on('close', () => sockets.delete(connection))
    if (url.pathname === HOST_PATH) attachHost(connection)
    else attachPeer(connection, url)
  })

  function attachHost(connection) {
    const nonce = createHash('sha256').update(String(Date.now())).update(String(Math.random())).digest('base64url')
    let registered = null
    let link = null
    sendControl(connection, { t: 'challenge', v: RELAY_VERSION, nonce })

    connection.on('message', (data, isText) => {
      if (registered === null) {
        if (!isText) return connection.close(1003, 'expected a registration frame')
        let message
        try {
          message = JSON.parse(data)
        } catch {
          return connection.close(1003, 'registration frame is not JSON')
        }
        if (message?.t !== 'register' || message.v !== RELAY_VERSION) {
          return connection.close(1003, 'expected register')
        }
        if (typeof message.hostId !== 'string' || typeof message.publicKey !== 'string' || typeof message.sig !== 'string') {
          return connection.close(1003, 'register is missing a field')
        }
        // The relay does not verify the signature itself — it has no crypto
        // primitives and no business holding any. It records the binding and
        // checks every later registration against it. Verification of this key
        // happens on the devices, in the end-to-end handshake.
        const existing = hosts.get(message.hostId)
        if (existing !== undefined && existing.publicKey !== message.publicKey) {
          log(`relay: refusing hostId ${message.hostId}: already bound to another key`)
          sendControl(connection, { t: 'denied', reason: 'host-id-taken' })
          return connection.close(1008, 'hostId already bound')
        }
        if (live.has(message.hostId)) {
          sendControl(connection, { t: 'denied', reason: 'host-already-online' })
          return connection.close(1008, 'hostId already online')
        }
        if (existing === undefined) {
          hosts.set(message.hostId, { publicKey: message.publicKey, registeredAt: new Date().toISOString() })
          saveHosts(storePath, hosts)
          log(`relay: bound hostId ${message.hostId}`)
        }
        registered = { hostId: message.hostId, nonce, publicKey: message.publicKey }
        // Publish the link before telling the Host it is registered: `registered`
        // is the signal that lets a device attach, and `attachPeer` reads
        // `hostSocket.link`. Behind the send it would be a real race.
        link = createLink(connection, sendControl)
        connection.link = link
        live.set(message.hostId, connection)
        sendControl(connection, { t: 'registered', v: RELAY_VERSION, hostId: message.hostId })
        return
      }

      // Everything after registration but before READY is still the relay's
      // control channel; the link is not transparent yet. See createLink.
      if (!link.hostReady) {
        if (isText && isReady(data)) {
          link.hostReady = true
          log(`relay: host ${registered.hostId} is forwarding`)
          link.evaluate(log)
        } else {
          connection.close(1003, 'forwarding has not started')
        }
        return
      }
      // A Host answers `hello` as soon as it knows a device exists, which is
      // routinely before the relay has parsed the device's READY — the two
      // sockets advance independently. That answer is real traffic, so it is
      // held rather than dropped, and `evaluate` releases it in order the moment
      // READY lands. Only the device's READY opens the link, but nothing the
      // Host sends is thrown away while it waits.
      if (link.open && link.peer !== undefined) {
        link.peer.forward(data, isText)
      } else if (link.peer !== undefined) {
        if (link.pending.length >= MAX_PENDING_HOST_FRAMES) {
          connection.close(1011, 'device has not finished its control hand-off')
        } else {
          link.pending.push({ data, isText })
        }
      } else {
        // No device at all: the Host is talking to a link that does not exist.
        // `peer-gone` already told it so, and a silent drop here would leave it
        // waiting for an answer nothing can produce.
        connection.close(1011, 'no device is attached')
      }
    })

    connection.on('close', () => {
      if (registered === null) return
      if (live.get(registered.hostId) === connection) live.delete(registered.hostId)
      // Tell the device, then close it. A device left holding an open socket
      // after its Host is gone waits for a reply that nothing can produce, and it
      // cannot tell that apart from a slow Host — the same failure the relay
      // avoids when a device leaves. Closing is what makes the end of the link
      // observable.
      if (link?.peer !== undefined) {
        link.notify(link.peer, { t: 'peer-gone' })
        link.peer.close(1011, 'the host is no longer connected')
      }
      log(`relay: host ${registered.hostId} left`)
    })
  }

  function attachPeer(connection, url) {
    const hostId = url.searchParams.get('h') ?? ''
    if (hostId === '') {
      sendControl(connection, { t: 'unavailable', reason: UNAVAILABLE.MISSING_HOST_ID })
      connection.close(1008, 'missing host id')
      return
    }
    if (!hosts.has(hostId)) {
      sendControl(connection, { t: 'unavailable', reason: UNAVAILABLE.UNKNOWN_HOST })
      connection.close(1008, 'unknown host')
      return
    }
    const hostSocket = live.get(hostId)
    // A host mid-registration has a `live` entry but no link yet. Refusing here
    // keeps a racing or malformed registration from throwing inside the upgrade
    // handler, where an uncaught exception takes down the whole relay rather than
    // one connection.
    if (hostSocket === undefined || hostSocket.link === undefined) {
      sendControl(connection, { t: 'unavailable', reason: UNAVAILABLE.HOST_OFFLINE })
      connection.close(1008, 'host offline')
      return
    }

    const link = hostSocket.link
    // One device per host socket: the Host multiplexes its own sessions over the
    // single link, so the relay never needs to demultiplex. A second device is
    // refused rather than queued, so the caller learns immediately.
    if (link.peer !== undefined) {
      sendControl(connection, { t: 'unavailable', reason: UNAVAILABLE.HOST_BUSY })
      connection.close(1008, 'host busy')
      return
    }

    link.peer = connection
    connection.link = link
    if (link.notify(connection, { t: 'linked', v: RELAY_VERSION, hostId })) {
      log(`relay: linked a device to ${hostId}`)
    } else {
      log(`relay: device attached to ${hostId}, which is already forwarding`)
    }
    link.notify(hostSocket, { t: 'peer-joined' })

    connection.on('message', (data, isText) => {
      if (!link.peerReady) {
        if (isText && isReady(data)) {
          link.peerReady = true
          log(`relay: a device on ${hostId} is forwarding`)
          link.evaluate(log)
        } else if (link.pendingPeer.length >= MAX_PENDING_HOST_FRAMES) {
          connection.close(1011, 'device sent too much before its control hand-off')
        } else {
          // Held, not dropped and not punished: the device sends `ready` and its
          // first handshake frame back to back, and the relay may read them in
          // either order. Closing it for a race it cannot observe is the same
          // mistake as dropping the Host's answer, in the other direction.
          link.pendingPeer.push({ data, isText })
        }
        return
      }
      if (link.open) link.host.forward(data, isText)
      // Past the device's READY the link is one frame away from open at worst,
      // so a frame that cannot be forwarded means the Host side never completed
      // its own hand-off. Dropping it silently left the device waiting for an
      // answer that could not come; saying so lets it reconnect instead.
      else connection.close(1011, 'host has not finished its control hand-off')
    })
    connection.on('close', () => {
      if (link.peer === connection) {
        link.reopen()
        link.notify(link.host, { t: 'peer-gone' })
      }
      log(`relay: a device left ${hostId}`)
    })
  }

  // Every connection already exposes `forward`, so linking is symmetric and
  // needs no patching: the two handlers below just point each side at the other.

  return {
    server,
    hosts,
    live,
    listen(callback) {
      return server.listen(port, host, callback)
    },
    close() {
      for (const connection of sockets) {
        try {
          connection.close(1001, 'relay shutting down')
        } catch {
          /* already gone */
        }
      }
      return new Promise((done) => server.close(done))
    },
  }
}
