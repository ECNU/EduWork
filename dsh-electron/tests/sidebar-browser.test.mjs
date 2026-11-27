// The Agent's Sidebar browser (src/sidebar-browser.mjs, its preload and
// dsh-plugins/browser-upstream/lib/sidebar-client.js) driven by Playwright in
// a real Electron window. Needs EDUWORK_TEST_ELECTRON (executable) and
// EDUWORK_TEST_RUNTIME (pinned Runtime with playwright-core and ws).
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
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
  // The widths a page sees: at its first script and at each resize.
  '/first': '<title>First</title><script>window.widths = [innerWidth]; addEventListener("resize", () => widths.push(innerWidth))</script>',
  '/popup': '<title>Popup</title>',
  // What only a page laid out wider than a phone shows, near its right edge: a button and a red square.
  // A button it always shows, a field and room to right-click.
  '/layout': `<title>Layout</title><style>@media (max-width: 900px) { .wide { display: none } }
    #wide { position: absolute; left: 1100px; top: 10px } #edge { position: absolute; left: 1180px; top: 60px; width: 40px; height: 40px; background: red }</style>
    <input id="draft" aria-label="Draft"> <button id="any" onclick="clicks.textContent++">Any</button>
    <button id="wide" class="wide" onclick="clicks.textContent++">Wide</button><div id="edge" class="wide"></div>
    <p id="clicks">0</p><div id="blank" style="height: 200px"></div>`,
  '/held': '<title>Held</title>',
  '/stalled': '<title>Stalled</title><img src="/never">',
  '/slow': '<title>Slow</title><button onmousedown="for (const end = Date.now() + 300; Date.now() < end;);">Slow</button>',
  // localhost and 127.0.0.1 are different sites: the frame gets its own process.
  '/frame': '<title>Frame</title><iframe id="inner" width="400" height="120"></iframe><script>inner.src = location.href.replace("127.0.0.1", "localhost").replace("/frame", "/inner")</script>',
  '/inner': `<input id="field" aria-label="Field"><p id="seen">-</p>
    <script>addEventListener('keydown', event => { if (event.key === 'Enter') seen.textContent = field.value + ' trusted=' + event.isTrusted })
    addEventListener('contextmenu', () => { window.menus = (window.menus ?? 0) + 1 })</script>`,
  // Each element with room to right-click beside its words, which macOS would select.
  '/menu': `<title>Menu</title><a id="link" href="/second" style="display: inline-block; padding: 10px">Second</a>
    <a id="script" href="javascript:void 0" style="display: inline-block; padding: 10px">Script</a>
    <a id="mail" href="mailto:someone@example.org" style="display: inline-block; padding: 10px">Mail</a>
    <img id="image" src="/image.svg" width="60" height="30"><img id="broken" src="/missing.png" width="60" height="30">
    <iframe id="framed" width="60" height="30" style="border: 0"></iframe><input id="field" value="draft" style="width: 200px">
    <p id="text">Selected words</p><div id="blank" style="height: 200px"></div>
    <script>framed.src = location.href.replace('127.0.0.1', 'localhost').replace('/menu', '/framed')
    addEventListener('contextmenu', () => { window.menus = (window.menus ?? 0) + 1 })</script>`,
  '/framed': '<body style="margin: 0"><img src="/image.svg" width="60" height="30"></body>',
  '/image.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="#2a7"/></svg>',
  // A page of a.site1.test, answered slowly, with a frame of b.site1.test, another origin of the
  // same site, a frame of other.test and a script of assets.site1.test, which no page loads;
  // or of other.test, with a frame of a.site1.test.
  '/store': `<title>Store</title><iframe id="sub" width="200" height="40"></iframe><iframe id="cross" width="200" height="40"></iframe>
    <script>const at = host => location.protocol + '//' + host + ':' + location.port
    const site1 = location.hostname.endsWith('site1.test')
    sub.src = at(site1 ? 'b.site1.test' : location.hostname) + '/plain'
    cross.src = at(site1 ? 'other.test' : 'a.site1.test') + '/plain'
    if (site1) document.head.append(Object.assign(document.createElement('script'), { src: at('assets.site1.test') + '/cached.js' }))</script>`,
  '/plain': '<title>Plain</title>',
  '/cached.js': 'window.cached = true',
  // Answers again with no content.
  '/kept': '<title>Kept</title>',
}

let app, origin, endpoint, server
let cachedLoads = 0, keptLoads = 0
const replies = new Map()
let next = 0
const run = code => new Promise((resolve, reject) => {
  const id = ++next
  replies.set(id, ({ value, error }) => error ? reject(new Error(error)) : resolve(value))
  app.send({ id, code })
})
const page = code => run(`return window.webContents.executeJavaScript(${JSON.stringify(code)})`)
const throttled = () => run('return window.webContents.getBackgroundThrottling()')
// Each Sidebar guest's address and whether it is throttled, in address order.
const guestsThrottled = () => run(`return webContents.getAllWebContents().filter(guest => guest.getType() === 'webview')
  .map(guest => [new URL(guest.getURL()).pathname, guest.getBackgroundThrottling()]).sort(([a], [b]) => a.localeCompare(b))`)
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
// The Agent's screenshot of a page: its width, and its pixels at some points, decoded by the page itself.
const screenshot = async (tab, points = [[0, 0]]) => {
  const png = await tab.screenshot({ scale: 'css' })
  return [png.readUInt32BE(16), await tab.evaluate(async ({ png, points }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    return points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data])
  }, { png: png.toString('base64'), points })]
}
// A pixel's color, as the screenshot's color profile shows the page's white and red.
const color = ([r, g, b]) => r > 200 && g > 200 && b > 200 ? 'white' : r > 200 && g < 100 && b < 100 ? 'red' : `rgb(${r}, ${g}, ${b})`
// The menus shown, disabled items in brackets, checkboxes with their mark.
const shown = () => run(`return menus.map(menu => menu.items.map(item => item.type === 'separator' ? '-'
  : (item.type === 'checkbox' ? (item.checked ? '[x] ' : '[ ] ') : '') + (item.enabled ? item.label : '(' + item.label + ')')))`)
