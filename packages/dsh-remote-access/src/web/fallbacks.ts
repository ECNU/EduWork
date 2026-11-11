/**
 * Built-ins that this client and DSH's client call without checking for them,
 * but that Safari has only from iOS 17 on; the web client otherwise runs from
 * iOS 16.4 (the Service Worker's DecompressionStream). Where the browser lacks
 * one, install an equivalent built from older ones. The loader page and the
 * preamble import this before anything else, so it runs ahead of every caller
 * in both realms, DSH's own scripts included.
 */

// Safari 17.4.
Promise.withResolvers ??= <T>(): PromiseWithResolvers<T> => {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// Safari 17.4. Unlike the native one, the result stays referenced by its sources' listeners until one of them aborts.
AbortSignal.any ??= (signals: Iterable<AbortSignal>): AbortSignal => {
  const sources = [...signals], controller = new AbortController()
  const aborted = sources.find(signal => signal.aborted)
  if (aborted !== undefined) {
    controller.abort(aborted.reason)
    return controller.signal
  }
  const onAbort = (event: Event): void => {
    for (const signal of sources) signal.removeEventListener('abort', onAbort)
    controller.abort((event.target as AbortSignal).reason)
  }
  for (const signal of sources) signal.addEventListener('abort', onAbort)
  return controller.signal
}

// Safari 17.
URL.canParse ??= (url: string | URL, base?: string | URL): boolean => {
  try {
    new URL(url, base)
    return true
  } catch {
    return false
  }
}
