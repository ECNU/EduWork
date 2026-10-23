/**
 * Runs first in the DSH document inside the loader's iframe. It hands DSH's
 * client the carrier hooks it already supports, so RPCs and Gateway streams
 * travel this page's own tunnel (and so its own Host Peer). Apart from the
 * click of a download link (below), nothing global is replaced.
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

/**
 * Browsers start the download of an `<a download>` link without asking the
 * Service Worker, so a link into the app would reach the relay instead of the
 * Host. Fetch it through the Service Worker and save a local copy instead.
 */
function interceptDownload(event: Event): void {
  const anchor = (event.target as Element | null)?.closest?.('a[download]')
  if (event.defaultPrevented || !(anchor instanceof HTMLAnchorElement)) return
  const url = new URL(anchor.href)
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return
  event.preventDefault()
  save(url, anchor.download).catch(error => console.error('remote download failed', error))
}

const click = HTMLAnchorElement.prototype.click

async function save(url: URL, name: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.pathname}`)
  const copy = document.createElement('a')
  copy.href = URL.createObjectURL(await response.blob())
  copy.download = name || dispositionName(response.headers.get('content-disposition') ?? '') || url.pathname.split('/').at(-1)!
  click.call(copy)
  setTimeout(() => URL.revokeObjectURL(copy.href), 60_000)
}

/** The file name a `Content-Disposition` header gives, if any. */
function dispositionName(header: string): string | undefined {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1]
  return encoded === undefined ? /filename="?([^";]+)/i.exec(header)?.[1] : decodeURIComponent(encoded)
}

if (tunnel !== undefined) {
  // The client plugin fits DSH's interface to a phone only on remote devices.
  document.documentElement.setAttribute('data-eduwork-remote', '')
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
  addEventListener('click', interceptDownload, true)
  // DSH also clicks links it never attaches; their click does not reach the window.
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (!this.isConnected) this.addEventListener('click', interceptDownload, { once: true })
    click.call(this)
  }
}
