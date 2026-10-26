// The Agent's Sidebar browser (src/sidebar-browser.mjs, its preload and
// dsh-plugins/browser-upstream/lib/sidebar-client.js) driven by Playwright in
// a real Electron window. Needs EDUWORK_TEST_ELECTRON (executable) and
// EDUWORK_TEST_RUNTIME (pinned Runtime with playwright-core and ws).
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const electron = process.env.EDUWORK_TEST_ELECTRON, runtime = process.env.EDUWORK_TEST_RUNTIME
const live = { skip: !(electron && runtime), timeout: 120_000 }
const load = name => createRequire(join(runtime, 'package.json'))(name)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const pages = {
  '/': `<title>Form</title><label>Name <input id="name"></label>
    <button onclick="result.textContent = 'Hello ' + document.getElementById('name').value + ' trusted=' + event.isTrusted">Greet</button>
    <p id="result">-</p><a href="/second">Second</a> <a href="/popup" target="_blank">Popup</a>
    <select id="pick"><option>A</option><option>B</option></select>`,
  '/second': '<title>Second</title><p>second page</p>',
  '/popup': '<title>Popup</title>',
  '/held': '<title>Held</title>',
  '/slow': '<title>Slow</title><button onmousedown="for (const end = Date.now() + 300; Date.now() < end;);">Slow</button>',
  // localhost and 127.0.0.1 are different sites: the frame gets its own process.
  '/frame': '<title>Frame</title><iframe id="inner" width="400" height="120"></iframe><script>inner.src = location.href.replace("127.0.0.1", "localhost").replace("/frame", "/inner")</script>',
  '/inner': `<input id="field" aria-label="Field"><p id="seen">-</p>
    <script>addEventListener('keydown', event => { if (event.key === 'Enter') seen.textContent = field.value + ' trusted=' + event.isTrusted })</script>`,
}

let app, origin, endpoint, server
const replies = new Map()
let next = 0
const run = code => new Promise((resolve, reject) => {
  const id = ++next
  replies.set(id, ({ value, error }) => error ? reject(new Error(error)) : resolve(value))
  app.stdin.write(JSON.stringify({ id, code }) + '\n')
})
const page = code => run(`return window.webContents.executeJavaScript(${JSON.stringify(code)})`)
const throttled = () => run('return window.webContents.getBackgroundThrottling()')
const connect = async session => {
  const browser = await load('playwright-core').chromium.connectOverCDP(`${endpoint}/${session}`)
  return { browser, context: browser.contexts()[0] }
}
const socket = (url, options) => new Promise((resolve, reject) => {
  const client = new (load('ws'))(url, options)
  client.once('open', () => resolve(client)).once('error', reject).once('unexpected-response', (_request, response) => reject(new Error(String(response.statusCode))))
})
const protocol = client => {
  let id = 0
  const pending = new Map()
  client.on('message', data => {
    const message = JSON.parse(data)
    pending.get(message.id)?.(message)
  })
  client.on('close', () => { for (const settle of pending.values()) settle({ error: { message: 'Connection closed' } }) })
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    pending.set(++id, message => message.error ? reject(new Error(message.error.message)) : resolve(message.result))
    client.send(JSON.stringify({ id, method, params, sessionId }))
  })
}
const opened = (session, path) => page(`fixture.openTabIn(${JSON.stringify(session)}, 'browser', { params: { url: ${JSON.stringify(origin + path)} } })`)
// The top-left pixel of the Agent's screenshot, decoded by the page itself.
const corner = async tab => tab.evaluate(async png => {
  const image = new Image()
  image.src = `data:image/png;base64,${png}`
  await image.decode()
  const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return [...context.getImageData(0, 0, 1, 1).data]
}, (await tab.screenshot()).toString('base64'))
const greet = async (tab, name) => {
  await tab.goto(`${origin}/`)
  await tab.getByLabel('Name').fill(name)
  await tab.getByRole('button', { name: 'Greet' }).click()
  assert.equal(await tab.textContent('#result'), `Hello ${name} trusted=true`)
}

