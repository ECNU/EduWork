import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixture = `
globalThis.__eduworkPlaywrightModuleLoads = (globalThis.__eduworkPlaywrightModuleLoads ?? 0) + 1
export const chromium = {
  async launch() {
    globalThis.__eduworkPlaywrightLaunches = (globalThis.__eduworkPlaywrightLaunches ?? 0) + 1
    const page = {
      async goto() {},
      async waitForSelector() {},
      async waitForTimeout() {},
      locator() {
        return {
          async evaluateAll() {
            return [{ title: 'Example query result', url: 'https://example.org/result', snippet: 'Example query result' }]
          },
        }
      },
      async close() {},
      isClosed() { return false },
    }
    return { async newPage() { return page }, async close() {} }
  },
}
`

test('web search imports playwright-core on first use and reuses the browser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-playwright-fixture-'))
  const fixturePath = join(directory, 'playwright-core.mjs')
  await writeFile(fixturePath, fixture)
  const previousBrowser = process.env.DSH_MEDIA_BROWSER
  process.env.DSH_MEDIA_BROWSER = process.execPath
  globalThis.__eduworkPlaywrightModuleLoads = 0
  globalThis.__eduworkPlaywrightLaunches = 0
  let dispose
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'playwright-core'
        ? { url: pathToFileURL(fixturePath).href, shortCircuit: true }
        : nextResolve(specifier, context)
    },
  })
  try {
    const { createBrowserSearchProvider } = await import('../lib/search-provider.js')
    const provider = createBrowserSearchProvider({ effect: setup => { dispose = setup(); return dispose } })
    assert.equal(globalThis.__eduworkPlaywrightModuleLoads, 0, 'playwright-core must not load at import time')

    const signal = new AbortController().signal
    const first = await provider.search({ query: 'example query' }, signal)
    assert.equal(globalThis.__eduworkPlaywrightModuleLoads, 1, 'first search must load playwright-core once')
    assert.equal(globalThis.__eduworkPlaywrightLaunches, 1, 'first search must launch one browser')
    assert.ok(first.sources.length > 0, 'first search must return the fixture result')

    const second = await provider.search({ query: 'example query' }, signal)
    assert.equal(globalThis.__eduworkPlaywrightModuleLoads, 1, 'second search must reuse the loaded module')
    assert.equal(globalThis.__eduworkPlaywrightLaunches, 1, 'second search must reuse the browser')
    assert.ok(second.sources.length > 0, 'second search must return the fixture result')
  } finally {
    await dispose?.()
    hooks.deregister()
    if (previousBrowser === undefined) delete process.env.DSH_MEDIA_BROWSER
    else process.env.DSH_MEDIA_BROWSER = previousBrowser
    await rm(directory, { recursive: true, force: true })
    delete globalThis.__eduworkPlaywrightModuleLoads
    delete globalThis.__eduworkPlaywrightLaunches
  }
})
