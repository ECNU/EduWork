// Acceptance in a real browser: the panel the reader actually uses, driven by a
// real browser, against a real calendar service.
//
// The headless suite (`test/panel.test.mjs`) renders the same panel through a
// hand-written DOM. That is enough to prove which request the panel makes, and it
// is not enough to prove that a person can type a note and get it back: the parts
// that only exist in a browser — a real React event system, a real `<textarea>`, a
// real accessibility tree — are exactly the parts a stand-in DOM cannot exercise.
// This file does not replace that suite; it covers the path that suite cannot.
//
// It is a script rather than a `node:test` file because it drives a browser and a
// server, following `tests/settings-theme-browser.mjs`. No desktop shell is needed:
// the panel is mounted on a plain page, and the calendar behind it is the real
// service over a temporary storage root.
//
//   EDUWORK_TEST_RUNTIME=/path/to/product/d node test/browser-acceptance.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const runtime = process.env.EDUWORK_TEST_RUNTIME
assert.ok(runtime, 'Set EDUWORK_TEST_RUNTIME to an installed product/d directory')
const require = createRequire(join(runtime, 'package.json'))
const { build } = require('esbuild')
const { chromium } = require('playwright-core')

const pluginRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtimeParent = pathToFileURL(join(runtime, 'package.json')).href

// One copy of React for the panel and for this file's service, pointed at the
// shell's own copy so the renderer and the elements agree on which React is which.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'zod' || specifier.startsWith('@deepseek-ai/')) {
      return next(specifier, { ...context, parentURL: runtimeParent })
    }
    return next(specifier, context)
  },
})
const load = async name => import(pathToFileURL(require.resolve(name)).href)

const SOURCE = 'ecnu:timetable'
const NOTE = '期末要背 P187，第三章习题'

/**
 * Wait until `read` answers what is expected.
 *
 * A write made through the panel is asynchronous — it writes, then re-reads, then
 * redraws — so a value it produced is waited for rather than assumed to have landed
 * by the time a click returns. This is the one place a short wait is the right tool:
 * there is no event to wait for that means "the service has it now".
 */
async function poll(read, expected, message, timeout = 15000) {
  const deadline = Date.now() + timeout
  let seen
  for (;;) {
    seen = await read()
    if (JSON.stringify(seen) === JSON.stringify(expected)) return
    if (Date.now() > deadline) {
      assert.deepEqual(seen, expected, `${message} (waited ${timeout}ms)`)
      return
    }
    await new Promise(done => setTimeout(done, 100))
  }
}

/** A temporary storage root that refuses to be removed outside its own tree. */
async function withRoot(prefix, body) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await body(root)
  } finally {
    const target = resolve(root)
    assert.ok(target.startsWith(resolve(tmpdir()) + sep), `refusing to remove ${target}`)
    await rm(target, { recursive: true, force: true })
  }
}

/** The real calendar service over a temporary root, on a real Cordis scope. */
async function withCalendar(root, body) {
  const [cordis, storageHub, storageJson, storageDomain, plugin] = await Promise.all([
    load('@deepseek-ai/cordis'),
    load('@deepseek-ai/dsh-storage'),
    load('@deepseek-ai/dsh-storage-json'),
    load('@deepseek-ai/dsh-storage-domain'),
    import('../lib/index.js'),
  ])
  const ctx = new cordis.Context()
  await ctx.plugin(storageHub.default ?? storageHub)
  await ctx.plugin(storageJson, { root: join(root, 'storages') })
  await ctx.plugin(storageDomain, { backend: 'json' })
  await ctx.plugin(plugin.CalendarService)
  try {
    return await body(ctx.calendar)
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * Bundle the panel for the browser.
 *
 * The same source the release build compiles, through the same esbuild. Two things
 * are taken from the page rather than bundled: React, because two copies would give
 * the renderer a different one than the elements were made with, and the UI
 * primitives package, which is a shell library that does not bundle on its own. The
 * primitives surface comes from `test/support/browser-primitives.js`; the panel's own
 * source, and therefore everything under test, is the real one.
 */
async function bundlePanel() {
  const result = await build({
    absWorkingDir: pluginRoot,
    stdin: {
      contents: "export { createCalendarPage } from './src/client.ts'",
      resolveDir: pluginRoot,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'calendarPanel',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    nodePaths: [join(runtime, 'node_modules')],
    plugins: [{
      name: 'from-the-page',
      setup(context) {
        context.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'from-the-page' }))
        context.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'react-dom', namespace: 'from-the-page' }))
        context.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({ path: 'primitives', namespace: 'from-the-page' }))
        // The remote-client generator's descriptors are runtime wiring this page
        // replaces with a direct service, so its generated client goes unused.
        context.onResolve({ filter: /^@deepseek-ai\// }, args => ({ path: args.path, namespace: 'unused' }))
        context.onLoad({ filter: /.*/, namespace: 'from-the-page' }, args => {
          if (args.path === 'react') return { contents: 'module.exports = window.React', loader: 'js' }
          if (args.path === 'react-dom') return { contents: 'module.exports = window.ReactDOM', loader: 'js' }
          return {
            contents: [
              'const p = window.Primitives;',
              'export const Button = p.Button, Input = p.Input, Menu = p.Menu, Modal = p.Modal,',
              '  Switch = p.Switch, Tag = p.Tag, Toast = p.Toast, Tooltip = p.Tooltip,',
              '  writeClipboard = p.writeClipboard;',
            ].join('\n'),
            loader: 'js',
          }
        })
        context.onLoad({ filter: /.*/, namespace: 'unused' }, () => ({ contents: 'export default {}', loader: 'js' }))
      },
    }],
    logLevel: 'warning',
  })
  return result.outputFiles[0].text
}

/**
 * The page: the panel mounted on the real service, reached over HTTP.
 *
 * The service calls cross the process boundary because the calendar is Node code
 * over a storage root while the panel is a browser page. What crosses is the
 * service's own interface, so the panel is talking to the real thing rather than to
 * a browser-side imitation of it.
 */
// The page. Names here are deliberately unlike the panel bundle's own, because this
// script shares the page's top-level scope with it.
const fixture = (methods) => `
const elt = React.createElement;
const call = (method) => async (input) => {
  const response = await fetch('/api/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args: input === undefined ? [] : [input] }),
  });
  if (!response.ok) throw new Error(method + ': ' + await response.text());
  return await response.json();
};
const calendarService = {
  subscribe(listener) {
    const stream = new EventSource('/changes');
    stream.onmessage = () => listener();
    return () => stream.close();
  },
};
for (const method of ${JSON.stringify(methods)}) calendarService[method] = method === 'sourceStatuses' ? () => call(method)() : call(method);
ReactDOM.createRoot(document.querySelector('#calendar')).render(
  elt(calendarPanel.createCalendarPage(calendarService)),
);
/**
 * A date inside the week the panel is actually drawing.
 *
 * The browser's clock is the one the panel reads, and it is not necessarily this
 * process's: a bundled runtime can carry its own idea of the time. Asking the page
 * where its week starts keeps every seeded entry inside the week on screen instead
 * of trusting a date computed out here.
 */
window.__dayInWeek = (offset) => {
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7) + offset);
  const two = (value) => String(value).padStart(2, '0');
  return start.getFullYear() + '-' + two(start.getMonth() + 1) + '-' + two(start.getDate());
};
`

/** One server: the API in front of the calendar, and the page around the panel. */
async function serve(calendar, panel, methods) {
  const page = fixture(methods)
  const primitives = await readFile(join(pluginRoot, 'test', 'support', 'browser-primitives.js'), 'utf8')
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/changes') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
        const controller = new AbortController()
        response.on('close', () => controller.abort())
        for await (const change of calendar.changes(controller.signal)) response.write(`data: ${JSON.stringify(change)}\n\n`)
        response.end()
        return
      }
      if (request.url === '/panel.js') {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(panel)
        return
      }
      if (request.url === '/primitives.js') {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(primitives)
        return
      }
      if (request.url === '/react.js' || request.url === '/react-dom.js') {
        response.setHeader('Content-Type', 'text/javascript')
        response.end(await readFile(join(runtime, 'node_modules',
          request.url === '/react.js' ? 'react/umd/react.development.js' : 'react-dom/umd/react-dom.development.js')))
        return
      }
      if (request.url.startsWith('/api/')) {
        const method = request.url.slice('/api/'.length).split('?')[0]
        const body = await new Promise(done => {
          let text = ''
          request.on('data', chunk => { text += chunk })
          request.on('end', () => done(text))
        })
        // A whitelist, not a general dispatcher: this server is a test fixture, and
        // it only ever exposes the calendar surface the panel was given.
        if (!methods.includes(method)) {
          response.statusCode = 404
          response.end(`no such method: ${method}`)
          return
        }
        const { args } = JSON.parse(body || '{"args":[]}')
        const answer = await calendar[method](...args)
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(answer === undefined ? null : answer))
        return
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<html lang="zh"><meta charset="utf-8">
<style>
body { font: 14px system-ui; margin: 0 }
#calendar { width: 900px }
* { transition: none !important }
</style>
<div id="calendar"></div>
<script src="/react.js"></script>
<script src="/react-dom.js"></script>
<script src="/primitives.js"></script>
<script src="/panel.js"></script>
<script>${page}</script>
</html>`)
    } catch (error) {
      response.statusCode = 500
      response.end(String(error?.stack ?? error))
    }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  return { server, url: `http://127.0.0.1:${server.address().port}` }
}