before(async () => {
  if (live.skip) return
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://x').pathname, body = pages[path]
    setTimeout(() => response.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(body ?? ''), path === '/held' ? 1000 : 0)
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
  app = spawn(electron, [fileURLToPath(new URL('./fixtures/sidebar-browser-app.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'inherit'] })
  endpoint = await new Promise((resolve, reject) => {
    createInterface({ input: app.stdout }).on('line', line => {
      const message = JSON.parse(line)
      if (message.ready) resolve(message.ready)
      else replies.get(message.id)?.(message)
    })
    app.once('exit', code => reject(new Error(`Fixture exited with ${code}`)))
  })
  await page('fixture.show("session-b")')
  await opened('session-b', '/second')
  await page('fixture.show("session-a")')
  await opened('session-a', '/')
  await wait(1500)
}, { timeout: 60_000 })
after(() => {
  app?.kill()
  server?.close()
})

test('each conversation drives only its own tabs, as it would Chrome', live, async () => {
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  assert.deepEqual(context.pages().map(item => item.url()), [`${origin}/`])
  assert.match(await tab.locator('body').ariaSnapshot(), /textbox "Name"/u)
  await greet(tab, 'EduWork')
  await tab.selectOption('#pick', 'B')
  assert.equal(await tab.$eval('#pick', element => element.value), 'B')
  // A page without a background is white, as in Chrome, not see-through.
  assert.deepEqual(await corner(tab), [255, 255, 255, 255])
  await tab.getByRole('link', { name: 'Second' }).click()
  await tab.waitForURL(`${origin}/second`)
  await tab.goBack()
  assert.equal(tab.url(), `${origin}/`)
  // target=_blank becomes another tab of the same conversation.
  const [popup] = await Promise.all([context.waitForEvent('page'), tab.getByRole('link', { name: 'Popup' }).click()])
  await popup.waitForLoadState()
  assert.equal(await popup.title(), 'Popup')
  // A new page is a new Sidebar tab; its blank start is not a history entry.
  const created = await context.newPage()
  await created.goto(`${origin}/second`)
  assert.equal(await created.title(), 'Second')
  assert.equal(await created.goBack(), null)
  await created.close()
  assert.equal(await page('document.querySelectorAll("[data-sidebar-right-session=session-a] webview").length'), 2)
  await popup.close()
  await browser.close()
  const other = await connect('session-b')
  assert.deepEqual(other.context.pages().map(item => item.url()), [`${origin}/second`])
  await other.browser.close()
})

test('a new tab reaches the Agent once the Sidebar has loaded it', live, async () => {
  // Otherwise the Agent's first navigation aborts that load and the Sidebar reports the page failed.
  const client = await socket(`${endpoint}/session-a`)
  const send = protocol(client)
  const { targetId } = await send('Target.createTarget', { url: `${origin}/held` })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  assert.equal((await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }, sessionId)).result.value, 'Held')
  await send('Page.navigate', { url: `${origin}/second` }, sessionId)
  await wait(200)
  assert.equal(await page('document.querySelectorAll("[data-failed]").length'), 0)
  await send('Target.closeTarget', { targetId })
  client.close()
})

test('keyboard input reaches the page or its frame, never the application window', live, async () => {
  await page('chat.value = "draft"; chat.focus()')
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  await tab.goto(`${origin}/`)
  await tab.getByLabel('Name').fill('main')
  await tab.getByLabel('Name').press('End')
  await tab.keyboard.type('!')
  assert.equal(await tab.inputValue('#name'), 'main!')
  await tab.goto(`${origin}/frame`)
  const inner = tab.frameLocator('#inner')
  await inner.getByLabel('Field').fill('cross-site')
  await inner.getByLabel('Field').press('Enter')
  assert.equal(await inner.locator('#seen').textContent(), 'cross-site trusted=true')
  await wait(200)
  assert.deepEqual(await page('[chat.value, document.activeElement.id]'), ['draft', 'chat'])
  // Focus the user put in a page stays there.
  await page('document.querySelector("[data-sidebar-right-session=session-a] webview").focus()')
  await inner.getByLabel('Field').click()
  await wait(200)
  assert.equal(await page('document.activeElement.tagName'), 'WEBVIEW')
  await page('chat.focus()')
  await browser.close()
})

test('hidden tabs, a collapsed Sidebar and a conversation in the background keep working', live, async () => {
  await opened('session-a', '/second')
  await page('fixture.focus("session-a", "tab2")')
  const { browser, context } = await connect('session-a')
  for (const tab of context.pages()) await greet(tab, 'hidden')
  // The Sidebar opened once for this connection; after the user collapses it, it stays collapsed.
  await page('fixture.expand("session-a", false)')
  for (const tab of context.pages()) await greet(tab, 'collapsed')
  assert.equal(await page('document.querySelector(".panel[data-sidebar-right-session=session-a]").hasAttribute("data-sidebar-right-open")'), false)
  await page('fixture.show("session-b")')
  for (const tab of context.pages()) await greet(tab, 'background')
  assert.equal(await throttled(), false)
  // Layout changes on screen, such as the user collapsing and reopening the Sidebar, keep it painting.
  for (const expanded of [false, true]) {
    await page(`fixture.expand("session-b", ${expanded})`)
    for (const tab of context.pages()) assert.equal((await tab.screenshot({ timeout: 5000 })).subarray(1, 4).toString(), 'PNG')
  }
  // A command that outlasts the idle delay keeps its page painting until it ends.
  const [tab] = context.pages()
  const painted = tab.evaluate(() => new Promise(resolve => setTimeout(() => requestAnimationFrame(() => resolve('painted')), 2200)))
  await wait(1900)
  assert.ok(await page('document.querySelectorAll("[data-eduwork-agent-render]").length') > 0)
  assert.equal(await painted, 'painted')
  // The Sidebar first loads a tab when the user sees it: say so at once.
  const started = Date.now()
  await assert.rejects(context.newPage(), /viewing another conversation/u)
  assert.ok(Date.now() - started < 5000)
  await browser.close()
  await wait(2000)
  assert.equal(await throttled(), true)
  assert.equal(await page('document.querySelectorAll("[data-eduwork-agent-render], [data-eduwork-agent-acting]").length'), 0)
  await page('fixture.show("session-a"); fixture.expand("session-a", true)')
})

test('conversations working at once keep their own marker and the user\'s focus', live, async () => {
  const a = await connect('session-a'), b = await connect('session-b')
  const [pageA] = a.context.pages(), [pageB] = b.context.pages()
  await pageA.goto(`${origin}/slow`)
  await pageB.goto(`${origin}/`)
  assert.deepEqual(await page('[...document.querySelectorAll("[data-eduwork-agent-acting]")].map(e => e.closest(".session").getAttribute("data-sidebar-right-session")).sort()'),
    ['session-a', 'session-b'])
  // Overlapping clicks, one held up by its page, return focus to the message being typed.
  await page('chat.focus()')
  await Promise.all([pageA.getByRole('button', { name: 'Slow' }).click(), pageB.getByRole('button', { name: 'Greet' }).click()])
  await wait(200)
  assert.equal(await page('document.activeElement.id'), 'chat')
  // A background conversation's click, alone or overlapping one in the page the user uses, leaves the user there.
  const focused = () => page('document.activeElement.closest(".session")?.getAttribute("data-sidebar-right-session")')
  await page('document.querySelector("[data-sidebar-right-session=session-a] .cell:not([hidden]) webview").focus()')
  await pageB.getByRole('button', { name: 'Greet' }).click()
  await wait(200)
  assert.equal(await focused(), 'session-a')
  await Promise.all([pageA.getByRole('button', { name: 'Slow' }).click(), pageB.getByRole('button', { name: 'Greet' }).click()])
  await wait(200)
  assert.equal(await focused(), 'session-a')
  await page('chat.focus()')
  await a.browser.close()
  await b.browser.close()
})

test('only the Host reaches an endpoint, and pages reach nothing beyond themselves', live, async () => {
  await assert.rejects(socket(`${endpoint.replace(/[0-9a-f]{48}$/u, '0'.repeat(48))}/session-a`), /40\d/u)
  await assert.rejects(socket(`${endpoint}/session-a`, { origin: 'https://example.org' }), /40\d/u)
  // A resumed conversation's new Agent replaces the previous connection.
  // Nothing the previous one asked for answers the new one or keeps it busy,
  // here a new tab the stalled application page has yet to open.
  const old = protocol(await socket(`${endpoint}/session-a`))
  const { targetInfos: [target] } = await old('Target.getTargets')
  const { sessionId: oldSession } = await old('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  await run('void window.webContents.executeJavaScript("for (const end = Date.now() + 3500; Date.now() < end;);")')
  await wait(100)
  const stale = [old('Runtime.evaluate', { expression: 'new Promise(resolve => setTimeout(resolve, 500))', awaitPromise: true }, oldSession), old('Target.createTarget', { url: 'about:blank' })]
  await wait(100)
  const client = await socket(`${endpoint}/session-a`)
  const received = []
  client.on('message', data => received.push(JSON.parse(data)))
  for (const request of stale) await assert.rejects(request)
  const send = protocol(client)
  await send('Browser.getVersion')
  await wait(2000)
  assert.equal(await throttled(), true)
  assert.deepEqual(received.map(message => Object.keys(message.result)), [['protocolVersion', 'product', 'revision', 'userAgent', 'jsVersion']])
  await wait(1500)
  // Only this conversation's tabs, including the blank one the stale request opened.
  const { targetInfos } = await send('Target.getTargets')
  assert.ok(targetInfos.every(info => info.type === 'page' && info.url.startsWith('http://127.0.0.1:')))
  const { sessionId } = await send('Target.attachToTarget', { targetId: targetInfos.find(info => info.url.startsWith(origin)).targetId, flatten: true })
  assert.deepEqual(await send('Runtime.evaluate', { expression: '1 + 1', returnByValue: true }, sessionId), { result: { type: 'number', value: 2, description: '2' } })
  // Cookies belong to every tab of the workspace, not to this page.
  const cookie = { name: 'synthetic', value: 'injected', domain: 'unrelated.test', path: '/', httpOnly: true }
  for (const [method, params] of [['Target.getTargets'], ['Target.attachToTarget'], ['Browser.getVersion'], ['Network.getAllCookies'], ['Storage.getCookies'],
    ['Network.setCookie', cookie], ['Network.setCookies', { cookies: [cookie] }], ['Network.deleteCookies', { name: 'synthetic', domain: 'unrelated.test' }]]) {
    await assert.rejects(send(method, params, sessionId), /not available/u, method)
  }
  client.close()
})
