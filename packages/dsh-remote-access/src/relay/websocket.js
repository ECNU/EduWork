/**
 * A minimal RFC 6455 server, because Node ships a WebSocket *client* and no
 * server, and `README.md:403` forbids adding a runtime dependency.
 *
 * Scope is deliberately narrow: no extensions, no permessage-deflate, no
 * fragmentation on the write side, no subprotocol negotiation. The relay is the
 * only user and it speaks to exactly two kinds of peer, both of which are
 * ordinary browsers or Node's own client.
 *
 * Everything here is about the wire format. Authentication, pairing and routing
 * live in `relay.js`.
 */

import { createHash, randomBytes } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const OPCODE = Object.freeze({ CONTINUATION: 0x0, TEXT: 0x1, BINARY: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa })

/** Default cap on one assembled message. The control channel never approaches it. */
const DEFAULT_MAX_MESSAGE = 8 * 1024 * 1024

function acceptKey(clientKey) {
  return createHash('sha1').update(clientKey + GUID).digest('base64')
}

/**
 * Complete the opening handshake for one upgrade request.
 * @param request - the node:http upgrade request.
 * @param socket - the raw socket the upgrade arrived on.
 * @param options - optional message cap and ping interval.
 * @returns a connection object with `send`, `close`, and event hooks.
 */
export function acceptUpgrade(request, socket, options = {}) {
  const key = request.headers['sec-websocket-key']
  if (typeof key !== 'string' || key === '') throw new Error('websocket: missing Sec-WebSocket-Key')
  if ((request.headers.upgrade ?? '').toLowerCase() !== 'websocket') {
    throw new Error('websocket: not an upgrade request')
  }
  const version = request.headers['sec-websocket-version']
  if (version !== '13') throw new Error(`websocket: unsupported version ${String(version)}`)

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n`
    + '\r\n',
  )
  socket.setNoDelay(true)
  return createConnection(socket, options)
}

/**
 * Send a WebSocket close frame and end the socket.
 * @param socket - target socket.
 * @param code - status code.
 * @param reason - short reason, truncated to the frame limit.
 */
export function writeClose(socket, code = 1000, reason = '') {
  const text = Buffer.from(reason, 'utf8').subarray(0, 123)
  const payload = Buffer.alloc(2 + text.length)
  payload.writeUInt16BE(code, 0)
  text.copy(payload, 2)
  socket.write(encodeFrame(OPCODE.CLOSE, payload))
}

/**
 * Refuse an upgrade with a plain HTTP response instead of switching protocols.
 * @param socket - the raw socket.
 * @param status - HTTP status code.
 * @param body - response body text.
 */
export function refuseUpgrade(socket, status, body) {
  const text = Buffer.from(body, 'utf8')
  socket.write(
    `HTTP/1.1 ${status} ${status === 404 ? 'Not Found' : 'Bad Request'}\r\n`
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${text.length}\r\n`
    + 'Connection: close\r\n'
    + '\r\n',
  )
  socket.end(text)
}