/**
 * Run one browser pass, closing the browser and server however it ends.
 *
 * `body` is handed the page, the list of errors the page raised, and the panel's own
 * service reached through the page. Calling the service that way rather than the
 * Node-side instance keeps one writer: both are the same calendar, but a call made
 * through the page is a call the panel's own view is looking at.
 */
async function withBrowser(calendar, panel, methods, body) {
  const { server, url } = await serve(calendar, panel, methods)
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.EDUWORK_BROWSER_CHANNEL || 'msedge', headless: true })
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, locale: 'zh-CN' })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
    page.on('requestfailed', request => errors.push(`request failed: ${request.url()} ${request.failure()?.errorText}`))
    // How many reads the panel makes for one screen. A view that re-reads on every
    // render is a view that never settles, and the count is what shows it.
    let reads = 0
    page.on('request', request => { if (request.url().includes('/api/occurrences')) reads += 1 })
    await page.goto(url)
    // The panel reads what it needs in effects; the first redraw is when those reads
    // have landed. Nothing is asserted here — each pass seeds its own entries and then
    // waits for what it seeded.
    await page.waitForFunction(() => typeof window.__dayInWeek === 'function' && document.querySelector('#calendar')?.textContent?.includes('我的日历'))
    /** A date inside the week the panel is drawing, from the panel's own clock. */
    const dayInWeek = offset => page.evaluate(offset => window.__dayInWeek(offset), offset)
    /** One call to the calendar the page is using, so both sides see the same writes. */
    const call = (method, input) => page.evaluate(async ({ method, input }) => {
      const response = await fetch('/api/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args: input === undefined ? [] : [input] }),
      })
      if (!response.ok) throw new Error(await response.text())
      return await response.json()
    }, { method, input })
    /** Read the calendar back, so an assertion is about the data and not the drawing. */
    const events = async () => (await call('snapshot')).events
    /** Redraw from the service, which is what the panel does after it writes. */
    const refresh = () => page.reload()
    return await body({ page, errors, dayInWeek, call, events, refresh, reads: () => reads })
  } finally {
    await browser?.close()
    await new Promise(done => server.close(done))
  }
}

const METHODS = [
  'snapshot', 'occurrences', 'importIcs', 'exportIcs', 'applySource', 'applyOverride', 'removeOverride',
  'cancelOccurrence', 'restoreOccurrence', 'deleteEvent', 'deleteCalendar', 'putEvent', 'updateEvent', 'putNote', 'removeNote', 'notes', 'setPersonal', 'personalFor', 'sourceStatuses', 'reminders', 'ackReminder',
]

const panel = await bundlePanel()
const report = []
let failures = 0

async function acceptance(name, body) {
  if (process.env.EDUWORK_BROWSER_CASE && !name.includes(process.env.EDUWORK_BROWSER_CASE)) return
  try {
    await body()
    report.push(`  通过  ${name}`)
  } catch (error) {
    failures += 1
    report.push(`  失败  ${name}`)
    report.push(`        ${String(error?.message ?? error).split('\n').join('\n        ')}`)
  }
}

// 1. The path the headless suite cannot take: a person types a note in a real
//    textarea, presses the real save button, reopens the class and reads it back,
//    then clears it. The seeded note goes through the service first so the typed
//    text is the only thing that can have changed it.
await acceptance('在真实浏览器里写笔记 → 保存 → 重新打开确认 → 清空', async () => {
  await withRoot('eduwork-browser-note-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, errors, dayInWeek, call, events, refresh }) => {
        // Seeded through the page, on a day of the week the page is drawing, so the
        // entry is on screen for a reason and not by luck of the clock.
        const tuesday = await dayInWeek(1)
        await call('putEvent', {
          uid: 'personal-1', title: '个人复习课', start: `${tuesday}T19:00`, end: `${tuesday}T20:00`, location: '图书馆',
        })
        await refresh()

        await page.getByRole('button', { name: /个人复习课/ }).click()
        await page.getByRole('button', { name: '写笔记' }).click()

        // A real `<textarea>` in a real browser: `fill` sets the value through the
        // browser's own input pipeline, which is what a keyboard would do and what
        // the stand-in DOM could not reproduce.
        const field = page.getByRole('textbox', { name: '我的笔记' })
        await field.waitFor()
        await field.fill(NOTE)
        assert.equal(await field.inputValue(), NOTE, 'the textarea holds what was typed')
        await page.getByRole('button', { name: '保存笔记' }).click()

        // Written where it belongs: the personal layer, not the record. The save is
        // asynchronous — the panel writes, then re-reads — so the note is waited for
        // rather than assumed to have landed by the time the click returns.
        await page.getByText('我的笔记').first().waitFor()
        await poll(
          async () => (await call('notes', { scope: 'source', source: 'manual', uid: 'personal-1' }))[0]?.note.text,
          NOTE,
          'the note reached the calendar service',
        )
        assert.equal(
          (await events()).find(event => event.uid === 'personal-1')?.description,
          undefined,
          'and it was not written onto the entry itself',
        )

        // Reopen the class from scratch and read it back.
        await page.getByRole('button', { name: '关闭' }).click()
        await page.getByRole('button', { name: /个人复习课/ }).click()
        await page.getByText('我的笔记').first().waitFor()
        assert.ok(
          await page.getByText(NOTE).first().isVisible(),
          'reopening the class shows the note that was typed',
        )

        // Clear it: an emptied note is a removal, not a blank note left behind.
        await page.getByRole('button', { name: '改笔记' }).click()
        const again = page.getByRole('textbox', { name: '我的笔记' })
        await again.fill('')
        assert.equal(await again.inputValue(), '', 'the textarea is empty')
        await page.getByRole('button', { name: '保存笔记' }).click()
        await page.getByRole('button', { name: '关闭' }).click()

        assert.deepEqual(
          await call('notes', { scope: 'source', source: 'manual', uid: 'personal-1' }),
          [],
          'clearing removed the note instead of storing a blank one',
        )
        await page.getByRole('button', { name: /个人复习课/ }).waitFor()
        const drawn = await page.getByRole('button', { name: /个人复习课/ }).getAttribute('aria-label')
        assert.ok(drawn && !drawn.includes('笔记：'), `the class is drawn without a note, saw ${drawn}`)
        assert.deepEqual(errors, [], 'the page raised no error')
      })
    })
  })
})

// 2. The other acceptance the review asks for: an imported entry and a personal one
//    that share an identifier are two classes, and deleting one through the panel
//    must leave the other exactly as it was.
await acceptance('删除导入日程，同编号的个人日程不受影响', async () => {
  await withRoot('eduwork-browser-delete-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, errors, dayInWeek, call, events, refresh, reads }) => {
        const tuesday = await dayInWeek(1)
        // The same identifier in both layers: the case that silently deletes the wrong
        // record when the panel leaves the source out of its request.
        await call('putEvent', {
          uid: 'MATH101-01', title: '自己加的复习课', start: `${tuesday}T19:00`, end: `${tuesday}T20:00`, location: '图书馆',
        })
        await call('applySource', {
          source: SOURCE,
          events: [{ uid: 'MATH101-01', title: '高等数学 A', start: `${tuesday}T09:00`, end: `${tuesday}T11:35`, location: '数学楼 201' }],
        })
        assert.equal((await events()).length, 2, 'both layers hold a class of that identifier')
        await refresh()

        // The panel must settle: one screen is one read, not one read per render. A
        // view that re-reads on every render draws the same class over and over and
        // never converges, which is what makes a deleted class stay on screen.
        await page.waitForTimeout(1500)
        assert.ok(reads() <= 4, `the panel read the week a bounded number of times, read ${reads()} time(s)`)
        assert.equal(
          await page.getByRole('button', { name: /高等数学 A/ }).count(),
          1,
          `and drew the one imported class once (week reads: ${reads()})`,
        )

        // The imported one carries its source in the label, which is what tells the
        // two apart on the week.
        await page.getByRole('button', { name: /高等数学 A/ }).click()
        await page.getByRole('button', { name: '删除日程' }).click()
        await page.getByRole('button', { name: '删除', exact: true }).click()

        // The dialog closes and the week redraws from the service.
        await page.getByRole('button', { name: /自己加的复习课/ }).waitFor()
        try {
          await page.waitForFunction(() => !document.body.textContent.includes('高等数学 A'), null, { timeout: 10000 })
        } catch (error) {
          const body = await page.locator('body').innerText().catch(() => '')
          const labels = await page.locator('button[aria-label]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')))
          const shot = process.env.EDUWORK_TEST_EVIDENCE
          if (shot) await page.screenshot({ path: join(shot, 'delete-after.png'), fullPage: true })
          throw new Error([
            error.message,
            `--- 一周读取次数 ---\n${reads()}`,
            `--- 按钮 aria-label ---\n${labels.join('\n') || '(无)'}`,
            `--- 删除后页面文字 ---\n${body.slice(0, 1200)}`,
            `--- 删除后数据 ---\n${JSON.stringify(await events())}`,
            `--- 页面报错 ---\n${errors.slice(0, 3).join('\n') || '(无)'}`,
          ].join('\n'))
        }
        const left = await events()
        assert.deepEqual(
          left.map(event => `${event.source}/${event.uid}`).sort(),
          ['manual/MATH101-01'],
          'the imported class went and the personal one stayed',
        )
        assert.equal(left[0].title, '自己加的复习课', 'and it is still the reader\'s own entry')
        assert.equal(left[0].location, '图书馆', 'with its own fields untouched')
        assert.deepEqual(errors, [], 'the page raised no error')
      })
    })
  })
})