const choose = label => run(`menus.splice(0).at(-1).items.find(item => item.label === ${JSON.stringify(label)}).click()`)
// The user's press, routed into the page from the application window as theirs is, on the page as it shows, scaled down to desktop width.
const press = async (locator, button, x) => {
  const box = await locator.boundingBox()
  const [left, top, scale] = await page('(frame => (r => [r.x, r.y, r.width / frame.offsetWidth])(frame.getBoundingClientRect()))(document.querySelector("[data-sidebar-right-session=session-a] .cell:not([hidden]) webview"))')
  await run(`const input = window.webContents.debugger
    input.attach('1.3')
    try {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await input.sendCommand('Input.dispatchMouseEvent', { type, x: ${left + (box.x + x(box.width)) * scale}, y: ${top + (box.y + 4) * scale},
        button: type === 'mouseMoved' ? 'none' : '${button}', buttons: type === 'mousePressed' ? ${button === 'right' ? 2 : 1} : 0, clickCount: 1 })
    }
    finally { input.detach() }`)
}
// A page the Sidebar shows anew takes the user's input only once it is laid
// out anew, until then going to the page shown before: press an element of it
// until a press counts.
const takesInput = async locator => {
  const inputs = () => locator.page().evaluate(() => document.__eduworkInput ?? 0)
  for (const before = await inputs(), deadline = Date.now() + 5000; await inputs() === before;) {
    assert.ok(Date.now() < deadline, 'the page the Sidebar shows takes no input from the user')
    await press(locator, 'left', width => width / 2)
  }
}
// The menu the user's right click near an element's right edge opens.
const menuAt = async locator => {
  await run('menus.length = 0')
  await press(locator, 'right', width => width - 4)
  await wait(300)
  return shown()
}
// A Sidebar tab's guest element in session-a, by its page's address.
const frameOf = tab => `[...document.querySelectorAll('[data-sidebar-right-session=session-a] webview')].find(frame => frame.getURL() === ${JSON.stringify(tab.url())})`
// Whether the tab's guest element shows over exactly the tab's cell, which the Sidebar sizes.
const covers = tab => page(`(frame => { const shows = frame.getBoundingClientRect(), tab = frame.closest('.cell').getBoundingClientRect()
  return ['x', 'y', 'width', 'height'].every(key => Math.abs(shows[key] - tab[key]) < 0.5) })(${frameOf(tab)})`)
