import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { callbackPage } from '../lib/callback-page.js'

// Run from the same isolated, coherent DSH runtime as npm run check.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright-core')
const assets = new Map([
  ['/react.js', await readFile(join(dirname(require.resolve('react/package.json')), 'umd/react.development.js'))],
  ['/react-dom.js', await readFile(join(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'))],
  ['/fixture.js', await readFile(new URL('../test/helpers/account-menu-browser.js', import.meta.url))],
  ['/client.js', await readFile(new URL('../lib/client.js', import.meta.url))],
])
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (path.startsWith('/callback-')) {
    const result = callbackPage({ displayName: '示例大学', brand: { productName: 'EduWork', organizationName: '示例大学', mark: 'E', primaryColor: '#4f5fd7' } }, path.endsWith('success') ? 'completed' : 'failed', 'zh-CN')
    response.writeHead(200, result.headers); response.end(result.html); return
  }
  if (assets.has(path)) { response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(assets.get(path)); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body style="font-family:system-ui"><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/fixture.js"></script><script src="/client.js"></script></body></html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ channel: process.env.DSH_OIDC_BROWSER_CHANNEL || 'msedge', headless: true })
const output = new URL('../browser-evidence/', import.meta.url)
await mkdir(output, { recursive: true })
const checks = [], errors = []
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 960, height: 760 } })
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
page.setDefaultTimeout(10000)
const origin = `http://127.0.0.1:${server.address().port}`
const trigger = page.getByRole('button', { name: /账户菜单/ })
const menu = page.getByRole('menu', { name: '账户菜单' })
const focusText = () => page.evaluate(() => document.activeElement?.textContent)
const waitClosed = () => menu.waitFor({ state: 'hidden' })
try {
  await page.goto(origin)
  await trigger.waitFor()
  const mark = trigger.locator('span[aria-hidden="true"]').first()
  // DSH's brand-primary is foreground ink, not its blue/red accent.
  await page.evaluate(() => document.documentElement.style.setProperty('--dsw-alias-brand-primary', '#0f1115'))
  for (const [color, expected] of [['#4d6bfe', 'rgb(77, 107, 254)'], ['#9f2636', 'rgb(159, 38, 54)'], ['#e57482', 'rgb(229, 116, 130)']]) {
    await page.evaluate(value => document.documentElement.style.setProperty('--dsw-alias-brand-primary-new-colorprimary-new-color', value), color)
    assert.equal(await mark.evaluate(node => getComputedStyle(node).backgroundColor), expected)
  }
  checks.push('account mark follows blue/red/dark accent changes without reload')
  await trigger.click()
  await menu.getByRole('menuitem', { name: '刷新账户' }).waitFor()
  assert.doesNotMatch(await menu.innerText(), /配额|额度|资源包/)
  assert.equal(await page.evaluate(() => window.fixture.modelReads()), 0)
  assert.equal(await menu.evaluate(node => node.parentElement === document.body), true)
  checks.push('public avatar opens identity actions without quota requests or fields')
  await page.keyboard.press('End'); assert.equal(await focusText(), '退出登录')
  await page.keyboard.press('Home'); assert.equal(await focusText(), '刷新账户')
  await page.keyboard.press('ArrowDown'); assert.equal(await focusText(), '退出登录')
  await page.keyboard.press('ArrowDown'); assert.equal(await focusText(), '刷新账户')
  await page.keyboard.press('Escape'); await waitClosed()
  assert.equal(await trigger.evaluate(node => document.activeElement === node), true)
  await trigger.press('ArrowUp'); await menu.waitFor(); assert.equal(await focusText(), '退出登录')
  await page.keyboard.press('Escape'); await waitClosed()
  await trigger.press('ArrowDown'); await menu.waitFor(); assert.equal(await focusText(), '刷新账户')
  checks.push('arrows, Home/End, Escape and focus restoration')
  await page.locator('#outside').focus(); await waitClosed()
  await trigger.click(); await menu.waitFor(); await page.locator('#outside').click(); await waitClosed()
  checks.push('outside focus and click dismiss the menu')
  await page.evaluate(() => window.fixture.render(false))
  await trigger.click(); await menu.waitFor()
  const anchor = await trigger.boundingBox(), bounds = await menu.boundingBox()
  assert.equal(anchor.width, 36); assert.ok(bounds.width > 240 && bounds.x >= 0 && bounds.y >= 0)
  await menu.getByRole('menuitem', { name: '刷新账户', exact: true }).click()
  assert.equal(await page.evaluate(() => window.fixture.modelReads()), 0)
  await page.screenshot({ path: fileURLToPath(new URL('account-menu.png', output)) })
  checks.push('collapsed sidebar and public refresh remain usable without resource reads')
  await menu.getByRole('menuitem', { name: '退出登录', exact: true }).click(); await waitClosed()
  await page.locator('#general').getByRole('button', { name: '使用企业账号登录', exact: true }).waitFor()
  assert.equal(await page.locator('#general').getByText('Synthetic user', { exact: true }).count(), 0)
  await trigger.click(); await menu.getByRole('menuitem', { name: '登录账户' }).waitFor()
  assert.equal(await menu.getByText('模型配额', { exact: true }).count(), 0)
  checks.push('sign-out synchronizes footer and settings')
  await page.keyboard.press('Escape'); await waitClosed()
  for (const custom of [false, true]) {
    await page.goto(origin + '/?onboarding=1' + (custom ? '&customLogin=1' : ''))
    const dialog = page.getByRole('dialog')
    const label = custom ? '统一认证登录' : '使用企业账号登录'
    await dialog.getByRole('button', { name: label, exact: true }).waitFor()
    await dialog.getByRole('heading', { name: custom ? '示例大学统一身份认证' : '连接企业模型', exact: true }).waitFor()
    if (custom) await dialog.getByText('使用学校账号连接校内服务。', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: '使用其他模型', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.locator('#general').getByRole('button', { name: label, exact: true }).waitFor()
    await trigger.click()
    await menu.getByRole('menuitem', { name: custom ? label : '登录账户', exact: true }).waitFor()
    await page.keyboard.press('Escape'); await waitClosed()
  }
  checks.push('custom and default login wording is consistent across onboarding, settings and account menu; other models stay available')
  for (const outcome of ['success', 'failure']) {
    await page.goto(`${origin}/callback-${outcome}`)
    await page.getByRole('heading', { name: outcome === 'success' ? '身份认证已完成' : '此次登录未完成' }).waitFor()
    assert.ok(await page.locator('.card').evaluate(node => node.getBoundingClientRect().width <= window.innerWidth))
    await page.screenshot({ path: fileURLToPath(new URL(`callback-${outcome}.png`, output)) })
  }
  checks.push('branded success and failure callback pages render with system fonts')
  assert.deepEqual(errors, [])
  await writeFile(new URL('result.json', output), JSON.stringify({ passed: true, checks, errors }, null, 2) + '\n')
  console.log(`${checks.length} compiled browser menu/callback checks passed.`)
} catch (error) {
  await writeFile(new URL('result.json', output), JSON.stringify({ passed: false, checks, errors, failure: error.message }, null, 2) + '\n')
  throw error
} finally { await browser.close(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
