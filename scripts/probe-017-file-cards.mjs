import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
// Renderer acceptance with a synthetic native-path bridge and no model request.
// Uses an isolated Host/home and applies the candidate presentation adapter to
// the pinned product derivative. Real Electron picker acceptance is separate.
const { values } = parseArgs({ options: { product:{type:'string'}, host:{type:'string'}, browser:{type:'string'}, output:{type:'string'} } })
for (const key of ['product','host','browser','output']) if (!values[key]) throw Error(`Missing --${key}`)
const repo = fileURLToPath(new URL('../', import.meta.url))
const product = resolve(values.product), output = resolve(values.output)
await mkdir(output)
const home = join(output, 'home'), workspace = join(output, 'preview-workspace-web'), config = join(output, 'eduwork.jsonc')
await mkdir(workspace, { recursive: true })
await writeFile(join(workspace, 'preview.txt'), 'Synthetic preview fixture')
await writeFile(config, JSON.stringify({ schemaVersion: 1, product: { name: 'EduWork' } }))
await writeFile(join(output, 'fixture.json'), JSON.stringify({ workspace, title: 'File card acceptance web', filesReady: true, files: ['preview.txt'] }))
execFileSync(process.execPath, [join(repo, 'tests/desktop-preview-fixture.mjs'), product, home, output], { windowsHide: true })
const fixture = JSON.parse(await readFile(join(output, 'fixture.json'), 'utf8'))
const { prepareProductProfile } = await import(pathToFileURL(join(repo, 'dsh-host/product-profile.mjs')))
const { startNativeBridge } = await import(pathToFileURL(join(repo, 'dsh-electron/src/native-vault.mjs')))
const { DesktopHostProcess } = await import(pathToFileURL(join(resolve(values.host), 'host-process.mjs')))
const { chromium } = createRequire(join(product, 'd/package.json'))('playwright-core')
const vault = { async flush() {}, async operation() { return { configured: false, writable: true, source: 'synthetic' } } }
const bridge = await startNativeBridge({ vault, openExternal() { throw Error('Unexpected external navigation') } })
let host, browser, page
const report = { output, checks: [], pageErrors: [] }
try {
  const prepared = await prepareProductProfile({ product, home, shell: 'electron', userConfig: config })
  host = new DesktopHostProcess(process.execPath, join(product, 'd'), prepared.profile, undefined, { ...process.env, ...prepared.environment }, undefined, undefined, undefined, undefined, { bootstrap: bridge.bootstrap, onLog() {} })
  const ready = await host.start()
  browser = await chromium.launch({ executablePath: resolve(values.browser), headless: true })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', e => report.pageErrors.push(e.stack))
  const { adaptNativeFileReferenceUI } = await import(pathToFileURL(join(repo, 'scripts/native-file-reference-ui.mjs')))
  await page.route('**/*', async route => {
    const url = decodeURIComponent(route.request().url())
    if (url.includes('/plugins/') && route.request().resourceType() === 'script') {
      const response = await route.fetch()
      const body = await response.text()
      if (body.includes('function ReferenceChip({ label, appearance, invalid })')) {
        report.replacementURL = new URL(url).pathname
        return route.fulfill({ response, body: adaptNativeFileReferenceUI(body) })
      }
      return route.fulfill({ response, body })
    }
    return route.continue()
  })
  await page.addInitScript(({ workspace }) => {
    window.__DSH_HOST_PATHS__ = { pathFor: file => file.name.startsWith('pasted') ? '' : workspace + '/' + file.name }
  }, { workspace })
  await page.addLocatorHandler(page.getByRole('dialog', { name: '内测声明' }), d => d.getByRole('button', { name: '继续', exact: true }).click())
  await page.addLocatorHandler(page.getByRole('dialog', { name: '添加一个 API Key 开始使用' }), d => d.getByRole('button', { name: '稍后配置', exact: true }).click())
  await page.goto(ready.url)
  const rpc = (method, args) => page.evaluate(async ({ method, args }) => {
    const r = await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) })
    const b = await r.json(); if (!b.result.ok) throw Error(JSON.stringify(b.result.error)); return b.result.value
  }, { method, args })
  const w = await rpc('workspace/create', { request: { path: workspace } })
  await rpc('session/create', { request: { workspaceId: w.workspace.workspaceId, sessionId: fixture.sessionId } })
  await rpc('session/rename', { request: { sessionId: fixture.sessionId, title: fixture.title } })
  await page.reload()
  await page.getByRole('treeitem').getByText(fixture.title, { exact: true }).first().click()
  const editor = page.locator('[data-composer-input]').first()
  await editor.fill('请阅读这些文件 ')
  const files = [
    { name: '研究材料 一个很长的文件名保留中文与空格.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF synthetic fixture') },
    { name: '研究表格.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('synthetic spreadsheet') },
  ]
  await page.locator('input[type=file][multiple]').first().setInputFiles(files)
  const cards = page.locator('[data-eduwork-file-card]')
  await cards.first().waitFor({ timeout: 10000 })
  assert.equal(await cards.count(), 2)
  assert.match(await cards.first().innerText(), /PDF.*22B/s)
  assert.match(await cards.nth(1).innerText(), /XLSX/)
  report.checks.push('PDF/XLSX type icons, full names and byte counts; local reference cards')
  await page.screenshot({ path: join(output, 'cards-light.png') })
  await page.evaluate(() => {
    window.__probeEditor = document.querySelector('[data-composer-input]').__lexicalEditor
  })
  await cards.first().getByRole('button').click()
  assert.equal(await cards.count(), 1)
  await editor.press('Control+z')
  await cards.nth(1).waitFor()
  report.checks.push('Remove one file and undo restores both cards and metadata')
  await page.evaluate(() => window.__probeEditor.setEditable(false))
  assert.equal(await cards.first().getByRole('button').isDisabled(), true)
  await page.evaluate(() => window.__probeEditor.setEditable(true))
  await cards.first().getByRole('button').focus()
  await cards.first().getByRole('button').press('Enter')
  assert.equal(await cards.count(), 1)
  await editor.press('Control+z')
  await cards.nth(1).waitFor()
  report.checks.push('Read-only remove disabled; keyboard remove and undo work')
  await editor.press('Control+a')
  const copied = await editor.evaluate(root => {
    const clipboardData = new DataTransfer()
    root.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles:true, cancelable:true }))
    return clipboardData.getData('text/plain')
  })
  assert.match(copied, /@"研究材料 一个很长的文件名保留中文与空格.pdf"/)
  assert.ok(!copied.includes('22B'))
  report.checks.push('Copy still exports official @path references, without display metadata')
  await editor.press('ArrowRight')
  await page.route('**/api/**', route => {
    if (!route.request().headers()['content-type']?.includes('application/json')) return route.fallback()
    const data = route.request().postDataJSON()
    if (data?.method?.endsWith('/prompt')) {
      report.submitted = data
      return route.abort('failed')
    }
    return route.fallback()
  })
  const submitted = page.waitForRequest(request => request.url().includes('/api/') && request.postData()?.includes('/prompt'), {timeout:10000})
  await page.getByRole('button', {name:'发送消息',exact:true}).click()
  await submitted
  await cards.nth(1).waitFor()
  assert.match(JSON.stringify(report.submitted), /研究材料 一个很长的文件名保留中文与空格.pdf/)
  assert.ok(!JSON.stringify(report.submitted).includes('fileBytes'))
  assert.match(await cards.first().innerText(), /22B/)
  report.checks.push('Send serializes original references only; synthetic transport failure restores file cards with size (no model call)')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: join(output, 'cards-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.setViewportSize({ width: 540, height: 850 })
  await page.screenshot({ path: join(output, 'cards-narrow.png') })
  const bounds = await cards.first().boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 540)
  report.checks.push('Narrow layout with full long filename; no card overflow')
  await page.setViewportSize({ width: 1440, height: 1000 })
  const png = { name:'picture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVrQAAAAASUVORK5CYII=','base64') }
  await page.locator('input[type=file][multiple]').first().setInputFiles(png)
  await page.getByAltText('picture.png', {exact:true}).waitFor()
  assert.equal(await cards.count(), 2)
  report.checks.push('Image selection stays in the official image thumbnail path')
  await page.locator('input[type=file][multiple]').first().setInputFiles({ name:'pasted-document.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF pathless fixture') })
  await page.getByText('pasted-document.pdf', {exact:true}).waitFor()
  report.checks.push('Pathless file still uses the official upload attachment card')
  await page.screenshot({ path: join(output, 'mixed-attachments.png') })
  // Switching sessions must retain the official draft/reference ownership.
  await page.getByRole('button', { name: '新建会话', exact: true }).first().click()
  await page.getByRole('treeitem').getByText(fixture.title, { exact: true }).first().click()
  assert.match(await editor.innerText(), /研究材料 一个很长的文件名保留中文与空格.pdf/)
  report.checks.push('Switch session and return: official persisted draft retains path references; upstream reloads them as editable text references')
  assert.equal(report.pageErrors.length, 0, report.pageErrors.join('\n'))
  report.ok = true
} catch (error) { report.error = error.stack; process.exitCode = 1 }
finally {
  if (page) await page.screenshot({ path: join(output, 'final.png') }).catch(() => {})
  await browser?.close(); await host?.stop(); await bridge.close()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