// 3. The record page is the other first-class way to delete: the week's dialog asks
//    before it removes every date of a series, and the page over one record has to
//    ask too, or the same act is careful in one place and abrupt in the other. This
//    drives the real buttons, and checks the entry is still there when it declines.
await acceptance('记录页删除前会问一句，取消就不删', async () => {
  await withRoot('eduwork-browser-record-delete-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, errors, dayInWeek, call, events, refresh }) => {
        const tuesday = await dayInWeek(1)
        await call('putEvent', {
          uid: 'personal-2', title: '个人复习课', start: `${tuesday}T19:00`, end: `${tuesday}T20:00`, location: '图书馆',
        })
        await refresh()

        // Into the record page: open the occurrence, then the entry behind it.
        await page.getByRole('button', { name: /个人复习课/ }).click()
        await page.getByRole('button', { name: '编辑日程信息' }).click()
        await page.getByRole('button', { name: '删除这条日程' }).waitFor()

        // Asking is the point: a click here removes every date of the record, which is
        // more than the dialog over one occurrence removes.
        await page.getByRole('button', { name: '删除这条日程' }).click()
        await page.getByText('确定删除这条日程？').waitFor()
        assert.equal((await events()).length, 1, 'asking is not deleting: the entry is still there')

        await page.getByRole('button', { name: '取消' }).click()
        assert.equal(
          await page.getByRole('button', { name: '删除这条日程' }).count(),
          1,
          'declining puts the button back and nothing was removed',
        )
        assert.equal((await events()).length, 1, 'and the entry is still there after declining')

        // Now go through with it.
        await page.getByRole('button', { name: '删除这条日程' }).click()
        await page.getByRole('button', { name: '删除', exact: true }).click()
        await poll(async () => (await events()).length, 0, 'the entry is gone once confirmed')
        assert.deepEqual(errors, [], 'the page raised no error')
      })
    })
  })
})

// 4. A note survives the school moving the class, in a browser rather than in a
//    service call: the panel must still be showing it under the new time.
await acceptance('学校改时间后，浏览器里仍能看到原笔记挂在这一节课上', async () => {  await withRoot('eduwork-browser-reschedule-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, errors, dayInWeek, call, events, refresh }) => {
        const tuesday = await dayInWeek(1)
        await call('applySource', {
          source: SOURCE,
          events: [{
            uid: 'MATH101-01', title: '高等数学 A', start: `${tuesday}T09:00`, end: `${tuesday}T11:35`, location: '数学楼 201',
          }],
        })
        await refresh()

        // The note is written through the panel, so this pass covers the same typing
        // path as the first one and then asks whether the school can disturb it.
        await page.getByRole('button', { name: /高等数学 A/ }).click()
        await page.getByRole('button', { name: '写笔记' }).click()
        await page.getByRole('textbox', { name: '我的笔记' }).fill(NOTE)
        await page.getByRole('button', { name: '保存笔记' }).click()
        await page.getByText('我的笔记').first().waitFor()
        await page.getByRole('button', { name: '关闭' }).click()
        assert.equal(
          (await call('notes', { scope: 'source', source: SOURCE, uid: 'MATH101-01' }))[0]?.note.text,
          NOTE,
          'the note is stored under the class the school sent',
        )

        // The school moves that one class to the afternoon. The incoming end is the
        // time the class used to finish, which is what a real timetable sends and what
        // the store derives the new end from.
        const occurrence = (await call('occurrences', { from: tuesday, to: tuesday })).occurrences[0]
        await call('applySource', {
          source: SOURCE,
          events: [{
            uid: 'MATH101-01', title: '高等数学 A', start: `${tuesday}T14:00`,
            end: `${tuesday}T11:35`, location: '数学楼 305', movedFrom: occurrence.originalStart,
          }],
        })
        assert.equal(
          (await call('notes', { scope: 'source', source: SOURCE, uid: 'MATH101-01' }))[0]?.note.text,
          NOTE,
          'the school moving the class did not disturb the note',
        )

        await refresh()
        const moved = page.getByRole('button', { name: /高等数学 A/ })
        await moved.waitFor()
        const label = await moved.getAttribute('aria-label')
        assert.ok(label?.startsWith('14:00'), `the class is drawn at the school's new time, saw ${label}`)
        assert.ok(label.includes('数学楼 305'), `and at the room the school changed, saw ${label}`)
        await moved.click()
        assert.ok(await page.getByText(NOTE).first().isVisible(), 'the note is still on that class')
        assert.deepEqual(errors, [], 'the page raised no error')
      })
    })
  })
})


await acceptance('个人单次日程写笔记后改时间，重开仍显示原笔记', async () => {
  await withRoot('eduwork-browser-personal-anchor-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, errors, dayInWeek, call, events, refresh }) => {
        const day = await dayInWeek(1)
        await call('putEvent', { uid: 'personal-anchor', title: 'Personal note anchor', start: `${day}T19:00`, end: `${day}T20:00` })
        await refresh()
        await page.getByRole('button', { name: /Personal note anchor/ }).click()
        await page.getByRole('button', { name: '写笔记' }).click()
        await page.getByRole('textbox', { name: '我的笔记' }).fill(NOTE)
        await page.getByRole('button', { name: '保存笔记' }).click()
        await poll(async () => (await call('notes', { source: 'manual', uid: 'personal-anchor' }))[0]?.note.text, NOTE, 'note saved')
        await page.getByRole('button', { name: '编辑日程信息' }).click()
        await page.getByLabel('开始', { exact: true }).fill('20:00')
        await page.getByLabel(/^结束/).fill('21:00')
        await page.getByRole('button', { name: '保存更改' }).click()
        await poll(async () => (await events()).find(event => event.uid === 'personal-anchor')?.start, `${day}T20:00`, 'time saved')
        const afterEdit = (await call('occurrences', { from: day, to: day })).occurrences[0]
        assert.equal(afterEdit.originalStart, `${day}T19:00`, JSON.stringify(await events()))
        assert.equal((await call('notes', { source: 'manual', uid: 'personal-anchor', originalStart: afterEdit.originalStart }))[0]?.note.text, NOTE)

        await page.getByRole('button', { name: '返回', exact: true }).click()
        await page.getByRole('button', { name: /Personal note anchor/ }).click()
        await page.getByText(NOTE).first().waitFor()
        await refresh()
        await page.getByRole('button', { name: /Personal note anchor/ }).click()
        await page.getByText(NOTE).first().waitFor()
        assert.deepEqual(errors, [])
      })
    })
  })
})


await acceptance('空日历直接显示周网格', async () => {
  await withRoot('eduwork-browser-empty-grid-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page }) => {
        await page.getByText('周一', { exact: true }).waitFor({ timeout: 2000 })
        assert.equal(await page.getByText('日历还是空的').count(), 0)
        assert.equal(await page.getByText('09:00', { exact: true }).count(), 1)
      })
    })
  })
})


