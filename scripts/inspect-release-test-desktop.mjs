import { createRequire } from 'node:module'
import { join } from 'node:path'

// Synthetic CI profiles only. Inspect the startup/error page when the normal
// application protocol never became ready; do not change the running desktop.
const endpoint = new URL(process.argv[3])
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw Error('Only a loopback test desktop may be inspected')
const { chromium } = createRequire(join(process.argv[2], 'd/package.json'))('playwright-core')
const browser = await chromium.connectOverCDP(endpoint.href, { timeout: 5000 })
try {
  for (const page of browser.contexts().flatMap(context => context.pages())) {
    console.log(JSON.stringify({ title: await page.title(), scheme: new URL(page.url()).protocol,
      text: (await page.locator('body').innerText({ timeout: 5000 })).slice(0, 6000) }))
  }
} finally { await browser.close() }
