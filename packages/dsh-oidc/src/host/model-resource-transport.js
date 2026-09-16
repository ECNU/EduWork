// Shared bounded Host-only reads for optional resource extensions.
const error = (code, message) => Object.assign(new Error(message), { code })

export function validateResourceRead(relativePath, options) {
  if (typeof relativePath !== 'string' || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(relativePath)
    || Object.keys(options).some(key => key !== 'signal')) throw error('oidc_resource_path_denied', 'A fixed model-resource path and read-only options are required')
}

export async function bufferResourceResponse(response, assertCurrent) {
  if (Number(response.headers.get('content-length')) > 1024 * 1024) { await response.body?.cancel(); throw error('oidc_resource_invalid', 'Model resource response is too large') }
  const chunks = [], reader = response.body?.getReader()
  let size = 0
  if (reader) {
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) throw new Error('size'); chunks.push(value) } }
    catch { await reader.cancel().catch(() => {}); throw error('oidc_resource_invalid', 'Model resource response could not be read') }
  }
  await assertCurrent()
  return new Response([204, 205, 304].includes(response.status) ? null : Buffer.concat(chunks), { status: response.status, headers: response.headers })
}
