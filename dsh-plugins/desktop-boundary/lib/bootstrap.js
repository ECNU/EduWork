const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u

export function validateBootstrap(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('desktop bootstrap must be an object')
  }
  if (value.schemaVersion !== 1 || !TOKEN_PATTERN.test(value.instanceCredential)) {
    throw new Error('desktop bootstrap has an invalid instance credential')
  }
  const bridge = value.nativeBridge
  if (bridge === null || typeof bridge !== 'object' || Array.isArray(bridge)
    || typeof bridge.baseURL !== 'string' || typeof bridge.token !== 'string'
    || !TOKEN_PATTERN.test(bridge.token)) {
    throw new Error('desktop bootstrap has an invalid native bridge')
  }
  const parsed = new URL(bridge.baseURL)
  if (parsed.protocol !== 'http:' || parsed.username !== '' || parsed.password !== ''
    || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('desktop bootstrap native bridge URL is invalid')
  }
  const address = parsed.hostname.replace(/^\[|\]$/gu, '')
  if (address !== '127.0.0.1' && address !== '::1') {
    throw new Error('desktop bootstrap native bridge must use loopback')
  }
  return Object.freeze({
    schemaVersion: 1,
    instanceCredential: value.instanceCredential,
    nativeBridge: Object.freeze({ baseURL: parsed.origin, token: bridge.token }),
  })
}

export async function readBootstrap(stream = process.stdin, timeoutMs = 10_000) {
  stream.setEncoding('utf8')
  return await new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false
    let timeoutCheck
    // A cold plugin import can block the loop while the parent pipe already
    // contains bootstrap data. Give pending I/O its poll turn before timing out.
    const timer = setTimeout(() => {
      timeoutCheck = setImmediate(() => finish(new Error('desktop bootstrap was not supplied')))
    }, timeoutMs)
    timer.unref?.()
    const cleanup = () => {
      clearTimeout(timer)
      clearImmediate(timeoutCheck)
      stream.off('data', onData)
      stream.off('end', onEnd)
      stream.off('error', onError)
      stream.pause()
    }
    const finish = (error, value) => {
      if (settled) return
      settled = true
      cleanup()
      if (error !== undefined) reject(error)
      else resolve(value)
    }
    const onData = (chunk) => {
      buffer += chunk
      if (buffer.length > 2048) {
        finish(new Error('desktop bootstrap exceeds the maximum length'))
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const line = buffer.slice(0, newline).replace(/\r$/u, '')
      try {
        finish(undefined, validateBootstrap(JSON.parse(line)))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    }
    const onEnd = () => finish(new Error('desktop bootstrap stream ended early'))
    const onError = (error) => finish(error instanceof Error ? error : new Error(String(error)))
    stream.on('data', onData)
    stream.once('end', onEnd)
    stream.once('error', onError)
    stream.resume()
  })
}
