// Opt-in check against a running, isolated product and its real UI primitives.
// EDUWORK_TEST_RUNTIME=.../product/d EDUWORK_DESKTOP_TEST_CDP=http://127.0.0.1:... npm run test:desktop
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const endpoint = new URL(process.env.EDUWORK_DESKTOP_TEST_CDP)
assert.ok(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))
const { chromium } = createRequire(join(process.env.EDUWORK_TEST_RUNTIME, 'package.json'))('playwright-core')
const browser = await chromium.connectOverCDP(endpoint.href)
const page = browser.contexts()[0].pages().find(page => page.url().startsWith('dsh-app://app/'))
assert.ok(page, 'Use the real isolated EduWork desktop, not a panel fixture')
page.setDefaultTimeout(5000)
const cdp = await page.context().newCDPSession(page)
const owned = [], prefix = 'desktop-dialog-' + randomUUID()
async function rpc(method, args = {}) {
  const result = await page.evaluate(async ({ method, args, rpcId }) => {
    const response = await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }) })
    return (await response.json()).result
  }, { method, args, rpcId: randomUUID() })
  assert.equal(result.ok, true, method)
  return result.value
}
try {
  await page.reload()
  await page.getByRole('button', { name: '日历', exact: true }).click()
  for (const [width, height] of [[1280, 720], [1024, 640]]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await page.getByRole('button', { name: '新建日程', exact: true }).click()
    const dialog = page.getByRole('dialog'), title = `${prefix}-${width}`
    await dialog.getByLabel('标题', { exact: true }).fill(title)
    await dialog.getByRole('combobox', { name: '重复', exact: true }).selectOption('custom')
    const save = dialog.getByRole('button', { name: '新建', exact: true })
    const rect = await save.boundingBox()
    assert.ok(rect && rect.y >= 0 && rect.y + rect.height <= height, `Save must remain inside the ${width}x${height} desktop viewport`)
    await save.click()
    await dialog.waitFor({ state: 'hidden' })
    const event = (await rpc('calendar/snapshot')).events.find(event => event.title === title)
    assert.ok(event, 'Actual desktop form must save the recurring event')
    owned.push(event)
    console.log(`PASS ${width}x${height}: recurring form saves through the real product Modal`)
  }
} finally {
  await page.keyboard.press('Escape').catch(() => {})
  for (const event of owned) await rpc('calendar/deleteEvent', { input: { source: event.source, uid: event.uid } })
  await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  await cdp.detach()
  await browser.close()
}
