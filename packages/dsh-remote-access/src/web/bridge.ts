/**
 * What the three parts of the web client say to each other. The loader page
 * at `h/<hostId>/` owns the encrypted tunnel; the DSH interface runs in its
 * iframe at `h/<hostId>/app/`, whose preamble sends RPCs and streams through
 * the parent's tunnel; the Service Worker answers the iframe's other requests
 * (the document, static files, file downloads and uploads) through the loader.
 * Paths are below the relay's base URL.
 */

export const hostPath = (hostId: string): string => `h/${hostId}/`
export const appPath = (hostId: string): string => `h/${hostId}/app/`

/** The host id of a path below the base, `h/<hostId>/…`, and the rest of it. */
export function parseHostPath(path: string): { hostId: string; rest: string } | undefined {
  const match = /^h\/([A-Za-z0-9_-]{43})\/(.*)$/.exec(path)
  return match === null ? undefined : { hostId: match[1]!, rest: match[2]! }
}

export interface BridgeRequest {
  readonly method: string
  /** Path and query on the Host, e.g. `/api/file?path=…`. */
  readonly url: string
  readonly headers: [string, string][]
  readonly body?: ArrayBuffer
}

export type BridgeResponse =
  | { readonly status: number; readonly headers: [string, string][]; readonly body: ArrayBuffer }
  /** The tunnel is down; the caller fails as on a network error so DSH retries. */
  | { readonly error: string }

/** Posted by the Service Worker to the loader, with a reply port. */
export interface FetchMessage { readonly kind: 'fetch'; readonly request: BridgeRequest }

/** `window.remoteTunnel` on the loader page, used by the preamble in its iframe. */
export interface RemoteTunnel {
  fetch(request: BridgeRequest, signal?: AbortSignal | null): Promise<BridgeResponse>
  /** Values come from the loader's realm; the preamble clones them into its own. */
  openStream(endpoint: string, payload: unknown, signal: AbortSignal, uplink?: AsyncIterable<unknown>): AsyncIterable<unknown>
}
