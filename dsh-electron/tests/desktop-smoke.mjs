import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { product: { type: 'string' }, cdp: { type: 'string' }, evidence: { type: 'string' }, 'data-root': { type: 'string' }, 'launch-only': { type: 'boolean', default: false }, shell: { type: 'string', default: 'electron' } } })
if (!values.product || !values.cdp || !values.evidence) throw new Error('Use --product <product> --cdp <loopback address> --evidence <ignored directory>')
const url = new URL(values.cdp)
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
const product = resolve(values.product), evidence = resolve(values.evidence)
const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
const composition = JSON.parse(await readFile(join(product, 'composition.json'), 'utf8'))
const sidebarBrowser = composition.flatMap(row => row.insert ?? []).find(entry => entry.name === '@eduwork/dsh-browser-upstream')
assert.ok(['electron', 'wails'].includes(values.shell))
await mkdir(evidence, { recursive: true })
const { chromium } = createRequire(join(product, 'd/package.json'))('playwright-core')
const browser = await chromium.connectOverCDP(values.cdp)
const page = browser.contexts().flatMap(context => context.pages()).find(page => values.shell === 'electron' ? page.url().startsWith('dsh-app://app/') : page.url().startsWith('http://wails.localhost/'))
assert.ok(page, 'Desktop application page is present')
const checks = [], errors = []
page.on('pageerror', error => errors.push(error.message))
page.setDefaultTimeout(20_000)
const check = async (name, callback) => { const result = await callback(); checks.push({ name, passed: true, result }) }
let phase = 'load', expectedTitle
const waitForTitle = async (name, expected) => {
  phase = name; expectedTitle = expected
  await page.waitForFunction(expected => document.title === expected, expected)
}
let sequence = 0
const rpc = (method, args = {}) => page.evaluate(async ({ method, args, id }) => {
  const response = await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload: { args } }) })
  const envelope = await response.json()
  if (!response.ok || !envelope.result?.ok) throw new Error(method + ' failed: ' + JSON.stringify(envelope.result))
  return envelope.result.value
}, { method, args, id: 'desktop-smoke-' + (++sequence) })
try {
  // The release runner has just launched this isolated app. Reloading while
  // its preload is still requesting the Host can destroy the IPC sender frame.
  await page.waitForLoadState('domcontentloaded')
  if (!values['launch-only']) {
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).waitFor()
  // The user guide's first-run tour can cover the window at any moment.
  await page.addLocatorHandler(page.locator('#eduwork-user-guide-tour'), tour => tour.getByRole('button', { name: /^(跳过|Skip)$/ }).click())
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const name of [/^(继续|Continue)$/, /^(稍后配置|Configure later|Maybe later)$/, /^(使用其他模型|Use another model)$/]) {
      const button = page.getByRole('button', { name }).last()
      if (await button.isVisible()) await button.click()
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  }
  await check('official-protocol-brand-and-renderer', async () => {
    // The official narrow sidebar keeps the button but omits its text label.
    // Loading text and the product title can both precede the actual app frame.
    phase = 'renderer-ready'
    await page.getByRole('button', { name: /^(新建会话|New session)$/i }).first().waitFor()
    // The official document title exists before the branding plugin mounts.
    await waitForTitle('initial-product-title', identity.brand.product.name)
    // Navigation can reset either the bare title or a session-qualified title.
    // Exercise the mounted plugin, rather than accepting a transient brand.
    const titles = []
    for (const [title, expected] of [
      ['Synthetic session — DeepSeek Harness', 'Synthetic session — ' + identity.brand.product.name],
      ['DeepSeek Harness', identity.brand.product.name],
    ]) {
      phase = 'navigation-title: ' + title; expectedTitle = expected
      // The branding MutationObserver runs in this microtask checkpoint. Read
      // its projection in the same evaluation: a later React navigation effect
      // may legitimately restore the title of the real (non-synthetic) session
      // before a separate CDP request or requestAnimationFrame poll sees it.
      const observed = await page.evaluate(async title => {
        document.title = title
        await Promise.resolve()
        return document.title
      }, title)
      titles.push({ input: title, expected, observed })
      assert.equal(observed, expected, phase)
    }
    assert.equal(await page.title(), identity.brand.product.name)
    const transport = await page.evaluate(() => ({ ownsHost: globalThis.__DSH_TRANSPORT__?.ownsHost,
      scheme: location.protocol, nodeExposed: typeof globalThis.require !== 'undefined' || typeof globalThis.process !== 'undefined' }))
    assert.equal(transport.ownsHost, true); assert.equal(transport.scheme, values.shell === 'electron' ? 'dsh-app:' : 'http:'); assert.equal(transport.nodeExposed, false)
    return { ...transport, titles }
  })
  await check('settings-over-official-pipe', async () => {
    const result = await rpc('settings/describe')
    assert.ok(result.namespaces.some(row => row.ns === 'chatecnu-brand'))
    // Settings list a plugin only once it runs; the browser's has its own row rather than a generated form.
    const entry = sidebarBrowser && result.namespaces.find(row => row.ns === sidebarBrowser.id)
    if (sidebarBrowser) assert.ok(['desktop', 'sidebar'].includes(entry?.value.sidebarWidth) && entry.autoGenerate === false, 'Sidebar browser plugin is active')
    if (sidebarBrowser) assert.equal(entry.base.sidebarWidth, 'sidebar', 'Sidebar pages follow the Sidebar unless the user chose otherwise')
    return { namespaces: result.namespaces.map(row => row.ns) }
  })
  if (!values['launch-only']) {
  await check('isolated-native-credentials', async () => {
    const ref = 'EDUWORK_DESKTOP_SYNTHETIC_VAULT_CHECK'
    try {
      await rpc('credentials/set', { ref, value: 'synthetic-desktop-vault-fixture' })
      const result = await rpc('credentials/describe', { refs: [ref] })
      assert.equal(result[ref].configured, true)
      if (values.shell === 'electron') {
        assert.equal(result[ref].source, 'os-encrypted-vault')
        const dataRoot = values['data-root'] ? resolve(values['data-root']) : resolve(product, '../../data/' + identity.distribution + '-electron')
        const bytes = await readFile(join(dataRoot, 'browser/credentials.encrypted'))
        assert.equal(bytes.includes(Buffer.from('synthetic-desktop-vault-fixture')), false)
        return { configured: true, source: result[ref].source, plaintextAbsent: true }
      }
      assert.match(result[ref].source, /native|credential|vault/i)
      return { configured: true, source: result[ref].source }
    } finally { await rpc('credentials/unset', { ref }) }
  })
  await check('startup-studio-policy', async () => {
    assert.equal(await page.getByText(/^(最近成果|Recent artifacts|Recent results)$/).count(), 0)
    assert.equal(await page.getByText(/^(工作区 Wiki|Workspace Wiki)$/).count(), 0)
    return { defaultCollapsed: true, wikiAbsent: true }
  })
  if (values.shell === 'electron' && sidebarBrowser) await check('sidebar-page-at-desktop-width', async () => {
    // A page whose button shows only when it lays out at desktop width, past the Sidebar's width; it counts the clicks on it.
    const site = createServer((_request, response) => response.end('<!doctype html><body style="margin:0"><script>window.widths = [innerWidth]; addEventListener("resize", () => widths.push(innerWidth)); window.clicks = 0</script>'
      + '<button id="go" style="position:absolute;left:1100px;top:40px;width:120px;height:40px" onclick="clicks++">go</button>'))
    await new Promise(resolve => site.listen(0, '127.0.0.1', resolve))
    const address = `http://127.0.0.1:${site.address().port}/`
    const until = async (found, what) => {
      for (const deadline = Date.now() + 20_000; Date.now() < deadline; await new Promise(resolve => setTimeout(resolve, 250))) {
        const value = await found()
        if (value) return value
      }
      throw new Error('Timed out waiting for ' + what)
    }
    // The user's choice in Settings → General, once the Host has it.
    const choose = async (option, value) => {
      await page.getByRole('button', { name: /^(设置|Settings)$/ }).first().click()
      await page.getByText(/^(侧边栏网页宽度|Sidebar page width)$/).locator('xpath=ancestor::*[.//button][1]').getByRole('button').click()
      await page.getByRole('menuitem', { name: option }).click()
      await until(async () => (await rpc('settings/describe')).namespaces.find(row => row.ns === sidebarBrowser.id).value.sidebarWidth === value, 'the chosen width')
      await page.keyboard.press('Escape')
    }
    // The page's guest element and its tab in the application page, and the page's own layout once it has
    // its size, which Chromium may give a new document only after its first script: first is the first width it saw.
    const shown = () => page.evaluate(async address => {
      const opened = frame => { try { return frame.checkVisibility() && frame.getURL().startsWith(address) } catch { return false } }
      const frame = [...document.querySelectorAll('webview[data-sidebar-browser-frame]')].find(opened)
      const layout = await frame?.executeJavaScript('document.readyState === "complete" && innerWidth > 0 && (r => ({ first: [...widths, innerWidth].find(Boolean), width: innerWidth, button: [r.x, r.y, r.width, r.height], clicks }))(go.getBoundingClientRect())').catch(() => false)
      if (!layout) return null
      const box = element => (r => ({ x: r.x, y: r.y, width: r.width, height: r.height }))(element.getBoundingClientRect())
      return { ...layout, element: box(frame), elementWidth: frame.offsetWidth, tab: box(frame.parentElement) }
    }, address)
    const covers = now => ['x', 'y', 'width', 'height'].every(side => Math.abs(now.element[side] - now.tab[side]) < 1)
    // The user's click on the scaled-down button, repeated while a page just shown takes no input yet.
    // A click at a point skips the tour's handler, which a locator's wait runs first.
    const click = () => until(async () => {
      await page.locator('body').waitFor()
      const now = await shown(), scale = now.element.width / 1280, [x, y, width, height] = now.button
      await page.mouse.click(now.element.x + (x + width / 2) * scale, now.element.y + (y + height / 2) * scale)
      return (await shown()).clicks > now.clicks
    }, 'the click on the page')
    try {
      await choose(/^(桌面宽度|Desktop width)$/, 'desktop')
      await page.getByRole('button', { name: /^(新建会话|New session)$/i }).first().click()
      // The new session's Sidebar shows collapsed, or open on its guide.
      const column = page.locator('[data-rightbar-col]'), expand = page.locator('[data-sidebar-right-expand]').first()
      const browserEntry = column.locator('[data-sidebar-right-guide-entry="browser"]:visible').first()
      await expand.or(browserEntry).first().waitFor()
      if (await expand.isVisible()) await expand.click()
      await browserEntry.click()
      const field = column.getByRole('textbox', { name: /^(输入 HTTP\(S\) 地址|Enter an HTTP\(S\) address)$/ }).filter({ visible: true }).first()
      await field.fill(address); await field.press('Enter')
      const opened = await until(shown, 'the Sidebar page')
      assert.ok(opened.tab.width < 1280, 'The Sidebar is narrower than a desktop page')
      assert.deepEqual([opened.first, opened.width, opened.elementWidth, covers(opened)], [1280, 1280, 1280, true])
      await click()
      // Switched in Settings, the same page follows the Sidebar's width, then lays out at desktop width again, without reloading.
      await choose(/^(跟随侧边栏|Follow the Sidebar)$/, 'sidebar')
      const following = await until(async () => { const now = await shown(); return now && Math.abs(now.width - now.tab.width) < 1 && covers(now) && now }, 'the page at the Sidebar\'s width')
      await choose(/^(桌面宽度|Desktop width)$/, 'desktop')
      const desktop = await until(async () => { const now = await shown(); return now?.width === 1280 && covers(now) && now }, 'the page at desktop width again')
      assert.deepEqual([following.first, following.clicks, desktop.first, desktop.clicks], [1280, 1, 1280, 1], 'The page stays loaded')
      await click()
      return { tab: opened.tab, following: following.width, scale: desktop.element.width / 1280 }
    } finally { site.closeAllConnections(); site.close() }
  })
  }
  await page.screenshot({ path: join(evidence, 'desktop.png') })
  assert.deepEqual(errors, [])
} catch (error) {
  process.exitCode = 1
  checks.push({ name: 'desktop-browser', passed: false, phase, expectedTitle, observedTitle: await page.title().catch(() => null), error: error.message, stack: error.stack })
  console.error('Desktop browser acceptance: ' + JSON.stringify(checks.at(-1)))
  await page.screenshot({ path: join(evidence, 'failed-desktop.png') }).catch(() => {})
  await (async () => writeFile(join(evidence, 'failed-desktop-ui.json'), JSON.stringify({
    title: await page.title(), viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
    buttons: await page.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') || node.textContent)),
  }, null, 2)))().catch(() => {})
}
finally {
  await writeFile(join(evidence, 'result.json'), JSON.stringify({ passed: checks.every(row => row.passed), scope: values['launch-only'] ? 'launch-only' : 'full-desktop', checks, errors, dshVersion: identity.dshVersion }, null, 2) + '\n')
  await browser.close()
  console.log(JSON.stringify({ passed: checks.every(row => row.passed), checks: checks.length, evidence }))
}
