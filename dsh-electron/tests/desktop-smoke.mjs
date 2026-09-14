import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { product: { type: 'string' }, cdp: { type: 'string' }, evidence: { type: 'string' }, 'data-root': { type: 'string' }, 'launch-only': { type: 'boolean', default: false }, shell: { type: 'string', default: 'electron' } } })
if (!values.product || !values.cdp || !values.evidence) throw new Error('Use --product <product> --cdp <loopback address> --evidence <ignored directory>')
const url = new URL(values.cdp)
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname))
const product = resolve(values.product), evidence = resolve(values.evidence)
const identity = JSON.parse(await readFile(join(product, 'assembly.json'), 'utf8'))
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
let sequence = 0
const rpc = (method, args = {}) => page.evaluate(async ({ method, args, id }) => {
  const response = await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload: { args } }) })
  const envelope = await response.json()
  if (!response.ok || !envelope.result?.ok) throw new Error(method + ' failed: ' + JSON.stringify(envelope.result))
  return envelope.result.value
}, { method, args, id: 'desktop-smoke-' + (++sequence) })
try {
  await page.reload({ waitUntil: 'domcontentloaded' })
  if (!values['launch-only']) {
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).waitFor()
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
    if (!values['launch-only']) await page.getByRole('button', { name: /^(新建会话|New session)$/i }).first().waitFor()
    await page.waitForFunction(() => document.body.innerText.trim().length > 0)
    // The official document title exists before the branding plugin mounts.
    await page.waitForFunction(expected => document.title === expected, identity.brand.product.name)
    assert.equal(await page.title(), identity.brand.product.name)
    const transport = await page.evaluate(() => ({ ownsHost: globalThis.__DSH_TRANSPORT__?.ownsHost,
      scheme: location.protocol, nodeExposed: typeof globalThis.require !== 'undefined' || typeof globalThis.process !== 'undefined' }))
    assert.equal(transport.ownsHost, true); assert.equal(transport.scheme, values.shell === 'electron' ? 'dsh-app:' : 'http:'); assert.equal(transport.nodeExposed, false)
    return transport
  })
  await check('settings-over-official-pipe', async () => {
    const result = await rpc('settings/describe')
    assert.ok(result.namespaces.some(row => row.ns === 'chatecnu-brand'))
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
  }
  await page.screenshot({ path: join(evidence, 'desktop.png') })
  assert.deepEqual(errors, [])
} catch (error) {
  process.exitCode = 1
  checks.push({ name: 'desktop-browser', passed: false, error: error.message })
  console.error('Desktop browser acceptance: ' + error.message)
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
