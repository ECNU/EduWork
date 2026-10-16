// Manual assembled-host regression. Use only an isolated synthetic workspace
// with a saved Session whose visible attachments include a one-page DOCX/PPTX.
// fixture.json: { "workspace": "...", "title": "...", "files": ["report.docx", "slides.pptx"] }
// The private launch URL stays in a file and is never included in the report.
// node tests/official-preview-resize.mjs --runtime <pinned-runtime>
//   --browser <chromium> --launch-file <private-url-file> --fixture <fixture.json>
//   --output <new-directory>
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const keys = ['runtime', 'browser', 'launch-file', 'fixture', 'output']
const { values } = parseArgs({ options: Object.fromEntries(keys.map(key => [key, { type: 'string' }])) })
for (const key of keys) assert.ok(values[key], `--${key} is required`)
const output = resolve(values.output), fixture = JSON.parse(await readFile(resolve(values.fixture), 'utf8'))
const files = fixture.files.filter(file => /\.(docx|pptx)$/i.test(file))
assert.ok(fixture.workspace && fixture.title && files.length, 'Use a synthetic Session with Office attachments')
await mkdir(output)
const { chromium } = createRequire(join(resolve(values.runtime), 'package.json'))('playwright-core')
// Playwright otherwise hides scrollbars in headless mode, masking this bug.
const browser = await chromium.launch({ executablePath: resolve(values.browser), headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
const results = [], errors = []
try {
  for (const dpr of [1, 1.25, 1.5, 2]) {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => errors.push({ dpr, message: error.message }))
    await page.goto((await readFile(resolve(values['launch-file']), 'utf8')).trim())
    for (const name of ['继续', '稍后配置']) {
      const button = page.getByRole('button', { name, exact: true })
      try { await button.waitFor({ timeout: 2500 }); await button.click() } catch {}
    }
    const row = page.getByRole('treeitem').filter({ has: page.getByText(basename(fixture.workspace), { exact: true }) }).first()
    await row.waitFor()
    const target = page.getByRole('treeitem').getByText(fixture.title, { exact: true })
    for (let attempt = 0; attempt < 3 && !await target.isVisible(); attempt++) {
      await row.hover()
      if (await row.getAttribute('aria-expanded') === 'false') await row.locator('span[class*="_chevron"]').click()
      await page.waitForTimeout(200)
    }
    await target.click()
    for (const file of files) {
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.getByText(file, { exact: true }).filter({ visible: true }).first().click()
      await page.locator('[data-pdf-preview]:visible canvas').first().waitFor({ timeout: 60000 })
      await page.waitForTimeout(700)
      for (const scrollbar of [15, 17]) {
        await page.evaluate(size => {
          document.getElementById('resize-test-scrollbar')?.remove()
          const style = document.createElement('style')
          style.id = 'resize-test-scrollbar'
          style.textContent = `[data-document-zoom-scrollport]::-webkit-scrollbar{width:${size}px!important;height:${size}px!important}`
          document.head.append(style)
        }, scrollbar)
        for (const width of [1100, 1440]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.waitForTimeout(250)
          const scrollport = page.locator('[data-document-zoom-scrollport]:visible')
          const boundary = await scrollport.evaluate(node => {
            const body = node.querySelector('[data-pdf-preview]'), pages = [...body.querySelectorAll('[data-pdf-page]')], css = getComputedStyle(body)
            const needed = pages.reduce((sum, page) => sum + page.getBoundingClientRect().height, 0) + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) + (pages.length - 1) * parseFloat(css.gap)
            return Math.round(innerHeight - node.clientHeight + needed)
          })
          // #155 identified fractional CSS dimensions as a separate trigger in
          // the old viewer. Exercise them in the official renderer as well.
          for (const offset of [-2, -1, 0, 1, 2]) for (const fraction of [0, 0.5]) {
            await scrollport.evaluate(node => { for (const name of ['width', 'height']) node.style.removeProperty(name) })
            const height = Math.max(350, boundary + offset)
            await page.setViewportSize({ width, height })
            await page.waitForTimeout(250)
            if (fraction) {
              await scrollport.evaluate((node, fraction) => {
                const box = node.getBoundingClientRect()
                node.style.width = `${Math.floor(box.width) - fraction}px`
                node.style.height = `${Math.floor(box.height) - fraction}px`
              }, fraction)
              await page.waitForTimeout(250)
            }
            const sample = await scrollport.evaluate(async node => {
              const frame = node.closest('[data-document-zoom-mode]'), canvas = node.querySelector('canvas'), samples = [], writes = []
              const observer = new MutationObserver(records => writes.push(...records.map(record => performance.now())))
              observer.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] })
              const start = performance.now()
              while (performance.now() - start < 650) {
                await new Promise(requestAnimationFrame)
                const box = canvas.getBoundingClientRect()
                samples.push({ width: node.clientWidth, height: node.clientHeight, pageWidth: box.width, pageHeight: box.height, bitmapWidth: canvas.width, bitmapHeight: canvas.height, zoom: frame.style.getPropertyValue('--document-zoom') })
              }
              observer.disconnect()
              const box = node.getBoundingClientRect()
              return { samples, lateWrites: writes.filter(time => time - start > 400).length, gutter: getComputedStyle(node).scrollbarGutter, reserved: node.offsetWidth - node.clientWidth, mode: frame.dataset.documentZoomMode, layoutWidth: box.width, layoutHeight: box.height }
            })
            const stable = new Set(sample.samples.slice(-15).map(value => JSON.stringify(value))).size === 1 && sample.lateWrites === 0
            const fractionalLayout = !fraction || [sample.layoutWidth, sample.layoutHeight].every(value => Math.abs(value % 1 - fraction) < 1 / 64)
            const passed = stable && fractionalLayout && sample.gutter === 'stable' && sample.reserved === scrollbar && sample.mode === 'fit-width'
            results.push({ dpr, file, scrollbar, width, height, offset, fraction, passed, ...sample })
            await writeFile(join(output, 'progress.json'), JSON.stringify({ checked: results.length, failed: results.filter(result => !result.passed).length }))
          }
          await scrollport.evaluate(node => { for (const name of ['width', 'height']) node.style.removeProperty(name) })
        }
      }
    }
    await context.close()
  }
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: results.every(result => result.passed) && errors.length === 0, results, errors, scope: 'Assembled local-web, emulated pixel ratios and classic scrollbars; not native desktop acceptance' }, null, 2))
  assert.ok(results.every(result => result.passed), 'Auto-fit must settle without repeated bitmap rendering')
  assert.deepEqual(errors, [])
} finally { await browser.close() }
