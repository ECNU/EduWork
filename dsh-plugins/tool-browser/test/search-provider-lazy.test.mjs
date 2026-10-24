import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'

const fixture = `
export const calls = { launches: 0, closes: 0 }
export const chromium = {
  async launch() {
    if (++calls.launches === 1) throw new Error('Synthetic browser launch failure')
    return {
      async newPage() {
        return {
          async goto() {}, async waitForSelector() {}, async waitForTimeout() {}, async close() {},
          locator() { return { async evaluateAll() {
            return [{ title: 'Example query result', url: 'https://example.org/result', snippet: 'Example query result' }]
          } } },
        }
      },
      async close() { calls.closes++ },
    }
  },
}
`

test('web search defers loading, retries a failed launch and shares concurrent first use', async () => {
  const fixtureURL = `data:text/javascript,${encodeURIComponent(fixture)}`
  const previousBrowser = process.env.DSH_MEDIA_BROWSER
  process.env.DSH_MEDIA_BROWSER = process.execPath
  let dispose, loads = 0, calls
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'playwright-core'
        ? { url: fixtureURL, shortCircuit: true }
        : nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url === fixtureURL) loads++
      return nextLoad(url, context)
    },
  })
  try {
    const { createBrowserSearchProvider } = await import('../lib/search-provider.js')
    const provider = createBrowserSearchProvider({ effect: setup => { dispose = setup(); return dispose } })
    const request = { query: 'example query' }
    await assert.rejects(provider.search(request, AbortSignal.abort(new Error('Cancelled'))), /Cancelled/)
    assert.equal(loads, 0, 'registration and cancelled searches must not load playwright-core')
    await assert.rejects(provider.search(request), /Synthetic browser launch failure/)
    calls = (await import(fixtureURL)).calls
    assert.equal(loads, 1)
    assert.equal(calls.launches, 1)

    const results = await Promise.all([provider.search(request), provider.search(request)])
    assert.ok(results.every(result => result.sources.length === 1))
    assert.equal(calls.launches, 2, 'concurrent retry must share one new browser')
    assert.equal((await provider.search(request)).sources.length, 1)
    assert.equal(calls.launches, 2, 'later searches must reuse the browser')
    assert.equal(loads, 1, 'retries must reuse the loaded module')
  } finally {
    await dispose?.()
    hooks.deregister()
    if (previousBrowser === undefined) delete process.env.DSH_MEDIA_BROWSER
    else process.env.DSH_MEDIA_BROWSER = previousBrowser
  }
  assert.equal(calls.closes, 1, 'disposing the provider must close its browser')
})
