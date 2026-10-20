/**
 * Runs first in the DSH document inside the loader's iframe. It hands DSH's
 * client the carrier hooks it already supports, so RPCs and Gateway streams
 * travel this page's own tunnel (and so its own Host Peer). Nothing global is
 * replaced.
 *
 * Values from the loader's realm are cloned into this one: DSH checks plain
 * objects by prototype, so a parent-realm object would read as malformed.
 */
import type { BridgeRequest, RemoteTunnel } from './bridge.ts'

const tunnel = (parent as unknown as { remoteTunnel?: RemoteTunnel }).remoteTunnel
const base = new URL(document.baseURI)

/** DSH's marker for a stream that failed remotely or lost its carrier. */
function streamFailure(error: unknown): Error {
  // The error comes from the loader's realm, where `instanceof` against this realm's classes is false.
  const { name, code, message, details } = error as { name?: string; code?: string; message?: string; details?: object }
  const remote = name === 'TunnelStreamError'
  return Object.assign(new Error(message ?? 'remote stream failed'), {
    dshRemoteStreamFailure: remote ? { kind: 'remote', code, details: structuredClone(details) } : { kind: 'carrier' },
  })
}

if (tunnel !== undefined) {
  Object.assign(globalThis, {
    __DSH_TRANSPORT__: {
      async fetch(input: string | URL, init: RequestInit): Promise<Response> {
        const url = new URL(input, base)
        const request: BridgeRequest = {
          method: init.method ?? 'GET',
          url: `/${url.pathname.slice(base.pathname.length)}${url.search}`,
          headers: [...new Headers(init.headers)],
          ...init.body != null && { body: await new Response(init.body).arrayBuffer() },
        }
        const reply = await tunnel.fetch(request, init.signal)
        if ('error' in reply) throw new TypeError(reply.error)
        return new Response(reply.body.byteLength === 0 ? null : reply.body, { status: reply.status, headers: reply.headers })
      },
      async *openStream(endpoint: string, payload: unknown, signal: AbortSignal, uplink?: AsyncIterable<unknown>): AsyncGenerator<unknown> {
        try {
          for await (const value of tunnel.openStream(endpoint, payload, signal, uplink)) yield structuredClone(value)
        } catch (error) {
          if (signal.aborted) throw signal.reason
          throw streamFailure(error)
        }
      },
    },
  })
}
