// The join between the tunnel and the kernel.
//
// The tunnel decides *whether* a call may proceed and speaks the wire protocol.
// It does not know how to reach the running Host, and it must not learn: the way
// to reach a DSH Host is a private contract that changes between releases, and a
// wire protocol that absorbed it would have to change with it.
//
// So this module is the only place that knows both. It is deliberately small and
// has no policy of its own — every decision above it has already been made by the
// time a call arrives here.
//
// ## Why the call goes through a synthetic browser request
//
// The kernel exposes its RPC on `/api` behind a fence that asks three questions:
// is this request's target authority one we trust, does it carry the browser
// cookie for that authority, and does the path name a registered endpoint. There
// are two ways to answer on the Host's behalf.
//
// The first is to register an interceptor against `/api`, which is the single
// slot the browser transport already occupies and the design notes forbid taking.
// The second is to *become* a browser for the length of one request: mint the
// cookie the Host would have given a browser, then hand a normal `Request` to the
// same shared handler that serves the real one.
//
// This module takes the second. It means a remote call travels the same path as a
// local one and is admitted by the same code, rather than by a parallel door that
// would need to be kept in step with it. The cost is that the cookie is a real
// credential living in this process, which is why it is never logged, never
// sealed into a reply, and dropped when the authority it was minted for changes.

/** The channel the kernel mounts its browser RPC transport on. */
const DEFAULT_API_PATH = '/api'

/** How many side-effecting answers are remembered per tunnel. */
const MAX_REMEMBERED_MUTATIONS = 256

/**
 * Ask the kernel for a browser cookie bound to one authority.
 *
 * The kernel will only hand one over for a `GET` of exactly `/` carrying exactly
 * one `token` parameter whose `Host` header names the authority being bound. The
 * token must come from `authenticatedUrl` — building it by hand would mean
 * reimplementing how the process proves it is itself, and getting that subtly
 * wrong is the kind of bug that only shows up on someone else's machine.
 *
 * The cookie name is derived from the authority and so changes with the port;
 * nothing here assumes it, and the name is read back out of the response.
 *
 * @returns the `Cookie` header value to send, or `undefined` when the kernel
 *          refused — refused rather than thrown, because a Host that cannot
 *          authenticate itself is a broken deployment, not a broken request.
 */
export async function mintCookie({ connection, authority, fetchImpl = globalThis.fetch }) {
  const url = connection.authenticatedUrl(`http://${authority}/`)
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { host: authority },
  })
  if (response.status !== 303) return undefined
  const setCookie = response.headers.getSetCookie?.() ?? []
  const first = setCookie[0]
  if (typeof first !== 'string' || first === '') return undefined
  // Only the name=value pair: the attributes describe how a browser should store
  // it and are meaningless on a request we are about to send ourselves.
  const pair = first.split(';', 1)[0]?.trim()
  return pair === undefined || pair === '' ? undefined : pair
}

/**
 * A stable identity for one side-effecting call.
 *
 * The client's `rpcId` is only unique within one device's request stream, and a
 * device is free to reuse an id for a different payload. Keying the cache on the
 * id alone would let device B receive device A's answer, or let a different
 * prompt be treated as a retry of the first. The whole tuple is the identity.
 */
function mutationKey({ device, endpoint, payload, rpcId }) {
  return JSON.stringify([device?.deviceId ?? null, rpcId, endpoint, payload])
}

/**
 * A kernel-backed Host.
 *
 * Owns the cookie, converts one tunnelled call into one kernel request, and
 * converts the kernel's answer back. It holds no device state: who may call is
 * decided above, and this class must stay unable to widen that.
 */
export class KernelHost {
  #connection
  #authority
  #apiPath
  #fetchImpl
  #Request
  #shared
  /** Resolved owner Peer; the connection service may expose it as `operator` or `browserPeer`. */
  #peer
  /** Cached cookie *promise*, so two calls cannot race into two mints. */
  #cookie
  /** Successful answers to side-effecting calls, keyed by {@link mutationKey}. */
  #mutations = new Map()
  /** Side-effecting calls currently running, so a concurrent retry joins rather than repeats. */
  #inflight = new Map()

