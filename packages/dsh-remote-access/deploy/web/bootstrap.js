// The browser half of the end-to-end channel.
//
// The relay forwards these bytes and cannot read them. This file is where that
// claim is either true or not: it holds the device's private key, terminates the
// handshake, and seals every call before the application sees anything. If it is
// served by the relay — and it is — then the relay could replace it, and the
// end-to-end property holds only against parties other than the relay operator.
// That is a known and accepted limit, stated here so nobody reads more into it
// than it says.
//
// It runs as a classic script *before* any module, because the application reads
// `window.__DSH_TRANSPORT__` at import time and a deferred module script would
// read it too late. So it cannot use `import`, and it repeats the parts of the
// channel it needs instead of reaching into the plugin's source.
//
// Every constant here is copied from `src/channel/crypto.js` and
// `src/channel/handshake.js`. They are not interchangeable with anything similar:
// the transcript is a fixed concatenation, the key derivation is a fixed chain,
// and a single byte out of place shows up as a signature failure with no hint
// about which side is wrong. Keep this file and those two in step; the package's
// own tests cover the Host side, and a drift between them fails at the handshake.

(function bootstrapRemoteAccess() {
  'use strict'

  var PROTOCOL = 'eduwork-remote/2'
  var HEADER_BYTES = 11
  var TAG_BYTES = 16
  var VERSION = 0x02
  var DIRECTION = { PEER_TO_HOST: 0x01, HOST_TO_PEER: 0x02 }
  var KIND = { HANDSHAKE: 0x00, CALL: 0x01 }
  var TRANSCRIPT = {
    HELLO: 'eduwork-host-v2',
    PROVE: 'eduwork-peer-v2',
    READY: 'eduwork-ready-v2',
  }

  // ---------------------------------------------------------------- primitives

  function utf8(text) {
    return new TextEncoder().encode(text)
  }

  function concatBytes(list) {
    var total = 0
    for (var index = 0; index < list.length; index += 1) total += list[index].length
    var out = new Uint8Array(total)
    var offset = 0
    for (var i = 0; i < list.length; i += 1) {
      out.set(list[i], offset)
      offset += list[i].length
    }
    return out
  }

  function toBase64url(bytes) {
    var binary = ''
    for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
    return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
  }

  function fromBase64url(text) {
    var padded = String(text).replace(/-/gu, '+').replace(/_/gu, '/')
    while (padded.length % 4 !== 0) padded += '='
    var binary = atob(padded)
    var out = new Uint8Array(binary.length)
    for (var index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index)
    return out
  }

  function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length))
  }

  function randomToken(bytes) {
    return toBase64url(randomBytes(bytes))
  }

  // ---------------------------------------------------------------- keys

  /** A static key travels as `p256:<base64url of the 65-byte point>`. */
  async function encodeStatic(publicKey) {
    return 'p256:' + toBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)))
  }

  /** An ephemeral key travels as the bare base64url point, with no prefix. */
  async function encodeEphemeral(publicKey) {
    return toBase64url(new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)))
  }

  function staticBytes(text) {
    if (typeof text !== 'string' || text.slice(0, 5) !== 'p256:') {
      throw new Error('the host key is not in the "p256:" form')
    }
    var bytes = fromBase64url(text.slice(5))
    if (bytes.length !== 65 || bytes[0] !== 0x04) {
      throw new Error('the host key is not a 65-byte uncompressed P-256 point')
    }
    return bytes
  }

  function ephemeralBytes(text) {
    // The prefix belongs to static keys only. Stripping it here would accept a
    // string that is not what this field is, so it is refused instead — and the
    // error names the form rather than coming out of `atob` as "Invalid character".
    if (typeof text !== 'string' || text.slice(0, 5) === 'p256:') {
      throw new Error('the host ephemeral key must be a bare base64url point, not a "p256:" key')
    }
    var bytes = fromBase64url(text)
    if (bytes.length !== 65 || bytes[0] !== 0x04) {
      throw new Error('the host ephemeral key is not a 65-byte uncompressed P-256 point')
    }
    return bytes
  }

  function importVerifyKey(bytes) {
    return crypto.subtle.importKey('raw', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
  }

  // An ECDH public key takes no usages: `deriveBits` belongs to the private half,
  // and asking for it here throws rather than being ignored.
  function importAgreementPublic(bytes) {
    return crypto.subtle.importKey('raw', bytes, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
  }

  function deriveSecret(privateKey, publicKey) {
    return crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
      .then(function (bits) { return new Uint8Array(bits) })
  }

  function sign(privateKey, transcript) {
    return crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, transcript)
      .then(function (signature) { return toBase64url(new Uint8Array(signature)) })
  }

  function hmac(keyBytes, message) {
    return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      .then(function (key) { return crypto.subtle.sign('HMAC', key, message) })
      .then(function (tag) { return new Uint8Array(tag) })
  }

  // ---------------------------------------------------------------- device identity

  /**
   * The device's long-term key, kept in IndexedDB.
   *
   * Both private halves are generated non-extractable, so no code path — including
   * a later version of this file — can export them. That is a real constraint and
   * not a decoration: it means a device that loses them has to pair again, and it
   * means a script injected into the page cannot read the key out, only use it.
   */
  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open('eduwork-remote', 1)
      request.onupgradeneeded = function () {
        var database = request.result
        if (!database.objectStoreNames.contains('keys')) database.createObjectStore('keys')
      }
      request.onsuccess = function () { resolve(request.result) }
      request.onerror = function () { reject(request.error) }
    })
  }

  function readRecord(key) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var request = database.transaction('keys', 'readonly').objectStore('keys').get(key)
        request.onsuccess = function () { resolve(request.result) }
        request.onerror = function () { reject(request.error) }
      })
    })
  }

  function writeRecord(key, value) {
    return openDatabase().then(function (database) {
      return new Promise(function (resolve, reject) {
        var transaction = database.transaction('keys', 'readwrite')
        transaction.objectStore('keys').put(value, key)
        transaction.oncomplete = function () { resolve() }
        transaction.onerror = function () { reject(transaction.error) }
      })
    })
  }

  async function loadIdentity() {
    var stored = await readRecord('identity')
    if (stored !== undefined && stored !== null && stored.signingPrivate !== undefined) {
      return stored
    }

    var signingPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'],
    )
    var agreementPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'],
    )
    var identity = {
      deviceId: randomToken(32),
      signingPrivate: signingPair.privateKey,
      agreementPrivate: agreementPair.privateKey,
      signingPublic: await encodeStatic(signingPair.publicKey),
      agreementPublic: await encodeStatic(agreementPair.publicKey),
    }
    await writeRecord('identity', identity)
    return identity
  }

  // ---------------------------------------------------------------- transcript

  /**
   * The byte string both sides sign.
   *
   * Order is fixed and the two static keys are the raw 65-byte points, not the
   * `p256:` text: a transcript over the text form would change meaning the day
   * anyone changed the prefix.
   */
  function buildTranscript(fields) {
    return concatBytes([
      utf8(PROTOCOL),
      utf8(fields.hostId),
      utf8(fields.deviceId),
      staticBytes(fields.peerStaticKey),
      staticBytes(fields.hostStaticKey),
      fromBase64url(fields.peerNonce),
      fromBase64url(fields.hostNonce),
      ephemeralBytes(fields.hostEphemeral),
      ephemeralBytes(fields.peerEphemeral),
    ])
  }

  function domainSeparate(label, transcript) {
    return concatBytes([utf8(label), transcript])
  }

  async function deriveSessionKeys(input) {
    var prk = await hmac(input.ephemeralSecret, concatBytes([input.staticSecret, input.transcript]))
    return {
      peerToHost: await hmac(prk, utf8('p2h')),
      hostToPeer: await hmac(prk, utf8('h2p')),
      sas: toBase64url((await hmac(prk, utf8('sas'))).slice(0, 4)),
    }
  }

  // ---------------------------------------------------------------- framing

  function splitFrame(bytes) {
    if (bytes.length < HEADER_BYTES + TAG_BYTES) {
      throw new Error('channel: frame is shorter than its header and tag')
    }
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {
      header: bytes.slice(0, HEADER_BYTES),
      body: bytes.slice(HEADER_BYTES),
      version: bytes[0],
      direction: bytes[1],
      sequence: Number(view.getBigUint64(2, false)),
      kind: bytes[10],
    }
  }

  /** The nonce is derived, not sliced out of the header: `dir` then `seq`. */
  function nonceFor(direction, sequence) {
    var nonce = new Uint8Array(12)
    var view = new DataView(nonce.buffer)
    view.setUint32(0, direction, false)
    view.setUint32(4, Math.floor(sequence / 0x100000000), false)
    view.setUint32(8, sequence >>> 0, false)
    return nonce
  }

  function createSession(keys) {
    var sendSequence = 0
    var receiveSequence = 0
    var aesSend
    var aesReceive

    // WebCrypto checks that a BufferSource is one *it* recognises, and a typed
    // array from another realm is not. That is not a hypothetical: it is the
    // difference between this file working in a browser and a test harness, and it
    // would be equally true of a value that crossed a realm in production. Copying
    // costs one allocation per frame and removes the question.
    function toBytes(value) {
      if (value instanceof Uint8Array) return new Uint8Array(value)
      if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0))
      if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
      throw new TypeError('channel: payload must be a BufferSource')
    }

    return {
      async seal(payload) {
        // Reserve the sequence synchronously, before any await. Two concurrent
        // seal() calls — an RPC and a stream-mux frame — otherwise both read the
        // same counter, encrypt under the same nonce, and the Host sees a duplicate
        // sequence (`expected 1 but received 0`) and drops the link.
        var sequence = sendSequence
        sendSequence += 1
        if (aesSend === undefined) {
          aesSend = await crypto.subtle.importKey('raw', keys.peerToHost, { name: 'AES-GCM' }, false, ['encrypt'])
        }
        var bytes = toBytes(payload)
        var header = new Uint8Array(HEADER_BYTES)
        header[0] = VERSION
        header[1] = DIRECTION.PEER_TO_HOST
        new DataView(header.buffer).setBigUint64(2, BigInt(sequence), false)
        header[10] = KIND.CALL
        var sealed = new Uint8Array(await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: nonceFor(DIRECTION.PEER_TO_HOST, sequence), additionalData: header },
          aesSend,
          bytes,
        ))
        return concatBytes([header, sealed])
      },

      async open(frame) {
        if (aesReceive === undefined) {
          aesReceive = await crypto.subtle.importKey('raw', keys.hostToPeer, { name: 'AES-GCM' }, false, ['decrypt'])
        }
        var parts = splitFrame(toBytes(frame))
        if (parts.version !== VERSION) throw new Error('channel: unsupported frame version')
        if (parts.direction !== DIRECTION.HOST_TO_PEER) throw new Error('channel: frame arrived from the wrong direction')
        // Strictly increasing, so a frame the relay replays fails to open rather
        // than being delivered twice.
        if (parts.sequence !== receiveSequence) throw new Error('channel: frame sequence is out of order')
        var plain = new Uint8Array(await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: nonceFor(DIRECTION.HOST_TO_PEER, parts.sequence), additionalData: parts.header },
          aesReceive,
          parts.body,
        ))
        receiveSequence += 1
        return plain
      },
    }
  }

  // ---------------------------------------------------------------- handshake

  /**
   * Wait for the Host's first frame, skipping the relay's own.
   *
   * The relay answers the device's `ready` with a `ready` of its own, and it can
   * arrive before or after the Host's frame. Skipping happens *inside* the loop
   * that is still listening, not by returning and re-registering: an earlier
   * version cleaned up its listeners on the first frame it saw and then checked
   * whether that frame was the one it wanted, so the relay's `ready` detached the
   * listener and the Host's real answer was delivered to nobody. The device then
   * waited forever, every time, because the relay's frame nearly always wins.
   */
  function awaitHostFrame(socket) {
    return new Promise(function (resolve, reject) {
      function onMessage(event) {
        if (typeof event.data !== 'string') return
        var message
        try { message = JSON.parse(event.data) } catch { return }
        // Anything that is not a signed Host message is the relay's control plane.
        if (message === null || message.t !== 'host') return
        cleanup()
        resolve(message)
      }
      function onClose() { cleanup(); reject(new Error('连接在握手完成前就关闭了')) }
      function onError() { cleanup(); reject(new Error('握手期间连接失败')) }
      function cleanup() {
        socket.removeEventListener('message', onMessage)
        socket.removeEventListener('close', onClose)
        socket.removeEventListener('error', onError)
      }
      socket.addEventListener('message', onMessage)
      socket.addEventListener('close', onClose)
      socket.addEventListener('error', onError)
    })
  }

  /**
   * Run the exchange and return the sealed session.
   *
   * The device is finished the moment it has sent `prove`: the Host's later
   * `ready` is the Host's own confirmation and belongs to the Host's state
   * machine, not this one. Feeding it back in is a protocol mismatch.
   *
   * The pinned key is checked before any cryptography. A Host that is not the one
   * this device paired with is not worth verifying.
   */
  async function runHandshake(socket, identity, hostId, pinnedHostKey) {
    var ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    var ephemeralPublic = await encodeEphemeral(ephemeral.publicKey)
    var peerNonce = randomToken(32)

    socket.send(JSON.stringify({
      t: 'hello',
      v: PROTOCOL,
      deviceId: identity.deviceId,
      Sh: identity.signingPublic,
      Xh: identity.agreementPublic,
      Rp: peerNonce,
      Ep: ephemeralPublic,
    }))

    var host = await awaitHostFrame(socket)
    if (host.t !== 'host') {
      throw new Error('主机没有按预期应答（收到 ' + String(host.t) + '）')
    }

    if (pinnedHostKey !== undefined && pinnedHostKey !== host.Sh) {
      throw new Error('主机的密钥与配对时记录的不一致，可能有人在中间冒充')
    }

    var transcript = buildTranscript({
      hostId: hostId,
      deviceId: identity.deviceId,
      peerStaticKey: identity.signingPublic,
      hostStaticKey: host.Sh,
      peerNonce: peerNonce,
      hostNonce: host.Rh,
      hostEphemeral: host.Eh,
      peerEphemeral: ephemeralPublic,
    })

    var hostOk = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importVerifyKey(staticBytes(host.Sh)),
      fromBase64url(host.sig),
      domainSeparate(TRANSCRIPT.HELLO, transcript),
    )
    if (!hostOk) throw new Error('主机未能证明它持有自己的私钥')

    socket.send(JSON.stringify({
      t: 'prove',
      v: PROTOCOL,
      sig: await sign(identity.signingPrivate, domainSeparate(TRANSCRIPT.PROVE, transcript)),
    }))

    var keys = await deriveSessionKeys({
      ephemeralSecret: await deriveSecret(ephemeral.privateKey, await importAgreementPublic(ephemeralBytes(host.Eh))),
      staticSecret: await deriveSecret(identity.agreementPrivate, await importAgreementPublic(staticBytes(host.Xh))),
      transcript: transcript,
    })

    return { session: createSession(keys), hostKey: host.Sh, sas: keys.sas }
  }

  // ------------------------------------------------------------------ carrier
  //
  // One sealed frame per call, one per reply. The relay sees frame boundaries and
  // lengths and nothing else.
  //
  // Correlation is by `rpcId`, not by arrival order. The Host answers in order
  // today, but ordering is a property of the Host's dispatcher rather than of the
  // channel, and a reply that arrived out of order would be handed to the wrong
  // caller — which shows up as a wrong answer, not as an error. The id is in the
  // envelope already, so matching on it costs a Map and removes the assumption.

  var RPC_TIMEOUT_MS = 60000

  // How long a call waits for the pairing handshake before it is told the truth.
  // Generous: the device's own confirmation on the Host is a human step, and a
  // short deadline would report a failure for a channel that is merely waiting on
  // somebody to walk over to their computer.
  var CONNECT_DEADLINE_MS = 5 * 60 * 1000

  function createCarrier(socket, session) {
    var waiting = new Map()
    var closed = false
    var closeReason = null
    var listeners = { message: new Set(), close: new Set(), error: new Set() }

    function emit(type, event) {
      Array.from(listeners[type]).forEach(function (handler) {
        try { handler(event) } catch (error) { console.error('[eduwork-remote] listener failed', error) }
      })
    }

    function settle(rpcId, envelope) {
      var entry = waiting.get(rpcId)
      if (entry === undefined) return false
      waiting.delete(rpcId)
      clearTimeout(entry.timer)
      entry.resolve(envelope)
      return true
    }

    function settleAll(reason) {
      Array.from(waiting.entries()).forEach(function (pair) {
        clearTimeout(pair[1].timer)
        pair[1].reject(new Error(reason))
      })
      waiting.clear()
    }

    // Sealing is asynchronous (WebCrypto) but the wire is ordered: two frames that
    // start in order can finish out of order, and the Host rejects the second one.
    // One chain both reserves order and keeps the socket writes in it.
    var sendChain = Promise.resolve()
    function sendSealed(text) {
      var run = sendChain.then(function () {
        if (closed) throw new Error(closeReason === null ? '远程通道已关闭' : closeReason)
        return session.seal(utf8(String(text)))
      }).then(function (frame) {
        socket.send(frame)
      })
      sendChain = run.then(function () {}, function () {})
      return run
    }

    // Frames must be opened in arrival order. `session.open` checks the receive
    // sequence *before* its asynchronous decrypt, so two handlers running at once
    // both see the same expected number and the later frame is refused even though it
    // arrived in order. A phone's slower WebCrypto makes that overlap common — the
    // workspace baseline and the `$events` ready are dropped and the connection never
    // becomes ready. The Host serializes its inbound queue for the same reason.
    var inbound = Promise.resolve()
    function handleFrame(event) {
      return (async function () {
        try {
          var frame = event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : event.data instanceof Blob
              ? new Uint8Array(await event.data.arrayBuffer())
              : null
          // Too short to be a sealed frame, so it is still the relay's control
          // plane — its `ready`, arriving late.
          if (frame === null || frame.length < HEADER_BYTES + TAG_BYTES) return
          var plain = await session.open(frame)
          var envelope = JSON.parse(new TextDecoder().decode(plain))
          if (envelope === null || typeof envelope !== 'object') return
          if (settle(envelope.rpcId, envelope)) return
          emit('message', { data: JSON.stringify(envelope) })
        } catch (error) {
          emit('error', { message: String(error && error.message ? error.message : error) })
        }
      })()
    }
    socket.addEventListener('message', function (event) {
      inbound = inbound.then(function () { return handleFrame(event) }, function () { return handleFrame(event) })
    })

    socket.addEventListener('close', function (event) {
      closed = true
      closeReason = '远程通道已关闭（' + String(event.code) + '）'
      settleAll(closeReason)
      emit('close', { code: event.code, reason: event.reason })
    })
    socket.addEventListener('error', function () {
      if (closed) return
      closed = true
      closeReason = '连接失败'
      settleAll(closeReason)
      emit('error', { message: closeReason })
    })

    /**
     * Seal one envelope and resolve with its reply.
     *
     * Rejects on every path that leaves no reply: a closed socket, a seal failure,
     * and a Host that never answers. The timeout is the one that matters — without
     * it a call to a Host that has stopped dispatching never settles, and the
     * screen it is blocking stays blank with nothing to report.
     */
    function request(envelope, rpcId) {
      return new Promise(function (resolve, reject) {
        if (closed) {
          reject(new Error(closeReason === null ? '远程通道已关闭' : closeReason))
          return
        }
        var timer = setTimeout(function () {
          if (!waiting.delete(rpcId)) return
          reject(new Error('远程通道在 ' + String(RPC_TIMEOUT_MS) + 'ms 内没有回应'))
        }, RPC_TIMEOUT_MS)
        waiting.set(rpcId, { resolve: resolve, reject: reject, timer: timer })
        sendSealed(JSON.stringify(envelope)).catch(function (error) {
          if (!waiting.delete(rpcId)) return
          clearTimeout(timer)
          reject(new Error(String(error && error.message ? error.message : error)))
        })
      })
    }

    return {
      request: request,
      /**
       * Seal one already-serialized text frame and send it.
       *
       * The Gateway's stream mux is the one caller that is not an RPC: its frames
       * carry their own `type`/`streamId` and have no `rpcId` to settle. The Host
       * already routes exactly this vocabulary (open/item/end/error) on the same
       * sealed channel, so the mux needs a raw send rather than a second protocol.
       */
      sendFrame: function (text) {
        if (closed) {
          return Promise.reject(new Error(closeReason === null ? '远程通道已关闭' : closeReason))
        }
        return sendSealed(text)
      },
      addEventListener: function (type, handler) { if (listeners[type] !== undefined) listeners[type].add(handler) },
      removeEventListener: function (type, handler) { if (listeners[type] !== undefined) listeners[type].delete(handler) },
      close: function () {
        closed = true
        settleAll('远程通道已关闭')
        try { socket.close() } catch (error) { void error }
      },
    }
  }

  // ---------------------------------------------------------------- assembly

  function readHostId() {
    var fromQuery = new URLSearchParams(location.search).get('h')
    if (fromQuery !== null && fromQuery !== '') return fromQuery
    var segments = location.pathname.split('/').filter(Boolean)
    var marker = segments.indexOf('h')
    if (marker >= 0 && segments[marker + 1] !== undefined && segments[marker + 1] !== '') return segments[marker + 1]
    return null
  }

  /**
   * The device's view of the Host.
   *
   * Deliberately small and collapsible. An earlier version was a fixed panel up
   * to 45% of the viewport, which was fine while the only thing on the page was
   * the panel and wrong the moment the real application rendered underneath it.
   * The first line states where the connection stands; `详情` opens the rest.
   */
  function overlay(text) {
    function apply() {
      if (document.body === null) return
      var node = document.getElementById('eduwork-remote-status')
      if (node === null) {
        node = document.createElement('div')
        node.id = 'eduwork-remote-status'
        node.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;' +
          'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:#111;color:#eee;' +
          'display:flex;align-items:center;gap:8px;padding:3px 8px'
        var line = document.createElement('span')
        line.id = 'eduwork-remote-status-line'
        line.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'
        var toggle = document.createElement('button')
        toggle.id = 'eduwork-remote-status-toggle'
        toggle.type = 'button'
        toggle.textContent = '详情'
        toggle.style.cssText = 'flex:none;font:inherit;color:#111;background:#eee;border:0;' +
          'border-radius:3px;padding:1px 7px;cursor:pointer'
        var detail = document.createElement('pre')
        detail.id = 'eduwork-remote-status-detail'
        detail.style.cssText = 'display:none;flex-basis:100%;margin:0;white-space:pre-wrap;' +
          'max-height:40vh;overflow:auto'
          'max-height:30vh;overflow:auto;color:#9a9a9a'
        toggle.addEventListener('click', function () {
          var open = detail.style.display !== 'none'
          detail.style.display = open ? 'none' : 'block'
          toggle.textContent = open ? '详情' : '收起'
        })
        node.appendChild(line)
        node.appendChild(toggle)
        node.appendChild(detail)
        document.body.appendChild(node)
      }
      // The first line is the state; everything after it is detail.
      var parts = String(text).split('\n')
      document.getElementById('eduwork-remote-status-line').textContent = parts[0]
      document.getElementById('eduwork-remote-status-detail').textContent = parts.slice(1).join('\n')
      window.__EDUWORK_REMOTE_STATUS__ = text
    }
    if (document.body === null) document.addEventListener('DOMContentLoaded', apply)
    else apply()
  }

  var state = { status: 'idle', hostId: null, deviceId: null, hostKey: null, sas: null, error: null }

  // Installed now, armed by `connect()`. The application reads this once, at its
  // own import time, so it has to exist before the handshake rather than after it.
  // The first remote load fetches every client bundle over the relay. On a slow
  // network that can take longer than the product's 15 s generation-ready deadline,
  // which aborts the generation before the workspace/event streams even open: the
  // UI then reconnects forever with an empty workspace list. Give the first load
  // room; a healthy host still reports ready in milliseconds.
  if (globalThis.__DSH_CONNECTION_RECOVERY__ !== undefined) {
    globalThis.__DSH_CONNECTION_RECOVERY__ = Object.assign({}, globalThis.__DSH_CONNECTION_RECOVERY__, {
      generationReadyWarnMs: 30000,
      generationReadyTimeoutMs: 120000,
    })
  }

  var transportControl = installTransport()

  /**
   * The transport, installed before the handshake and armed by it.
   *
   * The application imports its modules as soon as the document is parsed, which
   * can be well before a pairing handshake has finished — and it reads
   * `__DSH_TRANSPORT__` once, at its own import time. Installing the real
   * transport only after the handshake therefore loses a race that is invisible
   * when it is won: the application would take the HTTP fallback, and every call
   * would go to the relay as a plain request.
   *
   * So the transport exists from the start and defers: until `arm` is given a
   * carrier, `call` waits. Past a deadline it fails with something that names the
   * real cause, because "the connection is still being set up" and "this device
   * was never confirmed" both present as a blank screen, and only one of them is
   * about waiting.
   */
  function installTransport() {
    var carrier = null
    var failure = null
    var queued = []

    function settle() {
      var pending = queued
      queued = []
      pending.forEach(function (entry) {
        if (carrier !== null) entry.resolve(carrier)
        else entry.reject(new Error(failure === null ? '远程接入尚未就绪' : failure))
      })
    }

    function defer() {
      return new Promise(function (resolve, reject) {
        // Declared before the timer that reads it; a `var` binding would be
        // hoisted but `undefined` at the moment the callback runs, and `indexOf`
        // on that throws before the rejection is ever delivered.
        var entry = {
          resolve: function (value) { clearTimeout(timer); resolve(value) },
          reject: function (error) { clearTimeout(timer); reject(error) },
        }
        var timer = setTimeout(function () {
          var index = queued.indexOf(entry)
          if (index >= 0) queued.splice(index, 1)
          reject(new Error('远程信道在 ' + String(CONNECT_DEADLINE_MS) + 'ms 内没有就绪'))
        }, CONNECT_DEADLINE_MS)
        queued.push(entry)
      })
    }

    /**
     * The Gateway's stream mux, carried by the same sealed channel as calls.
     *
     * The application opens `new WebSocket(.../api/remote.mux)` itself. On a
     * loopback visit that is a real socket; here the Host is behind a relay and the
     * browser cannot reach it, so the mux frames are sealed onto the channel the
     * Host already speaks. The vocabulary is the same (open/item/end/error) and the
     * Host's channel routes it unchanged — the only missing piece was this endpoint.
     */
    var muxSockets = new Set()

    function MuxSocket(url) {
      this.url = url
      this.readyState = 0
      this.binaryType = 'arraybuffer'
      this.listeners = { open: new Set(), message: new Set(), close: new Set(), error: new Set() }
      this.queue = []
      this.closed = false
      this.onCarrierMessage = null
      muxSockets.add(this)
      if (carrier !== null) this._arm(carrier)
      else if (failure !== null) this._fail(failure)
    }

    MuxSocket.prototype.addEventListener = function (type, handler) {
      if (this.listeners[type] !== undefined) this.listeners[type].add(handler)
    }
    MuxSocket.prototype.removeEventListener = function (type, handler) {
      if (this.listeners[type] !== undefined) this.listeners[type].delete(handler)
    }
    MuxSocket.prototype._emit = function (type, event) {
      var handlers = this.listeners[type]
      Array.from(handlers === undefined ? [] : handlers).forEach(function (handler) {
        try { handler(event) } catch (error) { console.error('[eduwork-remote] mux listener failed', error) }
      })
    }
    MuxSocket.prototype._arm = function (armed) {
      if (this.closed || this.readyState === 1) return
      this.readyState = 1
      var self = this
      this.onCarrierMessage = function (event) {
        var text = event === undefined || event === null ? undefined : event.data
        if (typeof text !== 'string') return
        var frame
        try { frame = JSON.parse(text) } catch (error) { return }
        if (frame === null || typeof frame !== 'object') return
        if (frame.type !== 'open' && frame.type !== 'item' && frame.type !== 'end' && frame.type !== 'error') return
        self._emit('message', { data: JSON.stringify(frame) })
      }
      armed.addEventListener('message', this.onCarrierMessage)
      this.onCarrierClose = function (event) {
        self._fail('carrier closed')
      }
      armed.addEventListener('close', this.onCarrierClose)
      var pending = this.queue
      this.queue = []
      pending.forEach(function (text) {
        armed.sendFrame(text).catch(function () { /* the mux client observes the close */ })
      })
      // Deferred: the constructor may run before the caller has attached `open`.
      setTimeout(function () { if (!self.closed) self._emit('open', {}) }, 0)
    }
    MuxSocket.prototype._fail = function (message) {
      if (this.closed) return
      this.closed = true
      this.readyState = 3
      var self = this
      setTimeout(function () {
        self._emit('error', { message: String(message) })
        self._emit('close', { code: 1006, reason: String(message) })
      }, 0)
      muxSockets.delete(this)
    }
    MuxSocket.prototype.send = function (data) {
      if (this.closed) throw new Error('远程通道已关闭')
      var text = typeof data === 'string' ? data : JSON.stringify(data)
      if (carrier === null) {
        this.queue.push(text)
        return
      }
      var self = this
      carrier.sendFrame(text).catch(function (error) {
        self._fail(error === undefined || error === null ? '发送失败' : String(error.message === undefined ? error : error.message))
      })
    }
    MuxSocket.prototype.close = function (code, reason) {
      if (this.closed) return
      this.closed = true
      this.readyState = 3
      if (this.onCarrierMessage !== null && carrier !== null) {
        try { carrier.removeEventListener('message', this.onCarrierMessage) } catch (error) { void error }
      }
      this._emit('close', { code: code === undefined ? 1000 : code, reason: reason === undefined ? '' : reason })
      muxSockets.delete(this)
    }

    // Only the mux URL is replaced; the relay's own peer socket still uses the
    // native constructor, and so does every other part of the page.
    var NativeWebSocket = window.WebSocket
    function WebSocketShim(url, protocols) {
      if (typeof url === 'string' && url.indexOf('remote.mux') >= 0) {
        return new MuxSocket(url)
      }
      if (typeof url === 'string' && url.indexOf('/api/') >= 0) console.log('[eduwork-remote] native websocket', String(url))
      return protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols)
    }
    WebSocketShim.CONNECTING = 0
    WebSocketShim.OPEN = 1
    WebSocketShim.CLOSING = 2
    WebSocketShim.CLOSED = 3
    WebSocketShim.prototype = NativeWebSocket.prototype
    window.WebSocket = WebSocketShim
    globalThis.WebSocket = WebSocketShim

    var transport = {
      rpc: {
        call: function (channel, endpoint, payload, signal) {
          var ready = carrier !== null
            ? Promise.resolve(carrier)
            : failure !== null
              ? Promise.reject(new Error(failure))
              : defer()
          return ready.then(function (armed) {
            return createTransport(armed).rpc.call(channel, endpoint, payload, signal)
          })
        },
      },
      // Where the application resolves `/api/remote.mux`. The shim above answers it.
      streamBaseUrl: location.origin + location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1),
      ownsHost: false,
    }

    // Both names. The application reads `globalThis.__DSH_TRANSPORT__`, and in a
    // page `globalThis` *is* `window` — but writing only through `window` assumes
    // that, and the assumption is invisible wherever it does not hold.
    window.__DSH_TRANSPORT__ = transport
    globalThis.__DSH_TRANSPORT__ = transport

    return {
      arm: function (armed) {
        carrier = armed
        muxSockets.forEach(function (socket) { socket._arm(armed) })
        settle()
      },
      fail: function (message) {
        failure = message
        muxSockets.forEach(function (socket) { socket._fail(message) })
        settle()
      },
    }
  }

  /**
   * The transport the application adopts, once a carrier exists.
   *
   * The application does not open a socket of its own. `dsh-client-connection`
   * reads `globalThis.__DSH_TRANSPORT__` and takes its `rpc` member, falling back
   * to an HTTP implementation only when that member is absent:
   *
   *     const rpc = transport?.rpc ?? createWebConnectionRpc(transport?.fetch, …)
   *
   * So the whole of the integration is one `call` whose wire envelope is the one
   * the fallback would have built anyway. An earlier version installed a
   * WebSocket-shaped object here; the application never constructs a WebSocket, so
   * that object was never consulted and nothing worked.
   */
  function createTransport(carrier) {
    /**
     * Transport-level problems reject; a failure the Host reports is returned.
     *
     * `parseConnectionResponse` insists on a string `code` and an object
     * `details`, so a locally invented `{code: 500}` envelope would be rejected by
     * the decoder before the caller ever saw it. Local failures therefore reject.
     */
    function call(channel, endpoint, payload, signal) {
      if (typeof channel !== 'string' || !/^\/[A-Za-z0-9._~-]+$/.test(channel)) {
        return Promise.reject(new Error('远程调用：非法通道 ' + JSON.stringify(channel)))
      }
      if (typeof endpoint !== 'string' || endpoint === '') {
        return Promise.reject(new Error('远程调用：非法端点 ' + JSON.stringify(endpoint)))
      }
      if (signal !== undefined && signal.aborted) {
        return Promise.reject(signal.reason === undefined ? new Error('已取消') : signal.reason)
      }

      var rpcId = 'device-' + toBase64url(randomBytes(16))
      var envelope = { type: 'client-request', rpcId: rpcId, method: endpoint, payload: payload }

      return carrier.request(envelope, rpcId).then(function (reply) {
        if (reply === null || typeof reply !== 'object' || reply.type !== 'server-response') {
          throw new Error('远程调用：回应不是 server-response 信封')
        }
        if (reply.rpcId !== rpcId) {
          throw new Error('远程调用：rpcId 不匹配（发出 ' + rpcId + '，收到 ' + String(reply.rpcId) + '）')
        }
        return reply.result
      })
    }

    return {
      rpc: { call: call },
      // The page reached the Host through a pairing this device completed, so the
      // application should not present itself as a loopback visit.
      ownsHost: false,
    }
  }

  async function connect() {
    var hostId = readHostId()
    if (hostId === null) {
      state.status = 'no-host-id'
      transportControl.fail('URL 里没有 h=<hostId>，无法确定要连哪台电脑')
      overlay('远程接入：URL 里没有 h=<hostId>，不知道要连哪台电脑。')
      return state
    }
    state.hostId = hostId

    var identity = await loadIdentity()
    state.deviceId = identity.deviceId

    // Read before connecting: a Host whose key changed must be refused before any
    // call is made, not after.
    var pairing = await readRecord('host:' + hostId)
    var pinned = pairing === undefined || pairing === null ? undefined : pairing.hostKey

    var scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
    var base = location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1); var url = scheme + '//' + location.host + base + 'peer?h=' + encodeURIComponent(hostId)
    state.status = 'connecting'
    overlay('远程接入：正在连接 ' + hostId + '\n设备 ' + identity.deviceId +
      (pinned === undefined ? '\n本设备尚未与这台电脑配对过。' : '\n已记录这台电脑的密钥。'))

    var socket = new WebSocket(url)
    // Before any listener is attached: the default is `blob`, and a Blob reaching
    // the frame parser produces a zero-length array rather than an error, which
    // looks exactly like a protocol bug.
    socket.binaryType = 'arraybuffer'

    await new Promise(function (resolve, reject) {
      var settled = false
      function fail(error) {
        if (settled) return
        settled = true
        reject(error)
      }
      socket.addEventListener('open', function () { settled = true; resolve() })
      socket.addEventListener('error', function () { fail(new Error('无法连接到中继')) })
      socket.addEventListener('close', function (event) {
        fail(new Error('中继关闭了连接（' + String(event.code) + '）'))
      })
    })

    return new Promise(function (resolve, reject) {
      void (async function () {
        try {
          // The relay switches to transparent forwarding on this frame, and it
          // must be sent before the handshake: the Host waits for our `hello`
          // while the relay waits for our `ready`, so either order deadlocks the
          // other side.
          socket.send(JSON.stringify({ t: 'ready' }))
          var outcome = await runHandshake(socket, identity, hostId, pinned)

          state.hostKey = outcome.hostKey
          state.sas = outcome.sas
          if (pinned === undefined) {
            await writeRecord('host:' + hostId, { hostKey: outcome.hostKey, pairedAt: Date.now() })
            state.status = 'awaiting-confirmation'
            overlay('远程接入：已连接到 ' + hostId + '，并记录了它的密钥。\n' +
              '设备 ' + identity.deviceId + '\n' +
              '核对码 ' + outcome.sas + '\n' +
              '请在这台电脑上确认此设备后再继续。')
          } else {
            state.status = 'ready'
            overlay('远程接入：已连接到 ' + hostId + '。\n设备 ' + identity.deviceId)
          }

          transportControl.arm(createCarrier(socket, outcome.session))
          window.dispatchEvent(new CustomEvent('eduwork-remote-ready', {
            detail: {
              hostId: hostId,
              deviceId: identity.deviceId,
              hostKey: outcome.hostKey,
              sas: outcome.sas,
              paired: pinned !== undefined,
            },
          }))
          resolve(state)
        } catch (error) {
          state.status = 'failed'
          state.error = String(error && error.message ? error.message : error)
          // Fail the transport too. Queued calls would otherwise sit until the
          // five-minute deadline and then report a timeout, which names the wrong
          // cause for a handshake that has already been given up on.
          transportControl.fail(state.error)
          overlay('远程接入失败：' + state.error)
          try { socket.close() } catch (closeError) { void closeError }
          reject(error)
        }
      })()
    })
  }

  window.__EDUWORK_REMOTE__ = {
    version: PROTOCOL,
    state: state,
    connect: connect,
    loadIdentity: loadIdentity,
    /** Everything the pairing page needs to show, without duplicating the identity. */
    describe: function () {
      return loadIdentity().then(function (identity) {
        return {
          deviceId: identity.deviceId,
          signingPublic: identity.signingPublic,
          agreementPublic: identity.agreementPublic,
          status: state.status,
          sas: state.sas,
        }
      })
    },
    forgetHost: function (hostId) { return writeRecord('host:' + hostId, null) },
    resetDevice: function () { return writeRecord('identity', null) },
    /**
     * Reached only under the flag below.
     *
     * This file repeats the channel's crypto because it cannot `import` it, so the
     * two copies can drift and the only symptom would be a handshake that fails on
     * a phone. `test/bootstrap.test.mjs` drives these against the real
     * `HostHandshake`; without that, "it looks the same" is the entire argument.
     */
    test: typeof TEST_HOOK === 'undefined' ? undefined : {
      PROTOCOL: PROTOCOL,
      TRANSCRIPT: TRANSCRIPT,
      HEADER_BYTES: HEADER_BYTES,
      encodeStatic: encodeStatic,
      encodeEphemeral: encodeEphemeral,
      staticBytes: staticBytes,
      ephemeralBytes: ephemeralBytes,
      buildTranscript: buildTranscript,
      domainSeparate: domainSeparate,
      deriveSessionKeys: deriveSessionKeys,
      createSession: createSession,
      splitFrame: splitFrame,
      nonceFor: nonceFor,
      runHandshake: runHandshake,
      randomToken: randomToken,
      // The transport seam. The application reads `__DSH_TRANSPORT__` once at its
      // own import time, so what it finds there is the whole integration — and it
      // is the part a browser cannot be asked about in a test.
      createCarrier: createCarrier,
      createTransport: createTransport,
      installTransport: installTransport,
      RPC_TIMEOUT_MS: RPC_TIMEOUT_MS,
      CONNECT_DEADLINE_MS: CONNECT_DEADLINE_MS,
    },
  }

  // Auto-connect only when the page was opened by a device. `?h=` or `/h/<id>` is
  // the whole signal: a local visit to the Host's own UI carries neither.
  if (readHostId() !== null) {
    connect().catch(function (error) {
      console.error('[eduwork-remote] connect failed', error)
    })
  }
})()
