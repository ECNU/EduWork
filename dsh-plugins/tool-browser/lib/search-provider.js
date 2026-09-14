import { chromium } from 'playwright-core'
import { browserExecutable, directSearchResultURL, isCiteableSearchResultURL, isSearchResultRelevant, searchURL, webSearchResult } from './core.js'

export const name = 'web-search-browser'
export const inject = ['web']
export const WEB_SEARCH_PROVIDER_ID = 'chatecnu-managed-browser'

async function collectSearch(page, engine, query) {
  const selectors = engine === 'baidu'
    ? ['#results .c-result', '#results .result', '.c-result', '#content_left .result', '#content_left .c-container']
    : ['#b_results > li.b_algo', '#b_results .b_algo']
  await page.waitForSelector(selectors.join(','), { timeout: 5_000 }).catch(() => {})
  // Bing can initially expose stale placeholder rows before replacing them
  // with the requested market's results. Allow that short DOM hand-off to
  // finish, then reject rows that share no meaningful term with the query.
  await page.waitForTimeout(500)
  const results = await page.locator(selectors.join(',')).evaluateAll((elements, currentEngine) => elements.slice(0, 12).map(element => {
    // Search engines often put a breadcrumb/domain link before the result
    // heading. Select the semantic heading explicitly before any other link.
    const anchor = element.querySelector('h2 a') ?? element.querySelector('h3 a') ?? element.querySelector('a[href]')
    const snippet = element.querySelector('.b_caption p, .c-abstract, .content-right_8Zs40, p')
    let directURL = ''
    if (currentEngine === 'baidu') {
      try {
        const metadata = JSON.parse(element.getAttribute('data-log') ?? '{}')
        if (/^https?:/i.test(metadata.mu ?? '')) directURL = metadata.mu
      } catch {}
    }
    return {
      title: anchor?.textContent?.trim() ?? '',
      url: directURL || (anchor instanceof HTMLAnchorElement ? anchor.href : ''),
      snippet: snippet?.textContent?.trim() ?? '',
    }
  }), engine).catch(() => [])
  return results
    .filter(result => result.title && /^https?:/i.test(result.url))
    .map(result => ({ ...result, url: directSearchResultURL(engine, result.url) }))
    .filter(result => isCiteableSearchResultURL(result.url))
    .filter(result => isSearchResultRelevant(query, result))
}

async function search(page, query) {
  const failures = []
  let reachedEngine = false
  for (const engine of ['bing', 'baidu']) {
    try {
      await page.goto(searchURL(engine, query), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      reachedEngine = true
      const results = await collectSearch(page, engine, query)
      if (results.length > 0) return webSearchResult(results)
      failures.push(`${engine}: no structured results`)
    } catch (error) {
      failures.push(`${engine}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (reachedEngine) return webSearchResult([])
  throw new Error(`web search failed (${failures.join('; ')})`)
}

export function createBrowserSearchProvider(ctx) {
  let browserPromise

  async function searchBrowser() {
    if (browserPromise === undefined) {
      browserPromise = chromium.launch({
        executablePath: browserExecutable(),
        headless: true,
        args: ['--disable-component-update', '--no-default-browser-check'],
      }).catch(error => {
        browserPromise = undefined
        throw error
      })
    }
    return browserPromise
  }

  async function providerSearch(request, signal) {
    signal?.throwIfAborted()
    const browser = await searchBrowser()
    signal?.throwIfAborted()
    // DSH's official web_search may execute several queries concurrently. Each
    // request receives its own isolated page so navigation cannot race.
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    const abort = () => { void page.close().catch(() => {}) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const result = await search(page, request.query)
      signal?.throwIfAborted()
      return result
    } finally {
      signal?.removeEventListener('abort', abort)
      await page.close().catch(() => {})
    }
  }

  const provider = {
    id: WEB_SEARCH_PROVIDER_ID,
    available() {
      try { browserExecutable(); return true } catch { return false }
    },
    search: providerSearch,
  }

  ctx.effect(() => () => {
    return browserPromise?.then(browser => browser.close()).catch(() => {})
  })
  return provider
}

export function apply(ctx) { ctx.web.registerSearchProvider(createBrowserSearchProvider(ctx)) }