  constructor({
    connection,
    authority,
    apiPath = DEFAULT_API_PATH,
    fetchImpl = globalThis.fetch,
    RequestImpl = globalThis.Request,
  }) {
    if (connection === undefined) throw new TypeError('remote-access: the kernel exposed no connection service')
    if (typeof authority !== 'string' || authority === '') throw new TypeError('remote-access: an authority is required')
    if (typeof RequestImpl !== 'function') throw new TypeError('remote-access: no Request implementation available')
    this.#connection = connection
    this.#authority = authority
    this.#apiPath = apiPath
    this.#fetchImpl = fetchImpl
    this.#Request = RequestImpl
    this.#shared = connection.createSharedFetchHandler(apiPath)
  }

  /** The authority this Host authenticates as, e.g. `127.0.0.1:62021`. */
  get authority() {
    return this.#authority
  }

  /**
   * The official owner `Peer` a call speaks for.
   *
   * DSH exposes the browser/owner Peer as `browserPeer` on the connection
   * service; some builds also expose a long-lived `operator`. Prefer the property
   * the installed 0.2.1 service actually defines, then fall back to the public
   * `createPeer` factory rather than passing `undefined` into the Gateway, which
   * fails later at `peer.signal`. The resolved Peer is cached because the Gateway
   * expects a stable identity and because creating one per call would accumulate
   * scopes.
   */
  get peer() {
    if (this.#peer !== undefined) return this.#peer
    const candidate = this.#connection.browserPeer ?? this.#connection.operator
    if (candidate !== undefined) {
      this.#peer = candidate
      return this.#peer
    }
    if (typeof this.#connection.createPeer === 'function') {
      this.#peer = this.#connection.createPeer({
        principal: { kind: 'owner' },
        interactions: 'answer',
      })
      return this.#peer
    }
    throw new Error('remote-access: the connection service exposed no owner Peer')
  }

  /**
   * Check the fence on a request shaped like the one we are about to send.
   *
   * This is a diagnostic, not a gate. The gate is the kernel's own check inside
   * the shared handler, which runs on every call whether or not this does. What
   * this adds is a *legible* failure: if `admit` rejects, the Host's authority is
   * not in the kernel's trusted list or the cookie is not what the kernel wants,
   * and that is worth saying plainly instead of surfacing as a 401 from three
   * layers down.
   *
   * The return value is an object either way — `{ peer }` or `{ rejection }` — so
   * reading it as a boolean would silently pass everything.
   */
  inspect(request) {
    return this.#connection.admit(request)
  }

  async #cookieHeader() {
    if (this.#cookie === undefined) {
      this.#cookie = mintCookie({
        connection: this.#connection,
        authority: this.#authority,
        fetchImpl: this.#fetchImpl,
      }).catch((error) => {
        // Drop the cached attempt so a later call can retry, rather than caching
        // one transient failure for the life of the process.
        this.#cookie = undefined
        throw error
      })
    }
    return this.#cookie
  }

  /** Forget the cookie. Called when the authority changes, since it is bound to it. */
  forgetCookie() {
    this.#cookie = undefined
  }

  /**
   * Run one call, at most once per logical request when it changes something.
   *
   * The kernel's `/api` handler executes every request it receives; it does not
   * remember request ids. A device that loses its connection mid-prompt and
   * resends the same request (as the protocol says it may) would therefore run the
   * prompt twice. `rpcId` is the client's stable identity for one logical call, so
   * remembering the answer here is what turns "the Host does not duplicate side
   * effects" from a comment into a fact.
   *
   * The key is the whole `(device, rpcId, endpoint, payload)` tuple, not the id
   * alone: `rpcId` is scoped to the device that generated it, and a reused id with
   * a different payload is a different call. In-flight calls are joined by the
   * same key, so two copies that arrive together cannot both reach the kernel.
   *
   * Only successful answers are remembered: a transport or kernel failure is not
   * a decision, and the device must be free to retry it. The completed map is
   * bounded; eviction means a very old retry can execute again, which is the
   * documented limit of this in-memory at-most-once guarantee.
   */
  async dispatch(call) {
    if (call.sideEffect !== true) return this.#run(call)
    const key = mutationKey(call)
    const cached = this.#mutations.get(key)
    if (cached !== undefined) return cached
    const running = this.#inflight.get(key)
    if (running !== undefined) return running

    const pending = this.#run(call).then(
      (response) => {
        this.#inflight.delete(key)
        if (response?.result?.ok === true) {
          this.#mutations.set(key, response)
          if (this.#mutations.size > MAX_REMEMBERED_MUTATIONS) {
            this.#mutations.delete(this.#mutations.keys().next().value)
          }
        }
        return response
      },
      (error) => {
        this.#inflight.delete(key)
        throw error
      },
    )
    this.#inflight.set(key, pending)
    return pending
  }

  /**
   * Run one call and return the envelope to seal.
   *
   * The reply is always an envelope, including when the kernel could not be
   * reached. A device that is told nothing cannot distinguish a refusal from a
   * slow Host, and the whole point of the fence above is that its answers are
   * unambiguous.
   */
  async #run({ endpoint, payload, rpcId }) {
    /**
     * A failure envelope the device's decoder will accept.
     *
     * Two rules, both of which an earlier version of this method broke, and the first
     * hid the second:
     *
     *   - `details` must be present and a record. The old shape was
     *     `{ code, message }`, which `parseConnectionResponse` refuses outright, so
     *     every refusal built here reached the device as a transport error rather
     *     than as the reason the Host had written down.
     *   - `code` must be a **string**. The old code passed the HTTP status number
     *     straight through, which the same decoder rejects — and adding `details`
     *     alone did not fix it, because the failure simply moved to the next check.
     *     An HTTP status is not a stable failure code: it says how the request was
     *     answered, not what went wrong, so it becomes a namespaced code with the
     *     status preserved as a detail.
     */
    const failure = (code, message, details = {}) => ({
      type: 'server-response',
      rpcId,
      result: {
        ok: false,
        error: {
          code: typeof code === 'string' && code !== '' ? code : 'host/http-error',
          message,
          details: typeof code === 'string' && code !== '' ? details : { ...details, status: code },
        },
      },
    })

    let cookie
    try {
      cookie = await this.#cookieHeader()
    } catch (error) {
      return failure(500, `the host could not authenticate to itself: ${error.message}`)
    }
    if (cookie === undefined) {
      return failure(500, 'the host refused to issue a browser cookie for its own authority')
    }

    const envelope = { type: 'client-request', rpcId, method: endpoint, payload }
    const request = new this.#Request(`http://${this.#authority}${this.#apiPath}/${endpoint}`, {
      method: 'POST',
      headers: {
        // Both are required. The fence reads `host` to learn which authority is
        // being addressed and then looks for that authority's cookie; a request
        // with only one of the two is rejected, which is what keeps a cookie
        // stolen from one port from working on another.
        host: this.#authority,
        cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify(envelope),
    })

    let response
    try {
      response = await this.#shared.fetch(request, this.peer)
    } catch (error) {
      return failure(500, `the host failed to handle this call: ${error.message}`)
    }

    if (!response.ok) {
      // The kernel answered with a transport-level status, so there is no
      // envelope to relay. Its own reason is passed through because the caller is
      // the operator's own device and the alternative is a silent 500.
      const detail = await response.text().catch(() => '')
      return failure(response.status, detail === '' ? 'the host rejected this call' : detail.slice(0, 300))
    }

    try {
      return await response.json()
    } catch {
      return failure(500, 'the host returned a body that is not a response envelope')
    }
  }
}

/**
 * Build a `dispatch` for {@link createHostTunnel} over a kernel-backed host.
 *
 * Kept as a function rather than folded into the class so the tunnel can be
 * constructed with any dispatcher — including one that never touches a kernel —
 * which is what makes the tunnel testable on its own.
 */
export function kernelDispatch(host) {
  return (call) => host.dispatch({
    endpoint: call.method,
    payload: call.payload,
    rpcId: call.rpcId,
    sideEffect: call.sideEffect,
    // Kept on the call so the mutation cache can scope an id to the device that
    // generated it. The kernel request built below still ignores it.
    device: call.device,
  })
}