await acceptance('默认导入不同文件不会覆盖已有日历', async () => {
  await withRoot('eduwork-browser-safe-import-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, events }) => {
        for (const title of ['基础日历', '来源A']) {
          await page.getByRole('button', { name: '导入', exact: true }).click()
          const text = ['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:shared-id',`SUMMARY:${title}`,'DTSTART:20261019T090000','DTEND:20261019T100000','END:VEVENT','END:VCALENDAR'].join('\r\n')
          await page.locator('input[type=file]').setInputFiles({ name: `${title}.ics`, mimeType: 'text/calendar', buffer: Buffer.from(text) })
          const dialog = page.getByRole('dialog')
          await dialog.getByRole('button', { name: '导入', exact: true }).click()
          await dialog.getByText('已写入日历', { exact: true }).waitFor()
          await dialog.getByRole('button', { name: '完成', exact: true }).click()
        }
        const records = await events()
        assert.equal(records.length, 2)
        assert.deepEqual(records.map(row => row.title).sort(), ['基础日历', '来源A'].sort())
        assert.equal(new Set(records.map(row => row.source)).size, 2)
      })
    })
  })
})


await acceptance('重复可选每天和自选星期', async () => {
  await withRoot('eduwork-browser-repeat-options-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, dayInWeek, events, call }) => {
        const monday = await dayInWeek(0)
        for (const mode of ['daily', 'custom']) {
          await page.getByRole('button', { name: '新建日程', exact: true }).click()
          const dialog = page.getByRole('dialog')
          await dialog.getByLabel('标题', { exact: true }).fill(`Repeat ${mode}`)
          await dialog.getByLabel('日期', { exact: true }).fill(monday)
          await dialog.getByRole('combobox', { name: '重复', exact: true }).selectOption(mode)
          if (mode === 'custom') {
            await dialog.getByRole('button', { name: '周一', exact: true }).click()
            await dialog.getByRole('button', { name: '周二', exact: true }).click()
            await dialog.getByRole('button', { name: '周四', exact: true }).click()
          }
          await dialog.getByRole('button', { name: '新建', exact: true }).click()
          await page.getByRole('dialog').waitFor({ state: 'detached' })
        }
        const records = await events()
        assert.equal(records.find(row => row.title === 'Repeat daily').recurrence.byDay.length, 7)
        assert.deepEqual(records.find(row => row.title === 'Repeat custom').recurrence.byDay, ['tu', 'th'])
        const to = await dayInWeek(6)
        const week = (await call('occurrences', { from: monday, to })).occurrences
        assert.equal(week.filter(row => row.title === 'Repeat daily').length, 7)
        assert.equal(week.filter(row => row.title === 'Repeat custom').length, 2)
      })
    })
  })
})

await acceptance('周月切换、跨月导航和月视图编辑共用同一条日程', async () => {
  await withRoot('eduwork-browser-month-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, call, events, refresh, errors }) => {
        const dates = await page.evaluate(() => {
          const d = new Date(); const fmt = v => `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-01`;
          return [fmt(d), fmt(new Date(d.getFullYear(),d.getMonth()+1,1))]
        })
        await call('putEvent', {uid:'month-one',title:'本月月视图日程',start:`${dates[0]}T09:00`,end:`${dates[0]}T10:00`})
        await call('putEvent', {uid:'month-two',title:'下月月视图日程',start:`${dates[1]}T09:00`})
        await refresh()
        await page.getByRole('button',{name:'月',exact:true}).click()
        await page.getByRole('grid',{name:'月日历'}).waitFor({timeout:2000})
        assert.equal(await page.getByRole('gridcell').count(),42)
        const monthEntry=page.getByRole('button',{name:/本月月视图日程/})
        await monthEntry.waitFor()
        assert.equal(await monthEntry.evaluate(node=>getComputedStyle(node).borderLeftWidth),'3px','month entries retain their source colour marker')
        await page.getByRole('button',{name:/本月月视图日程/}).click()
        await page.getByRole('button',{name:'写笔记',exact:true}).click()
        await page.getByRole('textbox',{name:'我的笔记'}).fill('从月视图写的笔记')
        await page.getByRole('button',{name:'保存笔记',exact:true}).click()
        await poll(async()=> (await call('notes',{source:'manual',uid:'month-one'}))[0]?.note.text,'从月视图写的笔记','month note persisted')
        await page.getByRole('button',{name:'关闭',exact:true}).click()
        await page.getByRole('button',{name:'下一月',exact:true}).click()
        await page.getByRole('button',{name:/下月月视图日程/}).waitFor()
        await page.getByRole('button',{name:'周',exact:true}).click()
        await page.getByRole('button',{name:'下一周',exact:true}).waitFor()
        assert.equal((await events()).length,2)
        assert.deepEqual(errors,[])
      })
    })
  })
})

await acceptance('跨天改期详情显示实际日期，取消后可从日程菜单恢复', async()=> {
  await withRoot('eduwork-browser-move-date-', async root=> {
    await withCalendar(root,async calendar=> {
      await withBrowser(calendar,panel,METHODS,async({page,call,dayInWeek,refresh,errors})=> {
        const monday=await dayInWeek(0), wednesday=await dayInWeek(2)
        await call('putEvent',{uid:'weekly-date',title:'跨天日期验收',description:'带教材',start:`${monday}T09:00`,end:`${monday}T10:00`,recurrence:{freq:'weekly',count:3}})
        await refresh()
        await page.getByRole('button',{name:/跨天日期验收/}).click()
        await page.getByText('日程备注',{exact:true}).waitFor()
        await page.getByRole('button',{name:'改期或改地点',exact:true}).click()
        const fields=page.locator('input[type=datetime-local]')
        await fields.nth(0).fill(`${wednesday}T14:00`)
        await page.getByRole('button',{name:'保存',exact:true}).click()
        await page.getByRole('dialog').waitFor({state:'detached'})
        await page.getByRole('button',{name:/跨天日期验收/}).click()
        const d=new Date(`${wednesday}T00:00`)
        await page.getByText(`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 周三 14:00–15:00`,{exact:true}).waitFor()
        await page.getByRole('button',{name:'取消这一次',exact:true}).click()
        await page.getByRole('dialog').waitFor({state:'detached'})
        assert.equal(await page.locator('button[data-occurrence]').count(),0)
        await page.getByRole('button',{name:'日程',exact:true}).click()
        await page.getByRole('menuitem',{name:/跨天日期验收 · 已取消 1 次/}).click()
        await page.getByText('已取消的日期',{exact:true}).waitFor()
        await page.getByRole('button',{name:`恢复 ${Number(monday.slice(5,7))}月${Number(monday.slice(8))}日`,exact:true}).click()
        await poll(async()=> (await call('snapshot')).events[0].exceptions?.length??0,0,'cancellation restored')
        await page.getByRole('button',{name:'返回',exact:true}).click()
        await page.getByRole('button',{name:/跨天日期验收/}).waitFor()
        assert.deepEqual(errors,[])
      })
    })
  })
})

await acceptance('结束有时间而开始为空时禁止保存', async()=> {
  await withRoot('calendar-browser-no-start-',async root=>withCalendar(root,async calendar=>withBrowser(calendar,panel,METHODS,async({page})=> {
    await page.getByRole('button',{name:'新建日程',exact:true}).click()
    await page.getByLabel('标题',{exact:true}).fill('不应成为全天')
    await page.getByLabel('开始',{exact:true}).fill('')
    assert.equal(await page.getByRole('button',{name:'新建',exact:true}).isDisabled(),true)
  })))
})

await acceptance('跨夜日程只改备注仍保留次日结束', async()=> {
  await withRoot('calendar-browser-overnight-edit-',async root=>withCalendar(root,async calendar=>withBrowser(calendar,panel,METHODS,async({page,call,dayInWeek,refresh,events})=> {
    const day=await dayInWeek(0), next=await dayInWeek(1)
    await call('putEvent',{uid:'overnight-edit',title:'夜间活动',start:`${day}T23:00`,end:`${next}T02:00`})
    await refresh()
    await page.getByRole('button',{name:/夜间活动/}).first().click()
    await page.getByRole('button',{name:'编辑日程信息',exact:true}).click()
    await page.getByLabel('备注',{exact:true}).fill('只改备注')
    await page.getByRole('button',{name:'保存更改',exact:true}).click({timeout:2000})
    await poll(async()=>(await events())[0].description,'只改备注','description saved')
    assert.equal((await events())[0].end,`${next}T02:00`)
  })))
})

await acceptance('记录页的出现时间只属于选中的来源', async()=> {
  await withRoot('calendar-browser-record-source-',async root=>withCalendar(root,async calendar=>withBrowser(calendar,panel,METHODS,async({page,call,dayInWeek,refresh})=> {
    const day=await dayInWeek(0)
    await call('putEvent',{uid:'same-record',source:'source-A',title:'只看来源A',start:`${day}T09:00`,end:`${day}T10:00`})
    await call('putEvent',{uid:'same-record',source:'source-B',title:'不能显示来源B',start:`${day}T14:00`,end:`${day}T15:00`})
    await refresh()
    await page.getByRole('button',{name:/只看来源A/}).click()
    await page.getByRole('button',{name:'编辑日程信息',exact:true}).click()
    await page.getByRole('button',{name:/只看来源A/}).waitFor()
    assert.equal(await page.getByRole('button',{name:/不能显示来源B/}).count(),0)
  })))
})