// The tab brought to front by the user: its page's layout width and whether it covers its tab, once they are as expected.
const layout = async (tab, expected) => {
  await page(`fixture.focus('session-a', ${frameOf(tab)}.closest('[data-sidebar-right-tab]').getAttribute('data-sidebar-right-tab'))`)
  const now = async () => [await tab.evaluate(() => innerWidth), await covers(tab)]
  let seen
  for (const deadline = Date.now() + 3000; (seen = await now()).join() !== [expected, true].join() && Date.now() < deadline;) await wait(50)
  return seen
}
// The widths a page has seen since its first script ran, but 0: a Sidebar tab's new document may run
// that script before Chromium gives it its size.
const widthsSeen = async tab => (await tab.waitForFunction(() => window.widths !== undefined && innerWidth > 0 && [...new Set([...widths, innerWidth].filter(Boolean))])).jsonValue()
const tabWidth = () => page('document.querySelector("[data-sidebar-right-session=session-a] .cell:not([hidden])").getBoundingClientRect().width')
// The mark browser_layout has Playwright evaluate in the page of the Agent's current tab.
const marked = async tab => {
  const mark = randomUUID().replaceAll('-', '')
  await tab.evaluate(`'eduwork-layout:${mark}'`)
  return mark
}
// A request to a conversation's layout endpoint, as the Host makes it: the status and the answer.
const post = (session, body, headers = {}, at = endpoint) => new Promise((resolve, reject) => {
  request(`${at.replace(/^ws:/u, 'http:')}/${session}/layout`, { method: 'POST', agent: false, headers }, response => {
    let text = ''
    response.setEncoding('utf8').on('data', chunk => { text += chunk }).on('end', () => resolve([response.statusCode, text && JSON.parse(text)]))
  }).on('error', reject).end(JSON.stringify(body))
})
// The Agent's browser_layout on a tab of a conversation's.
const layOut = async (session, tab, mode) => post(session, { mode, mark: await marked(tab) })
const unseen = [409, { error: 'The Sidebar browser did not see the page to lay out' }]
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
    if (path === '/never') return
    if (path === '/kept' && keptLoads++ > 0) return response.writeHead(204).end()
    if (path === '/cached.js') {
      cachedLoads++
      return response.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'max-age=3600' }).end(body)
    }
    const type = path.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8'
    const slow = ['/held', '/popup'].includes(path) ? 1000 : path === '/store' && request.headers.host.startsWith('a.') ? 500 : 0
    setTimeout(() => response.writeHead(body ? 200 : 404, { 'content-type': type }).end(body ?? ''), slow)
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  origin = `http://127.0.0.1:${server.address().port}`
  // On Windows, stdin does not reach Electron's main process and Electron writes
  // a blank line to stdout; Node's IPC channel works on every platform.
  app = spawn(electron, [fileURLToPath(new URL('./fixtures/sidebar-browser-app.mjs', import.meta.url))], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
  endpoint = await new Promise((resolve, reject) => {
    app.on('message', message => {
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
  assert.deepEqual((await screenshot(tab))[1], [[255, 255, 255, 255]])
  await tab.getByRole('link', { name: 'Second' }).click()
  await tab.waitForURL(`${origin}/second`)
  await tab.goBack()
  assert.equal(tab.url(), `${origin}/`)
  // target=_blank becomes another tab of the same conversation, handed out once it has loaded.
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

test('a new tab reaches the Agent once it shows its page', live, async () => {
  // Not the blank start the Sidebar navigates away from, while the page answers
  // slowly or something on it never finishes loading.
  const client = await socket(`${endpoint}/session-a`)
  const send = protocol(client)
  for (const path of ['/held', '/stalled']) {
    const { targetId } = await send('Target.createTarget', { url: `${origin}${path}` })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    assert.equal((await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, sessionId)).result.value, `${origin}${path}`)
    // Navigating before the Sidebar's own load ends is no failure.
    await send('Page.navigate', { url: `${origin}/second` }, sessionId)
    await wait(200)
    assert.equal(await page('document.querySelectorAll("[data-failed]").length'), 0)
    await send('Target.closeTarget', { targetId })
  }
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
  await browser.close()
})

test('hidden tabs, a collapsed Sidebar and a conversation in the background keep working', live, async () => {
  await opened('session-a', '/second')
  await page('fixture.focus("session-a", "tab2")')
  const { browser, context } = await connect('session-a')
  // The tab the user just opened reaches the Agent once its page loads, which may be after it connects.
  for (const deadline = Date.now() + 5000; context.pages().length < 2;) {
    assert.ok(Date.now() < deadline, 'the new tab reaches the Agent')
    await wait(50)
  }
  for (const tab of context.pages()) await greet(tab, 'hidden')
  // The Sidebar opened once for this connection; after the user collapses it, it stays collapsed.
  await page('fixture.expand("session-a", false)')
  for (const tab of context.pages()) await greet(tab, 'collapsed')
  assert.equal(await page('document.querySelector(".panel[data-sidebar-right-session=session-a]").hasAttribute("data-sidebar-right-open")'), false)
  await page('fixture.show("session-b")')
  for (const tab of context.pages()) await greet(tab, 'background')
  // The window and this conversation's tabs, which a covered window would stop otherwise; another conversation's tab rests.
  assert.equal(await throttled(), false)
  assert.deepEqual(await guestsThrottled(), [['/', false], ['/', false], ['/second', true]])
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
  // The Sidebar first loads a tab when the user sees it; until then a new page opens in the background.
  const background = await context.newPage()
  await greet(background, 'out of sight')
  assert.equal(await page('document.querySelectorAll("[data-sidebar-right-session=session-a] webview").length'), 2)
  assert.equal(await page('document.querySelectorAll("[data-eduwork-agent-background] webview").length'), 1)
  await browser.close()
  await wait(2000)
  assert.equal(await throttled(), true)
  assert.ok((await guestsThrottled()).every(([, value]) => value))
  assert.equal(await page('document.querySelectorAll("[data-eduwork-agent-render], [data-eduwork-agent-acting], [data-eduwork-agent-background]").length'), 0)
  await page('fixture.show("session-a"); fixture.expand("session-a", true)')
})

test('a conversation the desktop does not show, as one used from a phone, browses in background pages', live, async () => {
  await page('chat.value = "draft"; chat.focus()')
  const { browser, context } = await connect('session-c')
  assert.deepEqual(context.pages(), [])
  const tab = await context.newPage()
  await greet(tab, 'remote')
  await tab.getByLabel('Name').press('End')
  await tab.keyboard.type('!')
  assert.equal(await tab.inputValue('#name'), 'remote!')
  assert.deepEqual((await screenshot(tab))[1], [[255, 255, 255, 255]])
  // The Agent lays it out at desktop width and back as it does a Sidebar tab.
  assert.deepEqual([await layOut('session-c', tab, 'desktop'), await tab.evaluate(() => innerWidth)], [[200, { width: 1280, settled: true }], 1280])
  assert.deepEqual([await layOut('session-c', tab, 'sidebar'), await tab.evaluate(() => innerWidth)], [[200, { width: 576, settled: true }], 576])
  // In the storage of the conversation's Sidebar tabs, so with their logins.
  assert.equal(await page('fixture.storages.at(-1)'), 'storage-session-c')
  const [popup] = await Promise.all([context.waitForEvent('page'), tab.getByRole('link', { name: 'Popup' }).click()])
  await popup.waitForLoadState()
  assert.equal(await popup.title(), 'Popup')
  assert.equal(await page('document.querySelectorAll("[data-eduwork-agent-background] webview").length'), 2)
  assert.equal(await page('document.querySelectorAll("[data-sidebar-right-session=session-c]").length'), 0)
  assert.deepEqual(await page('[chat.value, document.activeElement.id]'), ['draft', 'chat'])
  await popup.close()
  assert.equal(await page('document.querySelectorAll("[data-eduwork-agent-background]").length'), 1)
  // Its pages go once its Agent has.
  await browser.close()
  await wait(200)
  assert.equal(await page('document.querySelectorAll("[data-eduwork-agent-background]").length'), 0)
})

test('a background page still opening when its Agent leaves is let go', live, async () => {
  await page('fixture.acquireDelay = 2000')
  const { browser, context } = await connect('session-d')
  const opening = context.newPage().catch(error => error)
  await wait(100)
  await browser.close()
  await opening
  await wait(2500)
  await page('fixture.acquireDelay = 0')
  assert.equal(await page('document.querySelectorAll("[data-eduwork-agent-background]").length'), 0)
  assert.deepEqual(await page('fixture.held()'), [])
})

test('the user only watches the tab the Agent acts on until its turn ends, asks them something or they stop it', live, async () => {
  const frame = 'document.querySelector("[data-sidebar-right-session=session-a] .cell:not([hidden]) webview")'
  // What a click in the middle of the page would reach.
  const reached = () => page(`(() => { const box = ${frame}.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2).tagName })()`)
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  await greet(tab, 'watched')
  assert.equal(await reached(), 'DIV')
  // The Agent asks the user, as to log in in the page, and waits on the answer;
  // while it waits on an approval, a call of another tool, the page stays its own.
  const event = (type, data) => page(`fixture.event("session-a", ${JSON.stringify({ type, data })})`)
  await event('tool/call', { callId: 'act', name: 'browser_act' })
  assert.equal(await reached(), 'DIV')
  await event('tool/result', { message: { toolCallId: 'act' } })
  await event('tool/call', { callId: 'ask', name: 'ask_user_question' })
  assert.equal(await reached(), 'WEBVIEW')
  await event('tool/result', { message: { toolCallId: 'ask' } })
  assert.equal(await reached(), 'DIV')
  // A question of an earlier turn is not waited on.
  await event('tool/call', { callId: 'earlier', name: 'ask_user_question' })
  await event('turn/start', {})
  assert.equal(await reached(), 'DIV')
  // The turn ends, as when the Agent asks the user to log in, and the user works in the page.
  await page('fixture.running("session-a", false)')
  assert.equal(await reached(), 'WEBVIEW')
  await page(`${frame}.focus()`)
  // The next turn takes the page back, with the focus in it.
  await page('fixture.running("session-a", true)')
  assert.equal(await reached(), 'DIV')
  assert.notEqual(await page('document.activeElement.tagName'), 'WEBVIEW')
  await greet(tab, 'again')
  await page('document.querySelector("[data-sidebar-right-session=session-a] [data-eduwork-agent-acting] button").click()')
  assert.deepEqual(await page('fixture.stopped'), ['session-a'])
  assert.equal(await reached(), 'WEBVIEW')
  await page('fixture.running("session-a", true)')
  await browser.close()
})

test('a press or key the user gives a page, in any of its frames, counts in the page before the Agent\'s next command, and the Agent\'s own do not', live, async () => {
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  // What browser_act's check before its first step compares with the count at its read.
  const count = () => tab.evaluate(() => document.__eduworkInput ?? 0)
  // The user's input reaches the guest without passing the Agent's endpoint.
  const guest = `webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL().endsWith('/frame?used'))`
  await tab.goto(`${origin}/?used`)
  await tab.getByLabel('Name').pressSequentially('ab')
  await tab.getByRole('button', { name: 'Greet' }).click()
  assert.equal(await count(), 0)
  await tab.goto(`${origin}/frame?used`)
  const field = tab.frameLocator('#inner').locator('#field')
  await field.click()
  await field.pressSequentially('ab')
  assert.equal(await count(), 0)
  // A press in the cross-site frame, while the application page is too busy to pass anything on.
  const box = await tab.locator('#inner').boundingBox()
  const busy = page('for (const end = Date.now() + 1500; Date.now() < end;);')
  await run(`for (const type of ['mousePressed', 'mouseReleased']) await ${guest}.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: ${box.x + 20}, y: ${box.y + 20}, button: 'left', clickCount: 1 })`)
  assert.equal(await count(), 1)
  await busy
  await run(`${guest}.sendInputEvent({ type: 'keyDown', keyCode: 'a' })`)
  assert.equal(await count(), 2)
  await browser.close()
})

test('a right click on a page opens the menu for what was clicked, and the Agent\'s opens none', live, async () => {
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  await tab.goto(`${origin}/`)
  await tab.goto(`${origin}/menu`)
  // The Agent's turn has ended: the user works in the page.
  await page('fixture.running("session-a", false)')
  const rightClick = selector => menuAt(tab.locator(selector))
  // What the clipboard holds once the page or the menu has written it.
  const clipboard = async (expected, read = 'clipboard.readText()') => {
    for (const deadline = Date.now() + 2000; ;) {
      const value = await run(`const { clipboard } = await import('electron'); return ${read}`)
      if (value === expected || Date.now() > deadline) return value
      await wait(100)
    }
  }
  await takesInput(tab.locator('#blank'))
  assert.deepEqual(await rightClick('#link'), [['在新标签页中打开链接', '在系统浏览器中打开链接', '复制链接地址']])
  await choose('复制链接地址')
  assert.equal(await clipboard(`${origin}/second`), `${origin}/second`)
  await rightClick('#link')
  await choose('在系统浏览器中打开链接')
  for (const deadline = Date.now() + 2000; !await run('return externals.length') && Date.now() < deadline;) await wait(50)
  assert.deepEqual(await run('return externals'), [`${origin}/second`])
  await rightClick('#link')
  const [opened] = await Promise.all([context.waitForEvent('page'), choose('在新标签页中打开链接')])
  await opened.waitForLoadState()
  assert.equal(opened.url(), `${origin}/second`)
  await opened.close()
  // The Sidebar shows the page again, as it does once the user closes the tab in front of it.
  await page(`fixture.focus('session-a', [...document.querySelectorAll('[data-sidebar-right-session=session-a] webview')]
    .find(frame => frame.getURL() === ${JSON.stringify(`${origin}/menu`)}).closest('[data-sidebar-right-tab]').getAttribute('data-sidebar-right-tab'))`)
  await takesInput(tab.locator('#blank'))
  // Links the page may not open, such as javascript:, show no link items; others can still be copied.
  assert.deepEqual(await rightClick('#script'), [['后退', '(前进)', '刷新', '-', '[ ] 按桌面宽度显示此网页', '-', '清除此网站的数据…']])
  assert.deepEqual(await rightClick('#mail'), [['复制链接地址']])
  // An image's pixels when the image has loaded and its frame is in the top document's process.
  assert.deepEqual(await rightClick('#broken'), [['(复制图片)', '复制图片地址']])
  const framed = tab.frames().find(frame => frame.url().endsWith('/framed')) ?? await tab.waitForEvent('framenavigated', frame => frame.url().endsWith('/framed'))
  await framed.waitForFunction(() => document.images[0]?.complete)
  assert.deepEqual(await rightClick('#framed'), [['(复制图片)', '复制图片地址']])
  assert.deepEqual(await rightClick('#image'), [['复制图片', '复制图片地址']])
  await choose('复制图片地址')
  assert.equal(await clipboard(`${origin}/image.svg`), `${origin}/image.svg`)
  await rightClick('#image')
  await choose('复制图片')
  assert.equal(await clipboard(true, `(await clipboard.read()).some(item => item.types.includes('image/png'))`), true)
  // Editing as in DSH's own menu, on what the field holds.
  await tab.$eval('#field', field => { field.focus(); field.select() })
  assert.deepEqual(await rightClick('#field'), [['(撤销)', '(重做)', '-', '剪切', '复制', '粘贴', '-', '全选']])
  await choose('剪切')
  await tab.waitForFunction(() => document.getElementById('field').value === '')
  assert.equal(await clipboard('draft'), 'draft')
  await rightClick('#field')
  await choose('撤销')
  await tab.waitForFunction(() => document.getElementById('field').value === 'draft')
  await tab.evaluate(() => getSelection().selectAllChildren(document.getElementById('text')))
  assert.deepEqual(await rightClick('#text'), [['复制']])
  await choose('复制')
  assert.equal(await clipboard('Selected words'), 'Selected words')
  assert.deepEqual(await rightClick('#blank'), [['后退', '(前进)', '刷新', '-', '[ ] 按桌面宽度显示此网页', '-', '清除此网站的数据…']])
  await choose('清除此网站的数据…')
  assert.deepEqual(await run('return clearings'), [`${origin}/menu`])
  await rightClick('#blank')
  await choose('后退')
  await tab.waitForURL(`${origin}/`)
  await tab.goForward()
  await tab.evaluate(() => { window.before = true })
  await rightClick('#blank')
  await Promise.all([tab.waitForEvent('load'), choose('刷新')])
  assert.equal(await tab.evaluate(() => window.before), undefined)
  // The Agent's right click opens the page's own menus and nothing on the user's screen.
  await page('fixture.running("session-a", true)')
  await tab.click('#link', { button: 'right', position: { x: 2, y: 2 } })
  await wait(300)
  assert.deepEqual(await shown(), [])
  await page('fixture.running("session-a", false)')
  assert.equal((await rightClick('#blank')).length, 1)
  // Nor do the menu keys it presses after the user's own press, in the page or in a cross-site frame,
  // whose keys do not pass the guest's own input events. Windows opens the page's menu on them.
  const keys = async (frame, names) => {
    const before = await frame.evaluate(() => window.menus ?? 0)
    await page('fixture.running("session-a", false)')
    await press(frame.locator('#field'), 'left', () => 4)
    await page('fixture.running("session-a", true)')
    await run('menus.length = 0')
    for (const name of names) await tab.keyboard.press(name)
    await wait(300)
    assert.deepEqual(await shown(), [])
    if (process.platform === 'win32') assert.equal(await frame.evaluate(() => window.menus) - before, names.length)
  }
  // Electron has no key name for the menu key, so the page's own frame gets it unnamed (sidebar-browser.mjs).
  await keys(tab.mainFrame(), ['Shift+F10'])
  await tab.goto(`${origin}/frame`)
  const inner = tab.frames().find(frame => frame.url().includes('/inner'))
  await inner.waitForSelector('#field')
  await keys(inner, ['Shift+F10', 'ContextMenu'])
  await browser.close()
})

test('clearing a website clears its sign-ins and storage on every subdomain the workspace loaded, wherever they were kept, and reloads its pages; clearing the workspace clears every website', live, async () => {
  const data = `await import(${JSON.stringify(new URL('../src/sidebar-browser-data.mjs', import.meta.url).href)})`
  // A website is what Chromium takes as one for cookies: from the public suffix list, its private entries too.
  assert.deepEqual(await run(`const { siteOf } = ${data}
    return Promise.all(['http://a.b.example.co.uk/', 'https://www.example.com/x', 'https://pages.github.io/', 'http://a.site1.test:8080/', 'http://127.0.0.1:8080/', 'http://localhost/', 'http://[::1]/'].map(siteOf))`),
  ['example.co.uk', 'example.com', 'pages.github.io', 'site1.test', '127.0.0.1', 'localhost', '::1'])
  const at = host => `http://${host}:${new URL(origin).port}`
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  await tab.goto(`${at('a.site1.test')}/store`)
  const other = await context.newPage()
  // The Sidebar's own new-tab page is no website's, so its menu has nothing to clear.
  const website = url => run(`return broker.website(webContents.getAllWebContents().find(guest => guest.getType() === 'webview' && guest.getURL() === ${JSON.stringify(url)}))`)
  const newTab = other.url()
  assert.equal(await website(newTab), false)
  // A broker that does not listen, as in the desktop's native smoke, has no new-tab page to tell apart.
  assert.deepEqual(await run(`const { createSidebarBrowser } = await import(${JSON.stringify(new URL('../src/sidebar-browser.mjs', import.meta.url).href)})
    const idle = createSidebarBrowser({ getWindow: () => window })
    return [${JSON.stringify(newTab)}, 'about:blank'].map(url => idle.website({ getURL: () => url }))`), [true, false])
  await other.goto(`${at('other.test')}/store`)
  assert.equal(await website(other.url()), true)
  const cookies = () => run('return (await webContents.getAllWebContents().find(guest => guest.getType() === "webview").session.cookies.get({})).map(cookie => cookie.name).sort()')
  // Each page's frames, the page's own first, by host; the other site's frame in each keeps its storage in a partition of that page's site.
  const frames = async page => {
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].every(frame => frame.contentDocument === null || frame.contentDocument.readyState === 'complete'))
    for (const deadline = Date.now() + 5000; page.frames().some(frame => frame.url() === 'about:blank' || frame.url() === '');) {
      assert.ok(Date.now() < deadline, 'the page\'s frames load')
      await wait(50)
    }
    return page.frames()
  }
  const kept = async page => [...await Promise.all((await frames(page)).map(frame => frame.evaluate(() => localStorage.getItem('kept')))), await page.evaluate(() => window.marker ?? null)]
  const keep = async () => {
    for (const page of [tab, other]) for (const frame of await frames(page)) await frame.evaluate(() => { localStorage.setItem('kept', location.hostname); window.marker = 'before' })
    await tab.evaluate(() => { document.cookie = 'host=1'; document.cookie = 'shared=1; domain=site1.test' })
    await other.evaluate(() => { document.cookie = 'other=1' })
    assert.deepEqual(await cookies(), ['host', 'other', 'shared'])
  }
  // The Agent clears through its conversation's endpoint, as browser_clear_data does.
  const clear = (body, { session = 'session-a', secret = endpoint.split('/').at(-1), headers = {} } = {}) => new Promise((resolve, reject) => {
    const url = `${endpoint.replace(/^ws:/u, 'http:').replace(/[0-9a-f]{48}$/u, secret)}/${session}/clear-data`
    request(url, { method: 'POST', agent: false, headers }, response => {
      let text = ''
      response.setEncoding('utf8').on('data', chunk => { text += chunk }).on('end', () => resolve([response.statusCode, text && JSON.parse(text)]))
    }).on('error', reject).end(typeof body === 'string' ? body : JSON.stringify(body))
  })
  await keep()
  assert.equal(cachedLoads, 1)
  assert.deepEqual(await clear({ scope: 'site', url: `${at('a.site1.test')}/store` }), [200, { site: 'site1.test' }])
  // The site's page has reloaded when the Agent hears back, though it answers slowly; the other site's has not.
  assert.equal(await tab.evaluate(() => window.marker ?? null), null)
  assert.deepEqual(await cookies(), ['other'])
  assert.deepEqual([await kept(tab), await kept(other)], [[null, null, 'other.test', null], ['other.test', 'other.test', null, 'before']])
  // A script the site's page loads from an origin of the site no page loaded comes anew.
  assert.equal(cachedLoads, 2)
  // So does one a page that was not reloaded left in the HTTP cache, for the next page that loads it.
  await run(`const { BrowserWindow, session } = await import('electron')
    const { createSidebarBrowserData } = ${data}
    const partition = session.fromPartition('sidebar-cache'), url = ${JSON.stringify(`${at('a.site1.test')}/store`)}
    const load = async () => { const window = new BrowserWindow({ show: false, webPreferences: { session: partition } }); await window.loadURL(url); return window }
    const pages = [await load()]
    await createSidebarBrowserData().clearSite(partition, url)
    pages.push(await load())
    for (const page of pages) page.destroy()`)
  assert.equal(cachedLoads, 4)
  // A tab laid out at desktop width alone keeps it as clearing reloads its page, and its menu still shows it; the other tab still follows the Sidebar.
  const narrow = await tabWidth()
  assert.deepEqual(await layOut('session-a', other, 'desktop'), [200, { width: 1280, settled: true }])
  await keep()
  assert.deepEqual(await clear({ scope: 'workspace' }), [200, {}])
  assert.deepEqual(await Promise.all([tab, other].map(page => page.evaluate(() => window.marker ?? null))), [null, null])
  assert.deepEqual(await layout(other, 1280), [1280, true])
  // So it does once the setting applies to every tab anew, from each tab's choice.
  await page('fixture.settingsChanged()')
  assert.deepEqual([await layout(other, 1280), await layout(tab, narrow)], [[1280, true], [narrow, true]])
  assert.deepEqual(await run(`menus.length = 0
    const guests = ${JSON.stringify([tab.url(), other.url()])}.map(url => webContents.getAllWebContents().find(guest => guest.getType() === 'webview' && guest.getURL() === url))
    guests[1].emit('context-menu', {}, { linkURL: '', srcURL: '', mediaType: 'none', isEditable: false, selectionText: '', editFlags: {}, x: 10, y: 10 })
    return [menus.at(-1)?.items.find(item => item.label === '按桌面宽度显示此网页')?.checked, guests.map(guest => broker.desktopWidth(guest))]`), [true, [false, true]])
  assert.deepEqual([await cookies(), await kept(tab), await kept(other)], [[], [null, null, null, null], [null, null, null, null]])
  assert.equal(cachedLoads, 5)
  // Only the Host, for a conversation with a page open, and for a website or the workspace.
  assert.deepEqual(await clear({ scope: 'workspace' }, { secret: '0'.repeat(48) }), [404, ''])
  assert.deepEqual(await clear({ scope: 'workspace' }, { headers: { origin: 'https://example.org' } }), [404, ''])
  assert.deepEqual(await clear({ scope: 'workspace' }, { session: 'session-without-pages' }), [409, { error: 'No page is open in the browser' }])
  assert.deepEqual(await clear({ scope: 'everything' }), [400, { error: 'scope is site or workspace' }])
  for (const url of ['about:blank', newTab, new URL(newTab).origin]) assert.deepEqual(await clear({ scope: 'site', url }), [400, { error: 'The page is no website\'s: there is no site to clear' }])
  assert.deepEqual(await clear(JSON.stringify({ scope: 'site', url: `${at('a.site1.test')}/${'页'.repeat(1400)}` })), [413, { error: 'The request is too large' }])
  // A page whose site answers its reload with no content keeps showing, and the clearing ends with it.
  await tab.goto(`${at('a.site1.test')}/kept`)
  const started = Date.now()
  assert.deepEqual(await clear({ scope: 'site', url: at('a.site1.test') }), [200, { site: 'site1.test' }])
  assert.ok(Date.now() - started < 5000)
  assert.equal(await tab.evaluate(() => document.title), 'Kept')
  // The user clears once they confirm, a website from its page's menu and everything from settings.
  await keep()
  const confirm = (response, call) => run(`const { dialog } = await import('electron')
    const show = dialog.showMessageBox, asked = []
    dialog.showMessageBox = async (_window, options) => { asked.push([options.message, options.buttons]); return { response: ${response} } }
    const locale = { id: 'zh-CN', messages: { cancel: '取消' } }
    try { const page = webContents.getAllWebContents().find(guest => guest.getType() === 'webview' && guest.getURL().startsWith(${JSON.stringify(at('a.site1.test'))}))
      return [await ${call}, asked] }
    finally { dialog.showMessageBox = show }`)
  assert.deepEqual(await confirm(1, 'broker.data.confirmSite(window, locale, page)'), [null, [['清除 site1.test 的数据？', ['清除', '取消']]]])
  assert.deepEqual(await confirm(1, 'broker.data.confirmAll(window, locale)'), [false, [['清除侧边栏浏览器的所有数据？', ['清除', '取消']]]])
  assert.deepEqual(await cookies(), ['host', 'other', 'shared'])
  await confirm(0, 'broker.data.confirmSite(window, locale, page)')
  assert.deepEqual(await cookies(), ['other'])
  // The workspaces DSH reserved, as the desktop bridge reports them.
  assert.deepEqual(await confirm(0, '(broker.data.reserved("sidebar-workspace"), broker.data.confirmAll(window, locale))'), [true, [['清除侧边栏浏览器的所有数据？', ['清除', '取消']]]])
  assert.deepEqual(await cookies(), [])
  await other.close()
  await browser.close()
})

test('a page lays out at the Sidebar\'s width, or at desktop width scaled down to fill a narrower tab as the user chooses for every page or for its tab', live, async () => {
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  await tab.goto(`${origin}/menu`)
  await page('fixture.running("session-a", false)')
  const second = await context.newPage()
  await second.goto(`${origin}/second`)
  const narrow = await tabWidth()
  assert.ok(narrow < 1280)
  // By default a page follows the Sidebar's width.
  assert.deepEqual([await layout(second, narrow), await layout(tab, narrow)], [[narrow, true], [narrow, true]])
  // The user's setting for every page. At desktop width, a tab DSH opens on an address loads its page at that width: the first the page sees.
  await page('fixture.desktopWidth(true)')
  const [first] = await Promise.all([context.waitForEvent('page'), opened('session-a', '/first')])
  assert.deepEqual(await widthsSeen(first), [1280])
  await first.close()
  assert.deepEqual([await layout(second, 1280), await layout(tab, 1280)], [[1280, true], [1280, true]])
  await page('fixture.desktopWidth(false)')
  assert.deepEqual([await layout(tab, narrow), await layout(second, narrow)], [[narrow, true], [narrow, true]])
  await page('fixture.desktopWidth(true)')
  assert.deepEqual(await layout(tab, 1280), [1280, true])
  // Their choice for one tab, from its menu, which the setting does not change.
  await takesInput(tab.locator('#blank'))
  assert.ok((await menuAt(tab.locator('#blank'))).at(-1).includes('[x] 按桌面宽度显示此网页'))
  await choose('按桌面宽度显示此网页')
  assert.deepEqual([await layout(tab, narrow), await layout(second, 1280)], [[narrow, true], [1280, true]])
  await page('fixture.desktopWidth(false)')
  assert.deepEqual([await layout(second, narrow), await layout(tab, narrow)], [[narrow, true], [narrow, true]])
  await takesInput(tab.locator('#blank'))
  assert.ok((await menuAt(tab.locator('#blank'))).at(-1).includes('[ ] 按桌面宽度显示此网页'))
  await choose('按桌面宽度显示此网页')
  assert.deepEqual([await layout(tab, 1280), await layout(second, narrow)], [[1280, true], [narrow, true]])
  await page('fixture.desktopWidth(true)')
  // As the user narrows the Sidebar, the page still shows over the whole tab.
  await page('document.body.style.gridTemplateColumns = "1fr 400px"')
  assert.equal(await tabWidth(), 400)
  assert.deepEqual(await layout(tab, 1280), [1280, true])
  // A tab as wide as a desktop or wider lays its page out at its own width.
  const size = await run('return window.getSize()')
  await run('window.setSize(1500, 800)')
  await page('document.body.style.gridTemplateColumns = "0 1fr"')
  const wide = await tabWidth()
  assert.ok(wide > 1280)
  assert.deepEqual([await layout(tab, wide), await page(`${frameOf(tab)}.style.transform`)], [[wide, true], ''])
  await page('document.body.style.gridTemplateColumns = ""')
  await run(`window.setSize(${size})`)
  assert.deepEqual(await layout(tab, 1280), [1280, true])
  // A guest DSH does not mark as a Sidebar page keeps its own width, and its menu has no width choice.
  await page(`(() => { const holder = document.createElement('div'); holder.id = 'unmarked'; holder.style.cssText = 'position: fixed; left: 0; top: 0; width: 400px; height: 300px; display: flex'
    const frame = document.createElement('webview'); frame.setAttribute('partition', 'sidebar-workspace'); frame.setAttribute('src', ${JSON.stringify(`${origin}/second?unmarked`)}); frame.style.flex = '1'
    holder.append(frame); document.body.append(holder) })()`)
  const unmarked = `webContents.getAllWebContents().find(guest => guest.getType() === 'webview' && guest.hostWebContents && guest.getURL() === ${JSON.stringify(`${origin}/second?unmarked`)})`
  for (const deadline = Date.now() + 5000; !await run(`const guest = ${unmarked}; return guest !== undefined && !guest.isLoading() && await guest.executeJavaScript('innerWidth') > 0`);) {
    assert.ok(Date.now() < deadline, 'the unmarked guest loads and has its size')
    await wait(50)
  }
  assert.deepEqual(await run(`const guest = ${unmarked}; menus.length = 0
    guest.emit('context-menu', {}, { linkURL: '', srcURL: '', mediaType: 'none', isEditable: false, selectionText: '', editFlags: {}, x: 10, y: 10 })
    return [await guest.executeJavaScript('innerWidth'), menus.at(-1).items.map(item => item.label ?? '-')]`), [400, ['后退', '前进', '刷新', '', '清除此网站的数据…']])
  await page('document.getElementById("unmarked").remove()')
  // Nor does Playwright's resizing, and the Agent is told what it and the user can do instead.
  const refusal = await tab.setViewportSize({ width: 800, height: 600 }).then(() => 'resized', error => error.message)
  for (const part of ['cannot be resized', 'dragging the Sidebar', 'at least 1280 px', 'Use browser_layout', 'Settings → General → Sidebar page width', 'Desktop width', 'Follow the Sidebar',
    'right-clicking a blank part', '"Show this page at desktop width"']) assert.ok(refusal.includes(part), `"${part}" in: ${refusal}`)
  // A closed tab, which goes with its guest element, is no longer followed.
  await page(`window.unfollowed = []; window.unobserve = ResizeObserver.prototype.unobserve
    ResizeObserver.prototype.unobserve = function (target) { unfollowed.push(target); return unobserve.call(this, target) }
    window.closedTab = ${frameOf(second)}.parentElement; null`)
  await second.close()
  for (const deadline = Date.now() + 3000; !await page('!closedTab.isConnected && unfollowed.includes(closedTab)');) {
    assert.ok(Date.now() < deadline, 'the closed tab is let go')
    await wait(50)
  }
  await page('ResizeObserver.prototype.unobserve = unobserve; null')
  await page('fixture.desktopWidth(false)')
  await browser.close()
})

test('the Agent lays the tab it acts on out at desktop width and back, that tab alone and without reloading it, and its clicks and screenshots follow', live, async () => {
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  await tab.goto(`${origin}/layout`)
  const other = await context.newPage()
  await other.goto(`${origin}/second?other`)
  const narrow = await tabWidth()
  // Whether each tab, this one, another of this conversation and another conversation's, shows its page at desktop width.
  const desktopWidths = () => run(`return ${JSON.stringify([tab.url(), other.url(), `${origin}/second`])}
    .map(url => broker.desktopWidth(webContents.getAllWebContents().find(guest => guest.getType() === 'webview' && guest.getURL() === url)))`)
  const front = () => page(`document.querySelector('[data-sidebar-right-session=session-a] .cell:not([hidden]) webview') === ${frameOf(tab)}`)
  const guest = `webContents.getAllWebContents().find(guest => guest.getType() === 'webview' && guest.getURL() === ${JSON.stringify(`${origin}/layout`)})`
  // Something typed but not submitted, and a mark a reload would take away, in a tab then out of sight.
  await tab.getByLabel('Draft').fill('unsent')
  await tab.evaluate(() => { window.kept = true })
  await other.bringToFront()
  assert.equal(await front(), false)
  // Only the page the Agent marked just before, in its own conversation, and only these two ways; a mark serves once.
  assert.deepEqual(await post('session-a', { mode: 'desktop', mark: '0'.repeat(32) }), unseen)
  const mark = await marked(tab)
  assert.deepEqual(await post('session-b', { mode: 'desktop', mark }), unseen)
  assert.deepEqual(await post('session-a', { mode: 'wide', mark }), [400, { error: 'mode is desktop or sidebar' }])
  assert.deepEqual(await post('session-a', { mode: 'desktop' }), [400, { error: 'mark is the one browser_layout had the page evaluate' }])
  // The tab comes forward, and its page lays out at the new width as the answer comes.
  assert.deepEqual(await post('session-a', { mode: 'desktop', mark }), [200, { width: 1280, settled: true }])
  assert.deepEqual(await post('session-a', { mode: 'sidebar', mark }), unseen)
  assert.deepEqual([await front(), await tab.evaluate(() => [innerWidth, document.getElementById('draft').value, window.kept]), await covers(tab)], [true, [1280, 'unsent', true], true])
  await tab.click('#wide')
  assert.equal(await tab.textContent('#clicks'), '1')
  // The red square shows where the page has it, near its right edge.
  assert.deepEqual((([width, pixels]) => [width, pixels.map(color)])(await screenshot(tab, [[1170, 80], [1200, 80]])), [1280, ['white', 'red']])
  // A page zoomed in lays out narrower, as the answer says.
  await run(`${guest}.setZoomFactor(1.25)`)
  assert.deepEqual(await layOut('session-a', tab, 'desktop'), [200, { width: 1024, settled: true }])
  await run(`${guest}.setZoomFactor(1)`)
  // That tab alone: the user's setting is as it was, and the conversation's other tab and another conversation's still follow the Sidebar,
  assert.equal(await page('fixture.width()'), false)
  assert.deepEqual(await desktopWidths(), [true, false, false])
  assert.deepEqual(await layout(other, narrow), [narrow, true])
  // as they do once the setting applies to every tab anew.
  await page('fixture.settingsChanged()')
  assert.deepEqual(await page(`[${frameOf(tab)}, ${frameOf(other)}].map(frame => frame.style.width)`), ['1280px', ''])
  // The user sees the Agent's choice in the page's menu, and can change it back.
  await page('fixture.running("session-a", false)')
  await page(`fixture.focus('session-a', ${frameOf(tab)}.closest('[data-sidebar-right-tab]').getAttribute('data-sidebar-right-tab'))`)
  await takesInput(tab.locator('#blank'))
  assert.ok((await menuAt(tab.locator('#blank'))).at(-1).includes('[x] 按桌面宽度显示此网页'))
  await choose('按桌面宽度显示此网页')
  assert.deepEqual(await layout(tab, narrow), [narrow, true])
  await page('fixture.running("session-a", true)')
  // And back at the Sidebar's width, which the Agent asks for again after laying it out at desktop width.
  assert.deepEqual(await layOut('session-a', tab, 'desktop'), [200, { width: 1280, settled: true }])
  assert.deepEqual(await layOut('session-a', tab, 'sidebar'), [200, { width: narrow, settled: true }])
  assert.deepEqual([await tab.evaluate(() => [innerWidth, document.getElementById('draft').value, window.kept]), await covers(tab)], [[narrow, 'unsent', true], true])
  assert.equal(await tab.isVisible('#wide'), false)
  await tab.click('#any')
  assert.equal(await tab.textContent('#clicks'), '2')
  assert.equal((await screenshot(tab))[0], narrow)
  assert.deepEqual(await layOut('session-a', tab, 'sidebar'), [200, { width: narrow, settled: true }])
  // The choice holds for the next page in the tab, which loads at that width: the first the page sees.
  assert.deepEqual(await layOut('session-a', tab, 'desktop'), [200, { width: 1280, settled: true }])
  await tab.goto(`${origin}/first`)
  assert.deepEqual(await widthsSeen(tab), [1280])
  // Once the user turns to another tab, the Agent's layout of the tab it acts on leaves the user's choice on screen, as its other actions there do.
  await page(`fixture.focus('session-a', ${frameOf(other)}.closest('[data-sidebar-right-tab]').getAttribute('data-sidebar-right-tab'))`)
  assert.deepEqual(await layOut('session-a', tab, 'sidebar'), [200, { width: narrow, settled: true }])
  assert.deepEqual([await front(), await desktopWidths()], [false, [false, false, false]])
  // A tab out of sight while the Agent rests and the user narrows the Sidebar lays out at the tab's width as it comes forward.
  // A mark from before the Agent rested no longer serves.
  const before = await marked(tab)
  const idleCount = () => run('return idleCounts.get("session-a") ?? 0')
  const untilIdle = await idleCount()
  await other.bringToFront()
  for (const deadline = Date.now() + 5000; await idleCount() === untilIdle;) {
    assert.ok(Date.now() < deadline, 'session-a sends idle')
    await wait(50)
  }
  assert.deepEqual(await post('session-a', { mode: 'sidebar', mark: before }), unseen)
  await page('document.body.style.gridTemplateColumns = "1fr 400px"')
  assert.deepEqual(await layOut('session-a', tab, 'sidebar'), [200, { width: 400, settled: true }])
  await page('document.body.style.gridTemplateColumns = ""')
  await other.close()
  await browser.close()
})

test('the Sidebar opens once the user sees the Agent at work, then stays as the user leaves it', live, async () => {
  const expanded = () => page('document.querySelector(".panel[data-sidebar-right-session=session-a]").hasAttribute("data-sidebar-right-open")')
  await page('fixture.expand("session-a", false); fixture.show("session-b")')
  const { browser, context } = await connect('session-a')
  const [tab] = context.pages()
  await greet(tab, 'unseen')
  assert.equal(await expanded(), false)
  // The user comes back while the Agent works on the same page.
  await page('fixture.show("session-a")')
  assert.equal(await expanded(), true)
  await page('fixture.expand("session-a", false)')
  await greet(tab, 'collapsed')
  await page('fixture.show("session-b"); fixture.show("session-a")')
  assert.equal(await expanded(), false)
  await browser.close()
  await page('fixture.expand("session-a", true)')
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
  const focusDeadline = Date.now() + 2000
  let activeId
  do {
    await wait(100)
    activeId = await page('document.activeElement.id')
  } while (activeId !== 'chat' && Date.now() < focusDeadline)
  assert.equal(activeId, 'chat')
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
  assert.deepEqual(await post('session-a', { mode: 'desktop' }, { origin: 'https://example.org' }), [404, ''])
  assert.deepEqual(await post('session-a', { mode: 'desktop' }, {}, endpoint.replace(/[0-9a-f]{48}$/u, '0'.repeat(48))), [404, ''])
  // A resumed conversation's new Agent replaces the previous connection.
  // Nothing the previous one asked for answers the new one or keeps it busy,
  // here a new tab the stalled application page has yet to open.
  const old = protocol(await socket(`${endpoint}/session-a`))
  const { targetInfos: [target] } = await old('Target.getTargets')
  const { sessionId: oldSession } = await old('Target.attachToTarget', { targetId: target.targetId, flatten: true })
  const mark = randomUUID().replaceAll('-', '')
  await old('Runtime.evaluate', { expression: `'eduwork-layout:${mark}'` }, oldSession)
  await run('void window.webContents.executeJavaScript("for (const end = Date.now() + 3500; Date.now() < end;);")')
  await wait(100)
  const stale = [old('Runtime.evaluate', { expression: 'new Promise(resolve => setTimeout(resolve, 500))', awaitPromise: true }, oldSession), old('Target.createTarget', { url: 'about:blank' })]
  await wait(100)
  const client = await socket(`${endpoint}/session-a`)
  const received = []
  client.on('message', data => received.push(JSON.parse(data)))
  for (const request of stale) await assert.rejects(request)
  assert.deepEqual(await post('session-a', { mode: 'desktop', mark }), unseen)
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