function encodeFrame(opcode, payload) {
  const length = payload.length
  let header
  if (length < 126) {
    header = Buffer.alloc(2)
    header[1] = length
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  header[0] = 0x80 | opcode
  return Buffer.concat([header, payload])
}

/**
 * Where a listener failure goes when the caller has not said otherwise.
 *
 * Written to stderr rather than discarded. A relay that hides its own bugs looks
 * identical to one that is merely idle, and the difference matters when a link
 * stops forwarding for no visible reason.
 */
function defaultListenerError(error, event) {
  process.stderr.write(`relay websocket: ${event} listener failed: ${error?.stack ?? error}\n`)
}

function createConnection(socket, { maxMessageBytes = DEFAULT_MAX_MESSAGE, pingIntervalMs = 30_000, onListenerError = defaultListenerError } = {}) {
  const handlers = { message: new Set(), close: new Set(), error: new Set() }
  let buffer = Buffer.alloc(0)
  let fragments = []
  let fragmentOpcode = 0
  let closed = false
  let pingTimer = null

  const emit = (event, ...payload) => {
    for (const handler of [...handlers[event]]) {
      try {
        handler(...payload)
      } catch (error) {
        // One bad listener must not take the socket down with it, but the
        // failure cannot be silent either: a `TypeError` in a handler is
        // indistinguishable from a frame that never arrived, which is exactly
        // how a stale method call in the relay cost a debugging round.
        onListenerError(error, event)
      }
    }
  }

  const connection = {
    socket,
    /** True once a close frame has been sent or received. */
    get closed() {
      return closed
    },
    /**
     * Subscribe to `message`, `close` or `error`.
     *
     * Listeners accumulate rather than replace. Replacing was the first version,
     * and it is a trap rather than a simplification: a second subscriber
     * silently disables the first, which presents as a dropped frame instead of
     * as a registration bug.
     */
    on(event, handler) {
      handlers[event].add(handler)
      return connection
    },
    /** Remove a listener added with {@link on}. */
    off(event, handler) {
      handlers[event].delete(handler)
      return connection
    },
    /**
     * Hand one message to another connection without inspecting it.
     *
     * This is the only thing the relay does once two peers are linked, and it is
     * written once here rather than as a patch over the connection object.
     */
    forward(data) {
      return connection.send(data)
    },
    /** Send one text or binary message. */
    send(data) {
      if (closed) return false
      const isText = typeof data === 'string'
      const payload = isText ? Buffer.from(data, 'utf8') : Buffer.from(data)
      socket.write(encodeFrame(isText ? OPCODE.TEXT : OPCODE.BINARY, payload))
      return true
    },
    /** Send a close frame and end the socket. Idempotent. */
    close(code = 1000, reason = '') {
      if (closed) return
      closed = true
      if (pingTimer !== null) clearInterval(pingTimer)
      writeClose(socket, code, reason)
      socket.end()
    },
  }

  function shutdown(code, reason) {
    if (closed) return
    closed = true
    if (pingTimer !== null) clearInterval(pingTimer)
    emit('close', { code, reason })
  }

  function deliver(opcode, payload) {
    if (opcode === OPCODE.TEXT) emit('message', payload.toString('utf8'), true)
    else emit('message', payload, false)
  }

  function handleFrame(fin, opcode, payload) {
    if (opcode === OPCODE.CLOSE) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005
      const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : ''
      writeClose(socket, 1000)
      socket.end()
      shutdown(code, reason)
      return
    }
    if (opcode === OPCODE.PING) {
      if (!closed) socket.write(encodeFrame(OPCODE.PONG, payload))
      return
    }
    if (opcode === OPCODE.PONG) return

    if (opcode === OPCODE.CONTINUATION) {
      if (fragmentOpcode === 0) {
        connection.close(1002, 'continuation without a start frame')
        return
      }
      fragments.push(payload)
    } else {
      if (fragmentOpcode !== 0) {
        connection.close(1002, 'nested fragment start')
        return
      }
      fragmentOpcode = opcode
      fragments = [payload]
    }

    const total = fragments.reduce((sum, part) => sum + part.length, 0)
    if (total > maxMessageBytes) {
      connection.close(1009, 'message too large')
      return
    }
    if (!fin) return

    const opcodeForMessage = fragmentOpcode
    const message = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments)
    fragmentOpcode = 0
    fragments = []
    deliver(opcodeForMessage, message)
  }

  function consume() {
    while (true) {
      if (buffer.length < 2) return
      const first = buffer[0]
      const second = buffer[1]
      const fin = (first & 0x80) !== 0
      const opcode = first & 0x0f
      const masked = (second & 0x80) !== 0
      let length = second & 0x7f
      let offset = 2

      if (length === 126) {
        if (buffer.length < offset + 2) return
        length = buffer.readUInt16BE(offset)
        offset += 2
      } else if (length === 127) {
        if (buffer.length < offset + 8) return
        const wide = buffer.readBigUInt64BE(offset)
        if (wide > BigInt(Number.MAX_SAFE_INTEGER)) {
          connection.close(1009, 'frame too large')
          return
        }
        length = Number(wide)
        offset += 8
      }

      if (length > maxMessageBytes) {
        connection.close(1009, 'frame too large')
        return
      }

      // RFC 6455 §5.1: a server MUST close on an unmasked client frame.
      if (!masked) {
        connection.close(1002, 'client frames must be masked')
        return
      }
      if (buffer.length < offset + 4 + length) return

      const mask = buffer.subarray(offset, offset + 4)
      offset += 4
      const payload = Buffer.allocUnsafe(length)
      for (let i = 0; i < length; i += 1) payload[i] = buffer[offset + i] ^ mask[i & 3]
      offset += length
      buffer = buffer.subarray(offset)

      try {
        handleFrame(fin, opcode, payload)
      } catch (error) {
        emit('error', error)
        connection.close(1011, 'internal error')
        return
      }
      if (closed) return
    }
  }

  socket.on('data', (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
    consume()
  })
  socket.on('error', (error) => {
    // `emit` drops the error when nothing subscribed. Calling the handler
    // directly here made an unhandled `error` listener throw, which turned one
    // peer's abrupt disconnect into an uncaught exception for the whole relay.
    emit('error', error)
    shutdown(1006, 'socket error')
  })
  socket.on('close', () => shutdown(1006, 'socket closed'))
  socket.on('end', () => shutdown(1006, 'socket ended'))

  if (pingIntervalMs > 0) {
    pingTimer = setInterval(() => {
      if (closed) return
      socket.write(encodeFrame(OPCODE.PING, randomBytes(4)))
    }, pingIntervalMs)
    pingTimer.unref?.()
  }

  return connection
}

/**
 * Wrap a client-side WebSocket (Node's built-in, or a browser's) in the same
 * event shape the server connection exposes, so both ends of the relay are
 * driven by identical code.
 * @param socket - a WHATWG WebSocket.
 * @returns an object with `send`, `close`, and `on`.
 */
export function wrapClientSocket(socket) {
  const handlers = { message: new Set(), close: new Set(), error: new Set() }
  const emit = (event, ...payload) => {
    for (const handler of [...handlers[event]]) {
      try {
        handler(...payload)
      } catch {
        /* keep the other listeners alive */
      }
    }
  }
  socket.binaryType = 'arraybuffer'
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') emit('message', event.data, true)
    else emit('message', new Uint8Array(event.data), false)
  })
  socket.addEventListener('close', (event) => emit('close', { code: event.code, reason: event.reason }))
  socket.addEventListener('error', () => emit('error', new Error('websocket: transport error')))
  return {
    socket,
    get closed() {
      return socket.readyState === 2 || socket.readyState === 3
    },
    on(event, handler) {
      handlers[event].add(handler)
      return this
    },
    off(event, handler) {
      handlers[event].delete(handler)
      return this
    },
    forward(data) {
      return this.send(data)
    },
    send(data) {
      if (socket.readyState !== 1) return false
      socket.send(data)
      return true
    },
    close(code = 1000, reason = '') {
      try {
        socket.close(code, reason)
      } catch {
        /* already closing */
      }
    },
  }
}

export { OPCODE }