await acceptance('迟到的翻周响应不能覆盖已经返回的这一周', async()=> {
  await withRoot('calendar-browser-late-week-',async root=>withCalendar(root,async calendar=>withBrowser(calendar,panel,METHODS,async({page,call,dayInWeek,refresh})=> {
    const day=await dayInWeek(0)
    const next=await page.evaluate(d=>{const x=new Date(`${d}T00:00`);x.setDate(x.getDate()+7);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`},day)
    await call('putEvent',{uid:'late-week',title:'当前这一周的日程',start:`${day}T09:00`})
    await refresh()
    let captured
    const read=new Promise(resolve=>{captured=resolve})
    await page.route('**/api/occurrences',async route=> {
      if(route.request().postDataJSON().args[0].from===next) {
        const response=await route.fetch();captured()
        await new Promise(resolve=>setTimeout(resolve,600))
        await route.fulfill({response})
      } else await route.continue()
    })
    try {
      await page.getByRole('button',{name:'下一周',exact:true}).click()
      await read
      await page.getByRole('button',{name:'上一周',exact:true}).click()
      await page.waitForTimeout(1000)
      assert.equal(await page.getByRole('button',{name:/当前这一周的日程/}).count(),1)
    } finally {await page.unroute('**/api/occurrences')}
  })))
})

await acceptance('慢写入时双击新建不会生成重复日程', async()=> {
  await withRoot('calendar-browser-double-create-',async root=>withCalendar(root,async calendar=>withBrowser(calendar,panel,METHODS,async({page,events})=> {
    await page.getByRole('button',{name:'新建日程',exact:true}).click()
    await page.getByLabel('标题',{exact:true}).fill('只应创建一次')
    await page.route('**/api/putEvent',async route=> {
      const response=await route.fetch()
      await new Promise(resolve=>setTimeout(resolve,500))
      await route.fulfill({response})
    })
    try {
      await page.getByRole('dialog').getByRole('button',{name:'新建',exact:true}).dblclick()
      await page.getByRole('dialog').waitFor({state:'detached'})
      assert.equal((await events()).filter(e=>e.title==='只应创建一次').length,1)
    } finally {await page.unroute('**/api/putEvent')}
  })))
})

await acceptance('损坏文件开启替换导入后仍保留日程和笔记', async () => {
  await withRoot('calendar-browser-malformed-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, call, events, dayInWeek, refresh }) => {
        const day = await dayInWeek(1)
        await call('putEvent', { source: 'structure', uid: 'keep', title: '不能丢失的日程', start: `${day}T09:00` })
        await call('putNote', { source: 'structure', uid: 'keep', originalStart: `${day}T09:00`, text: '不能丢失的笔记' })
        const before = await events()
        const notes = await call('notes', { source: 'structure' })
        for (const text of [
          'BEGIN:VCALENDAR\r\nEND:WRONG\r\n',
          'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:unfinished\r\n',
        ]) {
          await page.getByRole('button', { name: '导入', exact: true }).click()
          await page.locator('input[type=file]').setInputFiles({ name: 'structure.ics', mimeType: 'text/calendar', buffer: Buffer.from(text) })
          const dialog = page.getByRole('dialog')
          await dialog.getByRole('switch').click()
          await dialog.getByRole('button', { name: '导入', exact: true }).click()
          await dialog.getByText(/unmatched calendar END|unfinished calendar component/).waitFor()
          assert.deepEqual(await events(), before)
          assert.deepEqual(await call('notes', { source: 'structure' }), notes)
          await dialog.getByRole('button', { name: '取消', exact: true }).click()
        }
        await refresh()
        await page.getByRole('button', { name: /不能丢失的日程/ }).click()
        await page.getByText('不能丢失的笔记', { exact: false }).last().waitFor()
      })
    })
  })
})

await acceptance('全天导入拒绝无效结束日期，合法的一天仍正常显示', async () => {
  await withRoot('calendar-browser-all-day-', async root => {
    await withCalendar(root, async calendar => {
      await withBrowser(calendar, panel, METHODS, async ({ page, call, events, dayInWeek, refresh }) => {
        const day = await dayInWeek(1)
        const compact = day.replaceAll('-', '')
        await call('putEvent', { source: 'all-day', uid: 'keep', title: '原有全天活动', start: day })
        const before = await events()
        const text = end => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:keep', 'SUMMARY:全天活动',
          `DTSTART;VALUE=DATE:${compact}`, `DTEND;VALUE=DATE:${end}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
        for (const valid of [false, true]) {
          const next = new Date(`${day}T12:00:00`)
          next.setDate(next.getDate() + 1)
          const end = valid ? `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}` : compact
          await page.getByRole('button', { name: '导入', exact: true }).click()
          await page.locator('input[type=file]').setInputFiles({ name: 'all-day.ics', mimeType: 'text/calendar', buffer: Buffer.from(text(end)) })
          const dialog = page.getByRole('dialog')
          await dialog.getByRole('switch').click()
          await dialog.getByRole('button', { name: '导入', exact: true }).click()
          await dialog.getByText(valid ? '已写入日历' : '没有写入新的日程', { exact: true }).waitFor()
          if (valid) {
            const record = (await events()).find(row => row.uid === 'keep')
            assert.equal(record.start, day)
            assert.equal(record.end, day)
          } else {
            await dialog.getByText(/DTEND.*is not after DTSTART/).waitFor()
            assert.deepEqual(await events(), before)
          }
          await dialog.getByRole('button', { name: '完成', exact: true }).click()
        }
        await refresh()
        await page.getByRole('button', { name: /全天.*全天活动/ }).waitFor()
      })
    })
  })
})

await acceptance('外部同步和 Agent 笔记修改自动刷新已打开面板', async () => {
  await withRoot('eduwork-browser-external-refresh-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, dayInWeek }) => {
      const day = await dayInWeek(1)
      await calendar.applySource({ source: SOURCE, complete: true, events: [{ uid: 'external', title: 'External class', start: `${day}T09:00`, end: `${day}T11:00` }] })
      const block = page.getByRole('button', { name: /External class/ })
      await block.waitFor({ timeout: 3000 })
      await calendar.putNote({ source: SOURCE, uid: 'external', originalStart: `${day}T09:00`, text: 'Agent wrote this' })
      await block.getByText('笔记：Agent wrote this', { exact: true }).waitFor({ timeout: 3000 })
      await calendar.applySource({ source: SOURCE, complete: true, events: [] })
      await block.waitFor({ state: 'detached', timeout: 3000 })
    })
  }))
})

await acceptance('整门课笔记、单次覆盖、恢复默认和提醒设置可从面板保存', async () => {
  await withRoot('eduwork-browser-personal-settings-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, dayInWeek, call }) => {
      const day = await dayInWeek(1)
      await call('applySource', { source: SOURCE, events: [{ uid: 'settings', title: 'Personal settings class', start: `${day}T09:00`, end: `${day}T11:00`, recurrence: { freq: 'weekly', count: 3 } }] })
      const block = page.getByRole('button', { name: /Personal settings class/ })
      await block.waitFor()
      await block.click()
      await page.getByRole('button', { name: '更多个人设置', exact: true }).click()
      await page.getByRole('combobox', { name: '设置范围' }).selectOption('series')
      await page.getByRole('combobox', { name: '笔记设置' }).selectOption('custom')
      await page.getByRole('textbox', { name: '默认笔记' }).fill('Every class note')
      await page.getByRole('combobox', { name: '提醒设置' }).selectOption('relative')
      await page.getByRole('spinbutton', { name: '提前分钟数' }).fill('15')
      await page.getByRole('button', { name: '保存个人设置', exact: true }).click()
      await poll(async () => calendar.personalFor({ source: SOURCE, uid: 'settings' }).note?.text, 'Every class note', 'series note was saved')
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await block.getByText('笔记：Every class note').waitFor()
      await block.click()
      await page.getByRole('button', { name: '更多个人设置', exact: true }).click()
      await page.getByRole('combobox', { name: '笔记设置' }).selectOption('custom')
      await page.getByRole('textbox', { name: '默认笔记' }).fill('Only this class')
      await page.getByRole('button', { name: '保存个人设置', exact: true }).click()
      const ref = { source: SOURCE, uid: 'settings', originalStart: `${day}T09:00` }
      await poll(async () => calendar.personalFor(ref).note?.text, 'Only this class', 'one class overrides the default')
      await page.getByRole('dialog').getByText(/我的笔记\s*Only this class/).waitFor({ timeout: 3000 })
      await page.getByRole('combobox', { name: '笔记设置' }).selectOption('inherit')
      await page.getByRole('button', { name: '保存个人设置', exact: true }).click()
      await poll(async () => calendar.personalFor(ref).note?.text, 'Every class note', 'restore the default')
      await page.getByRole('dialog').getByText(/我的笔记\s*Every class note/).waitFor({ timeout: 3000 })
      assert.deepEqual(calendar.personalFor(ref).reminder, { kind: 'relative', minutes: 15 })
    })
  }))
})

