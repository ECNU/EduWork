const PATHS = new Set(['resolve', 'describe', 'set', 'unset'])

export async function callNativeBridge(bridge, operation, payload, fetchImpl = fetch) {
  if (!PATHS.has(operation)) throw new Error('unsupported native credential operation')
  const response = await fetchImpl(`${bridge.baseURL}/v1/credentials/${operation}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${bridge.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    // Never include a response body: the native boundary deliberately keeps
    // implementation details and possible secret-bearing errors private.
    throw new Error(`native credential ${operation} failed with status ${String(response.status)}`)
  }
  return response.status === 204 ? undefined : await response.json()
}
