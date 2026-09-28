/**
 * The shared, SSRF-guarded HTTP(S) transport for the literature seam. Supports
 * binary bodies (the arXiv source tarball and PDF) and text, enforces url
 * hygiene, same-origin redirect and byte caps, and a cooperative deadline.
 * @module @eduwork/dsh-literature/core/http
 */

import { deadline } from '@deepseek-ai/dsh-timeout'
import { LiteratureError } from './error.ts'

/** Transport limits a caller (source provider or the service) supplies. */
export interface HttpLimits {
  /** Maximum accepted request URL length. */
  readonly maxUrlLength: number
  /** Maximum response body size in bytes (read is aborted past this). */
  readonly maxResponseBytes: number
  /** Default request timeout in milliseconds. */
  readonly timeoutMs: number
  /** Maximum number of same-origin redirect hops to follow. */
  readonly maxRedirects: number
  /** `User-Agent` header sent on every request. */
  readonly userAgent: string
}

/** One completed HTTP exchange, including binary-or-text body bytes. */
export interface HttpGetResult {
  readonly statusCode: number
  readonly body: Uint8Array
  readonly contentType: string | null
  readonly finalUrl: string
}

/** Per-call transport options. */
export interface HttpGetOptions {
  /** Allow cross-origin redirects (used only for the `doi.org` resolver hop). */
  readonly followCrossOrigin?: boolean
}

/** Validate a request URL against basic transport hygiene. */
function validateUrl(input: string, maxUrlLength: number): URL {
  if (input.length > maxUrlLength) {
    throw new LiteratureError(`URL exceeds the maximum length of ${maxUrlLength}`, 'LITERATURE_FETCH_FAILED')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new LiteratureError(`invalid URL: ${input}`, 'LITERATURE_FETCH_FAILED', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new LiteratureError(`unsupported URL scheme "${url.protocol}"`, 'LITERATURE_FETCH_FAILED')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new LiteratureError('credentials in URLs are not allowed', 'LITERATURE_FETCH_FAILED')
  }
  return url
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * Fetch one URL, following only same-origin redirects up to the hop cap, and
 * return the bounded body bytes.
 * @param input - the URL to fetch.
 * @param limits - transport limits.
 * @param signal - optional caller abort signal.
 * @param options - per-call options.
 * @returns the exchange with body bytes.
 */
export async function httpGet(input: string, limits: HttpLimits, signal?: AbortSignal, options?: HttpGetOptions): Promise<HttpGetResult> {
  if (signal?.aborted) throw new LiteratureError('literature request aborted', 'LITERATURE_FETCH_FAILED')

  using d = deadline(signal, limits.timeoutMs, 'LITERATURE_FETCH_FAILED')
  let currentUrl = validateUrl(input, limits.maxUrlLength).href
  let currentOrigin = new URL(currentUrl).origin
  let redirects = 0
  let crossOriginHops = 0

  for (;;) {
    let response: Response
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': limits.userAgent, accept: '*/*' },
        signal: d.signal,
      })
    } catch (error: unknown) {
      if (signal?.aborted) throw new LiteratureError('literature request aborted', 'LITERATURE_FETCH_FAILED', { cause: error })
      if (d.signal.aborted) throw new LiteratureError('literature request timed out', 'LITERATURE_FETCH_FAILED', { cause: error })
      throw new LiteratureError(`request failed: ${currentUrl}`, 'LITERATURE_FETCH_FAILED', { cause: error })
    }

    if (isRedirectStatus(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (location === null) throw new LiteratureError(`redirect without location: ${currentUrl}`, 'LITERATURE_FETCH_FAILED')
      const next = validateUrl(new URL(location, currentUrl).href, limits.maxUrlLength)
      if (next.origin !== currentOrigin) {
        // One cross-origin hop (the DOI resolver) is allowed on request; a
        // second one would let a publisher chain redirect anywhere.
        if (options?.followCrossOrigin !== true || crossOriginHops >= 1) {
          throw new LiteratureError(`cross-origin redirect blocked: ${next.href}`, 'LITERATURE_FETCH_FAILED')
        }
        crossOriginHops += 1
        currentOrigin = next.origin
      }
      if (redirects >= limits.maxRedirects) throw new LiteratureError('exceeded the redirect budget', 'LITERATURE_FETCH_FAILED')
      redirects += 1
      currentUrl = next.href
      continue
    }

    const lengthHeader = response.headers.get('content-length')
    if (lengthHeader !== null) {
      const declared = Number(lengthHeader)
      if (Number.isFinite(declared) && declared > limits.maxResponseBytes) {
        await response.body?.cancel()
        throw new LiteratureError(`response exceeds the byte cap of ${limits.maxResponseBytes}`, 'LITERATURE_FETCH_FAILED')
      }
    }

    const bytes = new Uint8Array(await readBounded(response, limits.maxResponseBytes, d.signal, signal))
    return {
      statusCode: response.status,
      body: bytes,
      contentType: response.headers.get('content-type'),
      finalUrl: currentUrl,
    }
  }
}

/** Read the body up to the byte cap, aborting past it. */
async function readBounded(response: Response, maxBytes: number, signal: AbortSignal, upstream?: AbortSignal): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new LiteratureError(`response exceeds the byte cap of ${maxBytes}`, 'LITERATURE_FETCH_FAILED')
    }
    chunks.push(value)
    if (signal.aborted) {
      await reader.cancel()
      throw new LiteratureError(upstream?.aborted === true ? 'literature request aborted' : 'literature request timed out', 'LITERATURE_FETCH_FAILED')
    }
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}