await acceptance('提醒到点后自动进入提醒记录，标为已读后重开仍保持', async () => {
  await withRoot('eduwork-browser-reminder-inbox-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, dayInWeek, call, errors }) => {
      const now = new Date(), pad = x => String(x).padStart(2, '0')
      const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
      await call('putEvent', { uid: 'due', title: '我的到点提醒', start: `${await dayInWeek(1)}T09:00` })
      await call('setPersonal', { source: 'manual', uid: 'due', patch: { reminder: { kind: 'fixed', at } } })
      await page.getByRole('button', { name: '提醒记录', exact: true }).click({ timeout: 3000 })
      const dialog = page.getByRole('dialog')
      await dialog.getByText('我的到点提醒', { exact: true }).waitFor({ timeout: 4000 })
      assert.ok((await dialog.innerText()).includes('应用内提醒'))
      await dialog.getByRole('button', { name: '标为已读', exact: true }).click()
      await poll(async () => (await call('reminders')).unread, 0, 'receipt acknowledged')
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await page.reload()
      await page.getByRole('button', { name: '提醒记录', exact: true }).click()
      await page.getByRole('dialog').getByText('已读', { exact: true }).waitFor()
      assert.deepEqual(errors, [])
    })
  }))
})

await acceptance('同步日历用可读名称显示，内部来源不暴露为名称', async () => {
  await withRoot('eduwork-browser-source-label-', async root => withCalendar(root, async calendar => {
    const handle = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'calendar', label: '学校校历' })
    await withBrowser(calendar, panel, METHODS, async ({ page, dayInWeek, errors }) => {
      const day = await dayInWeek(1)
      await handle.apply({ events: [{ uid: 'label', title: '可读名称课程', start: `${day}T09:00`, end: `${day}T10:00` }] })
      await page.getByRole('group', { name: '筛选日历' }).getByRole('button', { name: '学校校历', exact: true }).waitFor({ timeout: 3000 })
      assert.equal(await page.getByRole('button', { name: '删除所选日历', exact: true }).count(), 0)
      await page.getByRole('button', { name: /09:00.*可读名称课程/ }).click()
      await page.getByText('日历：学校校历', { exact: true }).waitFor({ timeout: 3000 })
      assert.ok(!(await page.locator('body').innerText()).includes(handle.source))
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await page.getByRole('button', { name: '导入', exact: true }).click()
      assert.equal(await page.locator('#calendar-import-names option').count(), 0, 'managed calendars cannot be file import targets')
      assert.deepEqual(errors, [])
    })
    handle.dispose()
  }))
})

await acceptance('删除导入日历须确认，可取消，删除后其他日历与笔记保留', async () => {
  await withRoot('eduwork-browser-delete-calendar-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, dayInWeek, call, errors }) => {
      const day = await dayInWeek(1)
      for (const source of ['导入A', '导入B', 'manual']) await call('putEvent', { source, uid: 'shared', title: source, start: `${day}T09:00` })
      await call('putNote', { source: '导入A', uid: 'shared', text: '保留我的笔记' })
      const filters = page.getByRole('group', { name: '筛选日历' })
      await filters.getByRole('button', { name: '导入A', exact: true }).click()
      await page.getByRole('button', { name: '删除所选日历', exact: true }).click({ timeout: 3000 })
      await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
      assert.equal(calendar.snapshot().events.length, 3)
      await page.getByRole('button', { name: '删除所选日历', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: '删除日历', exact: true }).click()
      await poll(async () => calendar.snapshot().events.map(e => e.source).sort(), ['manual', '导入B'].sort(), 'only the chosen calendar is removed')
      await poll(() => filters.getByRole('button', { name: '导入A', exact: true }).count(), 0, 'deleted calendar filter disappears')
      assert.equal(calendar.unlinkedNotes()[0].note.text, '保留我的笔记')
      await filters.getByRole('button', { name: '个人日程', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: '删除所选日历', exact: true }).count(), 0)
      assert.deepEqual(errors, [])
    })
  }))
})

await acceptance('来源状态显示失败并保留已有课表，重试成功后自动恢复', async () => {
  await withRoot('eduwork-browser-source-status-', async root => withCalendar(root, async calendar => {
    const handle = calendar.registerSource({ provider: 'example.edu', account: 'student', feed: 'timetable', label: '测试课表' })
    handle.beginUpdate().fail('token=never-display')
    await withBrowser(calendar, panel, METHODS, async ({ page }) => {
      await page.getByText('测试课表：同步失败，保留上次数据', { exact: true }).waitFor({ timeout: 3000 })
      await handle.apply({ complete: true, events: [] })
      await page.getByText('测试课表：已更新', { exact: true }).waitFor({ timeout: 3000 })
      assert.ok(!(await page.locator('body').innerText()).includes('token=never-display'))
    })
    handle.dispose()
  }))
})

await acceptance('隐藏单次后可从日程页恢复，私人备注与固定提醒仍保留', async () => {
  await withRoot('eduwork-browser-hidden-settings-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, dayInWeek, call }) => {
      const day = await dayInWeek(1)
      await call('applySource', { source: SOURCE, events: [{ uid: 'hidden', title: 'Hidden settings class', start: `${day}T09:00`, end: `${day}T11:00`, description: 'Source text' }] })
      const block = page.getByRole('button', { name: /09:00.*Hidden settings class/ })
      await block.waitFor(); await block.click()
      await page.getByRole('button', { name: '更多个人设置', exact: true }).click()
      await page.getByRole('combobox', { name: '备注设置' }).selectOption('custom')
      await page.getByRole('textbox', { name: '我的备注' }).fill('Private remark')
      await page.getByRole('combobox', { name: '提醒设置' }).selectOption('fixed')
      await page.getByLabel('固定提醒时间', { exact: true }).fill(`${day}T20:00`)
      await page.getByRole('combobox', { name: '显示设置' }).selectOption('hide')
      await page.getByRole('button', { name: '保存个人设置', exact: true }).click()
      const ref = { source: SOURCE, uid: 'hidden', originalStart: `${day}T09:00` }
      await poll(() => calendar.personalFor(ref).hidden, true, 'hidden persisted')
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await block.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: '日程', exact: true }).click()
      await page.getByRole('menuitem', { name: /Hidden settings class/ }).click()
      await page.getByRole('button', { name: /Hidden settings class.*已隐藏/ }).click({ timeout: 3000 })
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: '更多个人设置', exact: true }).click()
      await dialog.getByRole('combobox', { name: '显示设置' }).selectOption('show')
      await dialog.getByRole('button', { name: '保存个人设置', exact: true }).click()
      await poll(() => calendar.personalFor(ref).hidden, false, 'shown again')
      assert.equal(calendar.personalFor(ref).remark.text, 'Private remark')
      assert.deepEqual(calendar.personalFor(ref).reminder, { kind: 'fixed', at: `${day}T20:00` })
      assert.equal(calendar.getEvent({ source: SOURCE, uid: 'hidden' }).description, 'Source text')
    })
  }))
})

await acceptance('编辑只发送改动字段，同步更新后保存备注不覆盖课程', async () => {
  await withRoot('calendar-browser-sparse-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek, refresh }) => {
      const day = await dayInWeek(1)
      await call('putEvent', { uid: 'sparse-ui', source: 'manual', title: 'Sparse original', start: `${day}T09:00`, end: `${day}T10:00`, location: 'A' })
      await refresh()
      await page.getByRole('button', { name: /Sparse original/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      let sent
      await page.route('**/api/updateEvent', async route => {
        sent = route.request().postDataJSON().args[0]
        // Another writer lands after the editor opened, before its save.
        await calendar.updateEvent({ uid: 'sparse-ui', source: 'manual', patch: { title: 'Synced title', location: 'B' } })
        await route.continue()
      })
      await page.getByLabel('备注', { exact: true }).fill('Private from browser')
      await page.getByRole('button', { name: '保存更改', exact: true }).click()
      await poll(() => calendar.getEvent({ uid: 'sparse-ui', source: 'manual' }).description, 'Private from browser', 'private remark saved')
      assert.deepEqual(sent, { uid: 'sparse-ui', source: 'manual', patch: { description: 'Private from browser' } })
      const event = calendar.getEvent({ uid: 'sparse-ui', source: 'manual' })
      assert.equal(event.title, 'Synced title')
      assert.equal(event.location, 'B')
    })
  }))
})

