const MAX_FEED_BYTES = 5 * 1024 * 1024

/** One bounded body shared by all parsers; never buffer an unbounded remote feed. */
export async function boundedResponse(response) {
  const reader = response.body?.getReader()
  if (!reader) return response
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_FEED_BYTES) throw new Error('日历订阅内容超过 5 MiB 上限')
      chunks.push(value)
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
  finally { reader.releaseLock() }
  return new Response(Buffer.concat(chunks), { status: response.status, statusText: response.statusText, headers: response.headers })
}
