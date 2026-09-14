// The official Host shares one response pipe. Fully consume each finite block
// before yielding it to Electron so a paused media reader cannot pause all RPCs.
export const MEDIA_BLOCK_BYTES = 256 * 1024
const filePath = path => path === '/api/artifactPreview/file' || path.startsWith('/chatecnu-work/artifacts/')

export async function fetchDesktopProtocolResponse(host, request, isClosing) {
  if (isClosing()) return new Response(null, { status: 503 })
  try { return await fetchDesktopResponse(host, request) }
  catch (error) {
    // An in-flight request can lose its pipe after normal application teardown.
    if (isClosing()) return new Response(null, { status: 503 })
    throw error
  }
}

export async function fetchDesktopResponse(host, request) {
  if (request.method !== 'GET' || !filePath(new URL(request.url).pathname)) return host.fetch(request)
  const abort = new AbortController()
  const signal = AbortSignal.any([request.signal, abort.signal])
  const metadata = await host.fetch(new Request(request, { method: 'HEAD', signal }))
  await metadata.body?.cancel()
  if (![200, 206].includes(metadata.status)) return new Response(null, { status: metadata.status, headers: metadata.headers })
  const length = Number(metadata.headers.get('content-length'))
  if (!Number.isSafeInteger(length) || length < 0 || metadata.headers.get('accept-ranges') !== 'bytes') return host.fetch(request)
  let offset = 0, total = length
  if (metadata.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(metadata.headers.get('content-range') ?? '')
    if (!range) throw new Error('Invalid desktop media range metadata')
    offset = Number(range[1]); total = Number(range[3])
    if (!Number.isSafeInteger(total) || Number(range[2]) - offset + 1 !== length || Number(range[2]) >= total) throw new Error('Invalid desktop media range bounds')
  }
  let remaining = length
  const body = new ReadableStream({
    async pull(controller) {
      try {
        signal.throwIfAborted()
        if (remaining === 0) { controller.close(); return }
        const size = Math.min(remaining, MEDIA_BLOCK_BYTES)
        const headers = new Headers(request.headers)
        headers.delete('if-range')
        headers.set('range', `bytes=${offset}-${offset + size - 1}`)
        const part = await host.fetch(new Request(request, { headers, signal }))
        if (part.status !== 206 || part.headers.get('content-range') !== `bytes ${offset}-${offset + size - 1}/${total}` || Number(part.headers.get('content-length')) !== size) {
          await part.body?.cancel()
          throw new Error('Desktop media changed during transfer')
        }
        // Do not retain a live official response while the browser is paused.
        const bytes = new Uint8Array(await part.arrayBuffer())
        if (bytes.length !== size) throw new Error('Incomplete desktop media block')
        offset += size; remaining -= size
        controller.enqueue(bytes)
      } catch (error) { abort.abort(); controller.error(error) }
    },
    cancel(reason) { abort.abort(reason) },
  }, { highWaterMark: 0 })
  return new Response(body, { status: metadata.status, headers: metadata.headers })
}