await acceptance('编辑草稿不受其他来源的后台刷新影响', async () => {
  await withRoot('calendar-browser-dirty-other-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek, refresh }) => {
      const day = await dayInWeek(1)
      await call('putEvent', { uid: 'draft', title: 'Personal original', start: `${day}T09:00`, end: `${day}T10:00` })
      await call('putEvent', { source: 'other', uid: 'draft', title: 'Other original', start: `${day}T13:00` })
      await refresh()
      await page.getByRole('button', { name: /Personal original/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      await page.getByRole('button', { name: '刷新', exact: true }).click()
      await poll(() => page.getByRole('button', { name: '刷新', exact: true }).isEnabled(), true, 'initial reads settled')
      const title = page.getByLabel('标题', { exact: true })
      await title.fill('User unsaved title')
      for (const next of ['Other refreshed once', 'Other refreshed twice']) {
        await calendar.updateEvent({ source: 'other', uid: 'draft', patch: { title: next } })
        await page.getByRole('button', { name: '日程', exact: true }).click()
        await page.getByRole('menuitem', { name: new RegExp(next) }).waitFor()
        await page.getByRole('button', { name: '日程', exact: true }).click()
        assert.equal(await title.inputValue(), 'User unsaved title', 'an unrelated source refresh must preserve the unsaved title')
      }
      await page.getByRole('button', { name: '保存更改', exact: true }).click()
      await poll(() => calendar.getEvent({ uid: 'draft' }).title, 'User unsaved title', 'the original draft can still be saved')
    })
  }))
})

await acceptance('同一日程同步时保留编辑字段并更新未编辑字段', async () => {
  await withRoot('calendar-browser-dirty-same-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, dayInWeek, refresh }) => {
      const day = await dayInWeek(1)
      const source = calendar.registerSource({ provider: 'example.edu', account: 'public', feed: 'editing' })
      const original = { uid: 'draft', title: 'School original', start: `${day}T09:00`, end: `${day}T10:00`, location: 'A', description: 'School description' }
      assert.equal((await source.apply({ revision: 1, events: [original] })).state, 'ready')
      await refresh()
      await page.getByRole('button', { name: /School original/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      const title = page.getByLabel('标题', { exact: true }), location = page.getByLabel('地点', { exact: true })
      await title.fill('User title')
      assert.equal((await source.apply({ revision: 2, events: [{ ...original, title: 'School latest', end: `${day}T11:00`, location: 'B' }] })).state, 'ready')
      await poll(() => location.inputValue(), 'B', 'unedited location follows the source')
      assert.equal(await title.inputValue(), 'User title')
      assert.equal(await page.getByLabel('开始', { exact: true }).inputValue(), '09:00')
      assert.equal(await page.getByLabel(/^结束/).inputValue(), '11:00')
      await location.fill('')
      assert.equal((await source.apply({ revision: 3, events: [{ ...original, title: 'School newest', end: `${day}T12:00`, location: 'C' }] })).state, 'ready')
      await poll(() => page.getByLabel(/^结束/).inputValue(), '12:00', 'another source revision reached the form')
      assert.equal(await title.inputValue(), 'User title')
      assert.equal(await location.inputValue(), '', 'explicit clearing is still an edit')
      const request = page.waitForRequest(request => request.url().endsWith('/api/updateEvent'))
      await page.getByRole('button', { name: '保存更改', exact: true }).click()
      assert.deepEqual((await request).postDataJSON().args[0], { source: source.source, uid: 'draft', patch: { title: 'User title', location: null } })
      await poll(() => calendar.getEvent({ source: source.source, uid: 'draft' }).title, 'User title', 'user changes saved')
      const saved = calendar.getEvent({ source: source.source, uid: 'draft' })
      assert.equal(saved.start, `${day}T09:00`)
      assert.equal(saved.end, `${day}T12:00`)
      assert.equal(saved.location, undefined)
      assert.equal(saved.description, 'School description')
      await poll(() => page.getByRole('button', { name: '保存更改', exact: true }).isDisabled(), true, 'saved changes become clean')
    })
  }))
})

await acceptance('切换同编号不同来源及返回后重置草稿，保存后跟随新快照', async () => {
  await withRoot('calendar-browser-dirty-reset-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek, refresh }) => {
      const day = await dayInWeek(1)
      await call('putEvent', { uid: 'same', title: 'Personal reset', start: `${day}T09:00`, end: `${day}T10:00` })
      await call('putEvent', { source: 'other', uid: 'same', title: 'Other reset', start: `${day}T13:00` })
      await refresh()
      await page.getByRole('button', { name: /Personal reset/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      const title = page.getByLabel('标题', { exact: true })
      await title.fill('Do not copy this draft')
      await page.getByRole('button', { name: '日程', exact: true }).click()
      await page.getByRole('menuitem', { name: /Other reset/ }).click()
      assert.equal(await title.inputValue(), 'Other reset')
      await title.fill('Discard on switching')
      await page.getByRole('button', { name: '日程', exact: true }).click()
      await page.getByRole('menuitem', { name: /Personal reset/ }).click()
      assert.equal(await title.inputValue(), 'Personal reset')
      assert.equal(await page.getByRole('button', { name: '保存更改', exact: true }).isDisabled(), true)
      await title.fill('Discard on return')
      await page.getByRole('button', { name: '返回', exact: true }).click()
      await page.getByRole('button', { name: /Personal reset/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      assert.equal(await title.inputValue(), 'Personal reset')
      await title.fill('  Saved normalized  ')
      await page.getByRole('button', { name: '保存更改', exact: true }).click()
      await poll(() => title.inputValue(), 'Saved normalized', 'successful save adopts normalized value')
      await poll(() => page.getByRole('button', { name: '保存更改', exact: true }).isDisabled(), true, 'successful save is clean')
      await calendar.updateEvent({ uid: 'same', patch: { title: 'Updated after save' } })
      await poll(() => title.inputValue(), 'Updated after save', 'saved fields follow later updates')
      assert.equal(calendar.getEvent({ source: 'other', uid: 'same' }).title, 'Other reset')
    })
  }))
})

await acceptance('保存等待期间再次编辑或改回原值也不丢失', async () => {
  await withRoot('calendar-browser-dirty-pending-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek, refresh }) => {
      const day = await dayInWeek(1)
      await call('putEvent', { uid: 'pending', title: 'Pending original', start: `${day}T09:00` })
      await refresh()
      await page.getByRole('button', { name: /Pending original/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      const title = page.getByLabel('标题', { exact: true }), save = page.getByRole('button', { name: '保存更改', exact: true })
      let release
      const gate = new Promise(done => { release = done })
      await page.route('**/api/updateEvent', async route => { await gate; await route.continue() })
      try {
        await title.fill('First submitted title')
        const request = page.waitForRequest(request => request.url().endsWith('/api/updateEvent'))
        await save.click(); await request
        await title.fill('Pending original')
      } finally { release() }
      await page.getByText('First submitted title', { exact: true }).first().waitFor()
      await poll(() => page.getByRole('button', { name: '刷新', exact: true }).isEnabled(), true, 'save refresh completed')
      assert.equal(calendar.getEvent({ uid: 'pending' }).title, 'First submitted title')
      assert.equal(await title.inputValue(), 'Pending original', 'typing during the request must remain an unsaved edit, including reverting to the previous value')
      assert.equal(await save.isEnabled(), true)
      await page.unroute('**/api/updateEvent')
      await save.click()
      await poll(() => calendar.getEvent({ uid: 'pending' }).title, 'Pending original', 'the later edit can be saved independently')
      await poll(() => save.isDisabled(), true, 'second save becomes clean')
    })
  }))
})

