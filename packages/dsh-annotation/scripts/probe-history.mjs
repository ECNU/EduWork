// Exercise the real history component with the selected upstream dismissal
// hook. This focused browser probe does not qualify a complete DSH Runtime.
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import assert from 'node:assert/strict'

const { values } = parseArgs({ options: {
  dependencies: { type: 'string' }, upstream: { type: 'string' }, output: { type: 'string' }, browser: { type: 'string' },
} })
for (const key of ['dependencies', 'upstream', 'output']) if (!values[key]) throw new Error(`--${key} is required`)
const require = createRequire(join(resolve(values.dependencies), 'package.json'))
const { build } = require('esbuild'), { chromium } = require('playwright-core')
const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/')
const upstream = resolve(values.upstream).replaceAll('\\', '/')
await mkdir(values.output, { recursive: true })
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {AnnotatedContent} from ${JSON.stringify(root + 'src/client/history.js')};
import {envelope} from ${JSON.stringify(root + 'src/protocol.js')};
const h=React.createElement;
window.paint=(long=false)=>createRoot(document.getElementById('root')).render(h(AnnotatedContent,{
  content:{text:envelope([{text:long?'Quoted text '.repeat(500):'Selected text',comment:'Explain this, please.'}], 'Current request')},
  renderContent:content=>h('p',null,content.text), t:key=>key
}));`, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife', platform: 'browser',
  alias: { react: require.resolve('react'), 'react-dom/client': require.resolve('react-dom/client'), 'react-dom': require.resolve('react-dom'),
    '@deepseek-ai/dsh-client-ui-primitives': upstream + '/packages/client/ui-primitives/src/useDismissOnOutsidePointer.ts' },
  define: { 'process.env.NODE_ENV': '"production"' },
})
const browser = await chromium.launch({ headless: true,
  ...(values.browser ? { executablePath: resolve(values.browser) } : process.platform === 'win32' ? { channel: 'msedge' } : {}),
})
const results = []
try {
  for (const [width, height, top, long] of [[1200, 800, 600, false], [375, 700, 450, true], [700, 375, 220, true], [375, 700, 16, false]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent(`<style>body{font:14px sans-serif;background:#fffdfb}#root{position:absolute;top:${top}px;left:12px;right:12px}#outside{position:fixed;left:0;top:0;z-index:2000}button:focus-visible{outline:2px solid blue}</style><div id="root"></div><button id="outside">Outside</button>`)
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.evaluate(long => window.paint(long), long)
    const button = page.getByRole('button', { name: 'number 1', exact: true }), dialog = page.getByRole('dialog')
    await button.click()
    await dialog.waitFor({ state: 'visible' })
    await page.waitForTimeout(50)
    const bounds = await dialog.boundingBox()
    assert.ok(bounds && bounds.x >= 8 && bounds.y >= 8 && bounds.x + bounds.width <= width - 8 && bounds.y + bounds.height <= height - 8,
      JSON.stringify({ width, height, top, bounds }))
    assert.ok(bounds.height > 50, 'The panel remains readable')
    assert.equal(await dialog.getAttribute('data-window-drag-exclude'), '')
    if (long) {
      await dialog.evaluate(element => { element.scrollTop = element.scrollHeight })
      const note = await dialog.getByText('Explain this, please.').boundingBox()
      assert.ok(note && note.y >= bounds.y && note.y + note.height <= bounds.y + bounds.height,
        'Long quotes keep their comment reachable by scrolling')
    }
    if (width === 1200) {
      await page.evaluate(() => { document.body.style.minHeight = '1600px'; window.scrollBy(0, 40) })
      await page.waitForTimeout(50)
      const moved = await dialog.boundingBox()
      assert.ok(moved && Math.abs(moved.y - (bounds.y - 40)) < 2, 'CSS anchors follow page scrolling')
    }
    await page.screenshot({ path: join(values.output, `history-${width}-${height}-${top}.png`) })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    // A viewport-sized panel may uncover the hovered trigger on dismissal.
    await page.waitForTimeout(220)
    assert.equal(await dialog.count(), 0, 'Escape must not immediately reopen the card')
    assert.equal(await button.evaluate(element => element.style.getPropertyValue('anchor-name')), '')
    await button.click()
    await page.locator('#outside').click()
    await dialog.waitFor({ state: 'detached' })
    await button.focus()
    await dialog.waitFor({ state: 'visible' })
    await page.keyboard.press('Tab')
    await dialog.waitFor({ state: 'detached' })
    await button.click()
    await dialog.getByRole('button', { name: 'close', exact: true }).focus()
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    assert.deepEqual(errors, [])
    results.push({ width, height, top, long, bounds, passed: true })
    await page.close()
  }
  await writeFile(join(values.output, 'history-browser.json'), JSON.stringify(results, null, 2) + '\n')
  console.log(`${results.length} history popup layouts and dismissal checks passed`)
} finally { await browser.close() }
