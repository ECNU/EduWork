/**
 * Gzip for the frontend's files on their way to a device: a first load is
 * mostly script and style, which shrink to about a third. Only `page`
 * responses are compressed. They are public files, so their compressed
 * lengths tell the relay nothing; RPC results and streams are left alone,
 * since theirs could hint at their content. A file that never changes at its
 * URL is compressed once and kept while remote access runs.
 */
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import type { HostAdapter } from '../host/adapter.ts'

const gzipAsync = promisify(gzip)
const TEXT = /^(?:text\/|application\/(?:javascript|json|manifest\+json)|image\/svg\+xml)/

export function compressPages(adapter: HostAdapter): HostAdapter {
  const immutable = new Map<string, Promise<Uint8Array<ArrayBuffer>>>()
  const compress = async (response: Response): Promise<Uint8Array<ArrayBuffer>> => new Uint8Array(await gzipAsync(await response.arrayBuffer()))

  return {
    ...adapter,
    async page(request) {
      const response = await adapter.page(request)
      const { headers } = response
      const eligible = request.method === 'GET' && response.status === 200 && !headers.has('content-encoding')
        && TEXT.test(headers.get('content-type') ?? '') && /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')
      if (!eligible) return response

      const { pathname, search } = new URL(request.url)
      const key = headers.get('cache-control')?.includes('immutable') ? pathname + search : undefined
      let body = key === undefined ? undefined : immutable.get(key)
      if (body !== undefined) {
        await response.body?.cancel()
      } else {
        body = compress(response)
        if (key !== undefined) {
          immutable.set(key, body)
          body.catch(() => immutable.delete(key))
        }
      }
      const compressed = new Headers(headers)
      compressed.set('content-encoding', 'gzip')
      compressed.delete('content-length')
      return new Response(await body, { status: 200, headers: compressed })
    },
  }
}