await acceptance('保存失败后草稿保留，后台刷新后仍可重试', async () => {
  await withRoot('calendar-browser-dirty-failure-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek, refresh }) => {
      const day = await dayInWeek(1)
      await call('putEvent', { uid: 'retry', title: 'Retry original', start: `${day}T09:00` })
      await refresh()
      await page.getByRole('button', { name: /Retry original/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      const title = page.getByLabel('标题', { exact: true }), save = page.getByRole('button', { name: '保存更改', exact: true })
      await title.fill('Retry unsaved title')
      await page.route('**/api/updateEvent', route => route.fulfill({ status: 503, body: 'Synthetic save rejected' }))
      await save.click()
      await page.getByText(/updateEvent: Synthetic save rejected/).waitFor()
      assert.equal(await title.inputValue(), 'Retry unsaved title')
      assert.equal(calendar.getEvent({ uid: 'retry' }).title, 'Retry original')
      await calendar.putEvent({ source: 'other', uid: 'retry', title: 'Refresh after failure', start: `${day}T13:00` })
      await page.getByRole('button', { name: '日程', exact: true }).click()
      await page.getByRole('menuitem', { name: /Refresh after failure/ }).waitFor()
      await page.getByRole('button', { name: '日程', exact: true }).click()
      assert.equal(await title.inputValue(), 'Retry unsaved title')
      await page.unroute('**/api/updateEvent')
      await save.click()
      await poll(() => calendar.getEvent({ uid: 'retry' }).title, 'Retry unsaved title', 'retry saves retained input')
      await poll(() => save.isDisabled(), true, 'retried save becomes clean')
    })
  }))
})

await acceptance('个人设置保存中继续编辑笔记、备注和提醒，后续草稿保留', async () => {
  await withRoot('calendar-browser-personal-pending-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek, refresh }) => {
      const day = await dayInWeek(1), ref = { source: 'manual', uid: 'personal-pending' }
      await call('putEvent', { ...ref, title: 'Personal pending', start: `${day}T09:00` })
      await refresh()
      await page.getByRole('button', { name: /Personal pending/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      await page.getByLabel('备注设置', { exact: true }).selectOption('custom')
      const remark = page.getByLabel('我的备注', { exact: true })
      const save = page.getByRole('button', { name: '保存个人设置', exact: true })
      let release
      const gate = new Promise(done => { release = done })
      await page.route('**/api/setPersonal', async route => { await gate; await route.continue() })
      try {
        await remark.fill('Submitted remark')
        const request = page.waitForRequest(request => request.url().endsWith('/api/setPersonal'))
        await save.click(); await request
        await remark.fill('Later remark')
        await page.getByLabel('笔记设置', { exact: true }).selectOption('custom')
        await page.getByLabel('默认笔记', { exact: true }).fill('Later note')
        await page.getByLabel('提醒设置', { exact: true }).selectOption('relative')
        await page.getByLabel('提前分钟数', { exact: true }).fill('12')
      } finally { release() }
      await poll(() => calendar.personalFor(ref).remark?.text, 'Submitted remark', 'only the submitted values were saved')
      await poll(() => save.isEnabled(), true, 'later input remains dirty after the save and reload')
      assert.equal(await remark.inputValue(), 'Later remark')
      assert.equal(await page.getByLabel('默认笔记', { exact: true }).inputValue(), 'Later note')
      assert.equal(await page.getByLabel('提前分钟数', { exact: true }).inputValue(), '12')
      await page.unroute('**/api/setPersonal')
      await save.click()
      await poll(() => calendar.personalFor(ref).remark?.text, 'Later remark', 'the later values were stored')
      await poll(() => save.isDisabled(), true, 'the second save is clean')
      assert.equal(calendar.personalFor(ref).remark.text, 'Later remark')
      assert.equal(calendar.personalFor(ref).note.text, 'Later note')
      assert.deepEqual(calendar.personalFor(ref).reminder, { kind: 'relative', minutes: 12 })
    })
  }))
})

await acceptance('个人设置保存失败可保留草稿重试', async () => {
  await withRoot('calendar-browser-personal-retry-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek, refresh }) => {
      const day = await dayInWeek(1), ref = { source: 'manual', uid: 'personal-retry' }
      await call('putEvent', { ...ref, title: 'Personal retry', start: `${day}T09:00` })
      await refresh()
      await page.getByRole('button', { name: /Personal retry/ }).click()
      await page.getByRole('button', { name: '编辑日程信息', exact: true }).click()
      await page.getByLabel('备注设置', { exact: true }).selectOption('custom')
      const remark = page.getByLabel('我的备注', { exact: true })
      const save = page.getByRole('button', { name: '保存个人设置', exact: true })
      await remark.fill('Retain on failure')
      await page.route('**/api/setPersonal', route => route.fulfill({ status: 503, body: 'Synthetic personal save rejected' }))
      await save.click()
      await page.getByText(/setPersonal: Synthetic personal save rejected/).waitFor()
      assert.equal(await remark.inputValue(), 'Retain on failure')
      assert.equal(calendar.personalFor(ref).remark, undefined)
      await page.unroute('**/api/setPersonal')
      await save.click()
      await poll(() => calendar.personalFor(ref).remark?.text, 'Retain on failure', 'retry stores the retained draft')
      await poll(() => save.isDisabled(), true, 'retry completes')
    })
  }))
})

await acceptance('切换设置范围后，旧保存的迟到读取不覆盖当前草稿', async () => {
  await withRoot('calendar-browser-personal-scope-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek }) => {
      const day = await dayInWeek(1), ref = { source: SOURCE, uid: 'personal-scope' }
      await call('applySource', { source: SOURCE, events: [{ uid: ref.uid, title: 'Personal scope', start: `${day}T09:00`, recurrence: { freq: 'weekly', count: 3 } }] })
      await call('setPersonal', { ...ref, patch: { remark: { text: 'Series remark' } } })
      await page.getByRole('button', { name: /Personal scope/ }).click()
      await page.getByRole('button', { name: '更多个人设置', exact: true }).click()
      await page.getByLabel('备注设置', { exact: true }).selectOption('custom')
      const remark = page.getByLabel('我的备注', { exact: true })
      const save = page.getByRole('button', { name: '保存个人设置', exact: true })
      let release
      const gate = new Promise(done => { release = done })
      const isOnce = request => request.url().endsWith('/api/personalFor') && request.postDataJSON()?.args?.[0]?.originalStart
      const oldResponse = page.waitForResponse(response => isOnce(response.request()))
      await page.route('**/api/personalFor', async route => { if (isOnce(route.request())) await gate; await route.continue() })
      try {
        await remark.fill('Saved for one occurrence')
        const request = page.waitForRequest(isOnce)
        await save.click(); await request
        await page.getByLabel('设置范围', { exact: true }).selectOption('series')
        await poll(() => remark.inputValue(), 'Series remark', 'series editor loaded')
        await remark.fill('Unsaved series remark')
      } finally { release() }
      // Observe completion of the old read before asserting it cannot replace this target.
      await (await oldResponse).finished()
      await page.unrouteAll({ behavior: 'wait' })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await remark.inputValue(), 'Unsaved series remark')
      assert.equal(await save.isEnabled(), true)
      await save.click()
      await poll(() => calendar.personalFor(ref).remark?.text, 'Unsaved series remark', 'current target remains independently saveable')
      assert.equal(calendar.personalFor({ ...ref, originalStart: `${day}T09:00` }).remark.text, 'Saved for one occurrence')
    })
  }))
})

await acceptance('快捷笔记保存期间暂锁编辑，失败保留输入且可重试', async () => {
  await withRoot('calendar-browser-note-pending-', async root => withCalendar(root, async calendar => {
    await withBrowser(calendar, panel, METHODS, async ({ page, call, dayInWeek, refresh }) => {
      const day = await dayInWeek(1), ref = { source: 'manual', uid: 'note-pending' }
      await call('putEvent', { ...ref, title: 'Note pending', start: `${day}T09:00` })
      await refresh()
      await page.getByRole('button', { name: /Note pending/ }).click()
      await page.getByRole('button', { name: '写笔记', exact: true }).click()
      const input = page.getByRole('textbox', { name: '我的笔记' })
      const save = page.getByRole('button', { name: '保存笔记', exact: true })
      let release
      const gate = new Promise(done => { release = done })
      await page.route('**/api/putNote', async route => { await gate; await route.fulfill({ status: 503, body: 'Synthetic note save rejected' }) })
      try {
        await input.fill('Pending note')
        const request = page.waitForRequest(request => request.url().endsWith('/api/putNote'))
        await save.click(); await request
        assert.equal(await input.isDisabled(), true)
        assert.equal(await save.isDisabled(), true)
        assert.equal(await page.getByRole('button', { name: '取消', exact: true }).isDisabled(), true)
      } finally { release() }
      await page.getByText(/putNote: Synthetic note save rejected/).waitFor()
      await poll(() => input.isEnabled(), true, 'failed save unlocks the retained note')
      assert.equal(await input.inputValue(), 'Pending note')
      await page.unroute('**/api/putNote')
      await input.fill('Corrected note')
      await save.click()
      await input.waitFor({ state: 'detached' })
      assert.equal(calendar.notes(ref)[0]?.note.text, 'Corrected note')
    })
  }))
})

console.log(report.join('\n'))
console.log(failures === 0 ? '\n真实浏览器验收全部通过' : `\n真实浏览器验收有 ${failures} 项失败`)
process.exitCode = failures === 0 ? 0 : 1
