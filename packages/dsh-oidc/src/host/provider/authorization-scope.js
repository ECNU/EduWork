/** Keep prepared calls, credential resolution and streamed results in one authorization. */
export class AuthorizationScopedAdapter {
  constructor(inner, storage, createScope) {
    this.inner = inner
    this.storage = storage
    this.createScope = createScope
  }

  providerInfo(provider) { return this.inner.providerInfo(provider) }
  providerRetryPolicy(provider) { return this.inner.providerRetryPolicy(provider) }
  imageRequestPricing(provider, model) { return this.inner.imageRequestPricing(provider, model) }
  listModels(provider) { return this.inner.listModels(provider) }
  resolveModel(provider, model, signal) { return this.inner.resolveModel(provider, model, signal) }

  async prepareCall(provider, model, signal) {
    const scope = await this.createScope(provider)
    const prepared = await this.inner.prepareCall(provider, model, signal)
    return { model: prepared.model, stream: options => this.streamPrepared(prepared, options, scope) }
  }

  async * streamPrepared(prepared, options, scope) {
    if (!scope) { yield* prepared.stream(options); return }
    const lease = scope.open(options.signal)
    let iterator
    try {
      lease.assertCurrent()
      iterator = prepared.stream({ ...options, signal: lease.signal })[Symbol.asyncIterator]()
      for (;;) {
        lease.assertCurrent()
        const next = await this.storage.run(lease, () => iterator.next())
        // Even a transport that buffers or ignores abort must not emit stale data.
        lease.assertCurrent()
        if (next.done) return
        yield next.value
      }
    } finally {
      try { await this.storage.run(lease, () => iterator?.return?.()) }
      finally { lease.close() }
    }
  }

  async * stream(options) {
    const prepared = await this.prepareCall(options.provider, options.model, options.signal)
    yield* prepared.stream(options)
  }
}
