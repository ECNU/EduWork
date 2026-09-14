import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import path from 'node:path'

const [bootstrapURL, screenshotPath] = process.argv.slice(2)
assert.ok(bootstrapURL?.startsWith('http://127.0.0.1:'), 'a loopback DSH bootstrap URL is required')

assert.ok(screenshotPath, 'a screenshot output path is required')

const browser = await chromium.launch({ ...(process.env.MEMORY_BROWSER_CHANNEL ? { channel: process.env.MEMORY_BROWSER_CHANNEL } : {}), headless: true })
let page

try {
  page = await browser.newPage({ viewport: { width: 1360, height: 860 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error?.stack || error?.message || error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto(bootstrapURL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForTimeout(4_000)

  const continueButton = page.getByRole('button', { name: /^(继续|Continue)$/ }).last()
  if (await continueButton.isVisible().catch(() => false)) {
    await continueButton.click()
    await page.waitForTimeout(500)
  }
  const postpone = page.getByRole('button', { name: /^(稍后配置|Configure later|Maybe later)$/ }).last()
  if (await postpone.isVisible().catch(() => false)) await postpone.click()
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.getByRole('dialog').last()
    if (!await dialog.isVisible().catch(() => false)) break
    const buttons = dialog.getByRole('button')
    if (await buttons.count() === 0) break
    await buttons.last().click()
    await page.waitForTimeout(300)
  }
  await page.keyboard.press('Escape')

  const settings = page.getByText(/^(设置|Settings)$/).last()
  await settings.waitFor({ state: 'visible', timeout: 15_000 })
  await settings.click()
  const personalization = page.getByText(/^(个性化|Personalization)$/).last()
  await personalization.waitFor({ state: 'visible', timeout: 10_000 })
  await personalization.click()

  const memory = page.getByRole('switch', { name: /^(启用本地 Memory|Enable local memories)$/ })
  const history = page.getByRole('switch', { name: /^(允许检索过往对话|Reference prior chats)$/ })
  const external = page.getByRole('switch', { name: /^(允许从使用工具的聊天生成 Memory|Allow local memory generation from tool-assisted chats)$/ })
  await memory.waitFor({ state: 'visible', timeout: 10_000 })
  await history.waitFor({ state: 'visible', timeout: 10_000 })
  assert.equal(await memory.getAttribute('aria-checked'), 'true', 'Memory must be enabled by default')
  assert.equal(await history.getAttribute('aria-checked'), 'true', 'prior-chat retrieval must be enabled by default')
  assert.equal(await external.getAttribute('aria-checked'), 'false', 'tool-assisted automatic generation remains opt-in')

  const originalMemory = '独立验收: 用户偏好简洁中文答复'
  const correctedMemory = '独立验收: 用户偏好自然简洁的中文答复'
  const paginationMemories = Array.from({ length: 30 }, (_, index) => ({
    content: `page-item-${String(index).padStart(2, '0')}-7f1c6a9b${index.toString(16).padStart(2, '0')}`,
    kind: 'note', tags: ['pagination-acceptance'], scope: 'user', importance: 1,
    sources: [{ kind: 'manual', label: 'standalone Web pagination acceptance' }],
  }))
  await page.getByRole('dialog', { name: /^(设置|Settings)$/ }).locator('input[type="file"][accept="application/json,.json"]').setInputFiles({
    name: 'memory-acceptance.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      format: 'dsh-local-memory', version: 2,
      records: [{
        content: originalMemory, kind: 'preference', tags: ['acceptance'], scope: 'user', importance: 2,
        sources: [{ kind: 'manual', label: 'standalone Web acceptance' }],
      }, ...paginationMemories],
    })),
  })
  await page.getByText(/已导入 31 条|Imported 31/).waitFor({ state: 'visible', timeout: 20_000 })

  const manage = page.getByRole('button', { name: /^(管理 Memory|Manage memories)$/ })
  await manage.click()
  const memorySearch = page.getByRole('searchbox', { name: /^(搜索 Memory|Search memories)$/ })
  await memorySearch.waitFor({ state: 'visible', timeout: 20_000 })
  const memoryDialog = page.getByRole('dialog', { name: /^(目前记住的内容|What DSH remembers)$/ })
  await memoryDialog.getByText(/第 1 \/ 4 页，共 31 条|Page 1 of 4, 31 total/).waitFor({ state: 'visible', timeout: 20_000 })
  assert.equal(await memoryDialog.locator('article').count(), 10, 'the manager must render only one ten-record page')
  await memoryDialog.getByRole('button', { name: /^(下一页|Next)$/ }).click()
  await memoryDialog.getByText(/第 2 \/ 4 页，共 31 条|Page 2 of 4, 31 total/).waitFor({ state: 'visible', timeout: 20_000 })
  assert.equal(await memoryDialog.locator('article').count(), 10, 'the second page must stay bounded to ten records')
  await memorySearch.fill(originalMemory)
  await memoryDialog.getByText(/第 1 \/ 1 页，共 1 条|Page 1 of 1, 1 total/).waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByText(originalMemory, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })

  let card = page.getByText(originalMemory, { exact: true }).locator('xpath=ancestor::article')
  await card.getByRole('button', { name: /^(保留|Retain)$/ }).click()
  await card.getByText(/^(用户已保留|Retained by user)$/).waitFor({ state: 'visible', timeout: 20_000 })
  await card.getByRole('button', { name: /^(取消保留|Stop retaining)$/ }).waitFor({ state: 'visible', timeout: 20_000 })
  card = page.getByText(originalMemory, { exact: true }).locator('xpath=ancestor::article')
  await card.getByRole('button', { name: /^(修改|Edit)$/ }).click()
  const editor = card.getByRole('textbox', { name: /^(修改|Edit)$/ })
  await editor.fill(correctedMemory)
  await page.getByRole('button', { name: /^(保存修改|Save changes)$/ }).click()
  await page.getByText(correctedMemory, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
  card = page.getByText(correctedMemory, { exact: true }).locator('xpath=ancestor::article')
  await card.getByRole('button', { name: /^(撤销上次修改|Undo last edit)$/ }).click()
  await page.getByText(originalMemory, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })

  card = page.getByText(originalMemory, { exact: true }).locator('xpath=ancestor::article')
  await card.getByRole('button', { name: /^(删除|Delete)$/ }).click()
  await page.getByText(/^(没有匹配的 Memory。|No matching memories\.)$/).waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByRole('button', { name: /^(撤销|Undo)$/ }).click()
  await page.getByText(originalMemory, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })

  card = page.getByText(originalMemory, { exact: true }).locator('xpath=ancestor::article')
  await card.getByRole('button', { name: /^(遗忘且不再自动记住|Forget and prevent relearning)$/ }).click()
  await card.getByRole('button', { name: /^(确认遗忘|Confirm forget)$/ }).click()
  await page.getByText(/另有 1 条遗忘标记|plus 1 forget marker/).waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByRole('button', { name: /^(撤销|Undo)$/ }).click()
  await page.getByText(originalMemory, { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })

  await memorySearch.fill('')
  await memoryDialog.getByText(/第 1 \/ 4 页，共 31 条|Page 1 of 4, 31 total/).waitFor({ state: 'visible', timeout: 20_000 })
  assert.equal(await memoryDialog.locator('article').count(), 10, 'the restored unfiltered manager must remain page-bounded')
  await page.getByText(originalMemory, { exact: true }).locator('xpath=ancestor::article').getByText(/^(用户已保留|Retained by user)$/).waitFor({ state: 'visible', timeout: 20_000 })

  const body = await page.locator('body').innerText()
  assert.match(body, /Memory 仅保存在这台设备上|Memory stays on this device/)
  assert.match(body, /不会把全部历史对话注入当前上下文|Full history is never injected wholesale/)
  assert.match(body, /目前记住的内容|What DSH remembers/)
  assert.match(body, /来源仅供追溯，不能在这里修改|Sources are read-only evidence/)
  assert.doesNotMatch(body, /Failed to load plugins/i)
  assert.deepEqual(errors, [], `DSH Memory Web emitted browser errors:\n${errors.join('\n')}`)
  console.log('Standalone DSH Memory Web visual smoke passed.')
} finally {
  if (page) {
    await mkdir(path.dirname(path.resolve(screenshotPath)), { recursive: true })
    await page.screenshot({ path: path.resolve(screenshotPath), fullPage: true }).catch(() => {})
  }
  await browser.close()
}
