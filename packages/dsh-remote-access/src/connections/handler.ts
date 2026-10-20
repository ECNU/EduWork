/**
 * What one remote connection may reach: the gate in front of the Host adapter,
 * bound to that connection's Peer. Refusals look like ordinary DSH failures
 * so the interface reports them instead of treating them as a lost carrier.
 */
import { allowsApiCall, allowsApiRequest, allowsEndpoint } from '../gate/gate.ts'
import type { HostAdapter, Peer } from '../host/adapter.ts'
import type { StreamFailure, TunnelHandler } from '../protocol/tunnel.ts'

export const FORBIDDEN = 'remote-access/forbidden'

class Refused extends Error {
  readonly endpoint: string
  constructor(endpoint: string) {
    super(`${endpoint} is not available to remote devices`)
    this.endpoint = endpoint
  }
}

/**
 * @param onRefused - told about each refused endpoint or route, for the Host log.
 */
export function remoteHandler(adapter: HostAdapter, peer: Peer, onRefused: (name: string) => void): TunnelHandler {
  return {
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname !== '/api' && !pathname.startsWith('/api/')) return adapter.page(request)
      if (allowsApiRequest(request.method, pathname)) return adapter.api(request, peer)
      const body = request.method === 'POST' ? await request.text() : ''
      const call = rpcCall(body)
      if (allowsApiCall(request.method, pathname, call?.payload?.args)) return adapter.api(new Request(request, { body }), peer)
      onRefused(`${request.method} ${pathname}`)
      return refusal(call?.rpcId, new Refused(pathname.slice('/api/'.length)))
    },
    openStream(endpoint, payload, uplink, signal) {
      if (allowsEndpoint(endpoint)) return adapter.openStream(endpoint, payload, uplink, peer, signal)
      onRefused(`stream ${endpoint}`)
      throw new Refused(endpoint)
    },
    streamFailure: error => error instanceof Refused ? failureOf(error) : adapter.streamFailure(error),
  }
}

const failureOf = (error: Refused): StreamFailure => ({ code: FORBIDDEN, message: error.message, details: { endpoint: error.endpoint } })

/** The fields of a DSH RPC request body the gate reads, when the body is one. */
function rpcCall(body: string): { rpcId?: unknown; payload?: { args?: unknown } } | undefined {
  try {
    return Object(JSON.parse(body))
  } catch {
    return undefined
  }
}

/** An RPC refusal carries DSH's response envelope for its rpcId; other routes get a plain 403. */
function refusal(rpcId: unknown, error: Refused): Response {
  if (typeof rpcId !== 'string') return new Response(error.message, { status: 403 })
  return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: failureOf(error) } })
}
