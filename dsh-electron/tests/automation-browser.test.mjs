// The built desktop shell as Playwright's and Remotion's Chromium. The Electron
// checks need EDUWORK_TEST_ELECTRON (executable), EDUWORK_TEST_NATIVE_SHELL
// (built shell) and EDUWORK_TEST_RUNTIME (pinned Runtime with playwright-core).
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const stubs = {
  electron: 'export const app = {}, BrowserWindow = {}, dialog = {}, Menu = {}, session = {}',
  ws: 'export class WebSocketServer {}',
}
registerHooks({ resolve(specifier, context, next) {
  return stubs[specifier] ? { url: `data:text/javascript,${stubs[specifier]}`, shortCircuit: true } : next(specifier, context)
} })
const { automationBrowserMode, chromeUserAgent } = await import('../src/automation-browser.mjs')

test('only automation clients start the desktop executable as a browser', () => {
  const line = (...names) => ({ hasSwitch: name => names.includes(name) })
  assert.equal(automationBrowserMode(line('remote-debugging-pipe', 'headless')), 'pipe')
  assert.equal(automationBrowserMode(line('remote-debugging-port', 'enable-automation')), 'websocket')
  // A bare port is a developer inspecting the desktop itself.
  assert.equal(automationBrowserMode(line('remote-debugging-port')), undefined)
  assert.equal(automationBrowserMode(line()), undefined)
})

test('pages see Chrome\'s reduced user agent', () => {
  const tail = 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
  assert.equal(chromeUserAgent('darwin', '152.0.7977.54'), `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ${tail}`)
  assert.equal(chromeUserAgent('win32', '152.0.7977.54'), `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${tail}`)
})

const electron = process.env.EDUWORK_TEST_ELECTRON, shell = process.env.EDUWORK_TEST_NATIVE_SHELL, runtime = process.env.EDUWORK_TEST_RUNTIME
const skip = !(electron && shell && runtime)
// A browser that stops answering must fail the job, not hold its runner.
const live = { skip, timeout: 120_000 }
const playwright = () => createRequire(join(runtime, 'package.json'))('playwright-core').chromium
const pages = {
  '/': '<title>Home</title><p>body text</p><iframe src="/frame"></iframe><button id="popup" onclick="window.open(\'/popup\')">sign in</button><a id="file" href="/file">file</a>',
  '/frame': '<p>inside frame</p>',
  '/popup': '<title>Popup</title>',
  '/set': '<title>set</title>',
  '/read': '<script>document.write(document.cookie)</script>',
  '/file': 'file body',
}
async function site(t) {
  const server = createServer((request, response) => {
    const headers = { 'content-type': 'text/html; charset=utf-8', ...request.url === '/set' ? { 'set-cookie': 'login=kept; Max-Age=86400; Path=/' } : {},
      ...request.url === '/file' ? { 'content-disposition': 'attachment; filename="file.txt"' } : {} }
    response.writeHead(pages[request.url] ? 200 : 404, headers).end(pages[request.url] ?? '')
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}
const scratch = []
after(() => Promise.all(scratch.map(directory => rm(directory, { recursive: true, force: true, maxRetries: 10 }))))
const temporary = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eduwork-automation-'))
  scratch.push(directory)
  return directory
}
const profile = () => temporary()
// Electron loads resources/app before its default app, as the packaged product
// does. Automation clients pass no app path, so the shell must sit there.
let packaged
const desktop = () => packaged ??= (async () => {
  const mac = process.platform === 'darwin'
  const root = mac ? resolve(electron, '../../..') : dirname(electron)
  const copy = join(await temporary(), basename(root))
  await cp(root, copy, { recursive: true, verbatimSymlinks: true })
  await symlink(resolve(shell), join(copy, mac ? 'Contents/Resources/app' : 'resources/app'), 'junction')
  return mac ? join(copy, 'Contents/MacOS', basename(electron)) : join(copy, basename(electron))
})()

test('Playwright drives the built shell over its debugging pipe', live, async t => {
  const origin = await site(t)
  const browser = await playwright().launch({ executablePath: await desktop(), headless: true })
  t.after(() => browser.close())
  assert.match(browser.version(), /^\d+\.\d+\.\d+\.\d+$/u)
  // Each page gets its own browser context, as search and Studio exports do.
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  await page.goto(origin + '/')
  assert.equal(await page.title(), 'Home')
  assert.doesNotMatch(await page.evaluate(() => navigator.userAgent), /Electron|eduwork|HeadlessChrome/i)
  assert.equal(await page.frameLocator('iframe').locator('p').innerText(), 'inside frame')
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#popup')])
  await popup.waitForLoadState()
  assert.equal(await popup.title(), 'Popup')
  // Sign-in popups report back through their opener.
  assert.equal(await popup.opener(), page)
  assert.equal(await popup.evaluate(() => window.opener !== null), true)
  assert.deepEqual([...(await page.screenshot({ fullPage: true })).subarray(1, 4)], [...Buffer.from('PNG')])
  assert.equal((await page.pdf({ format: 'A4' })).subarray(0, 5).toString(), '%PDF-')
  assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied')
  // Chrome answers null when the client dismisses the dialog, as Playwright does by default.
  assert.equal(await page.evaluate(() => prompt('name')), null)
  const second = await browser.newPage()
  assert.notEqual(second.context(), page.context())
})

test('downloads follow the client\'s choice', live, async t => {
  const origin = await site(t)
  const browser = await playwright().launch({ executablePath: await desktop(), headless: true })
  t.after(() => browser.close())
  for (const acceptDownloads of [false, true]) {
    const page = await browser.newPage({ acceptDownloads })
    await page.goto(origin + '/')
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#file')])
    assert.equal(download.suggestedFilename(), 'file.txt')
    if (acceptDownloads) assert.equal(await readFile(await download.path(), 'utf8'), 'file body')
    else assert.match(await download.failure(), /acceptDownloads/u)
  }
})

test('a persistent profile keeps its sign-in across launches', live, async t => {
  const origin = await site(t), directory = await profile(), executablePath = await desktop()
  const launch = () => playwright().launchPersistentContext(directory, { executablePath, headless: true })
  let context = await launch()
  await context.pages()[0].goto(origin + '/set')
  await context.close()
  context = await launch()
  t.after(() => context.close())
  const page = context.pages()[0]
  await page.goto(origin + '/read')
  assert.equal(await page.locator('body').innerText(), 'login=kept')
})

test('Remotion reaches one client through a token-protected loopback endpoint', live, async t => {
  const child = spawn(await desktop(), ['--enable-automation', '--remote-debugging-port=0', '--headless=new', `--user-data-dir=${await profile()}`], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  const exited = once(child, 'exit')
  t.after(() => { child.kill(); return exited })
  let log = ''
  const endpoint = await new Promise((resolve, reject) => {
    child.stderr.on('data', chunk => { log += chunk; const match = /DevTools listening on (ws:\/\/\S+)/.exec(log); if (match) resolve(match[1]) })
    child.once('exit', code => reject(new Error(`Browser exited with ${code}: ${log}`)))
  })
  assert.equal(new URL(endpoint).hostname, '127.0.0.1')
  const connect = url => new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.onopen = () => resolve(socket)
    socket.onerror = () => reject(new Error('refused'))
  })
  await assert.rejects(connect(endpoint.replace(/[^/]+$/u, 'guessed')))
  const socket = await connect(endpoint)
  const replies = new Map(), events = []
  let next = 0
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data)
    if (message.id === undefined) events.push(message)
    else replies.get(message.id)(message)
  }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++next
    replies.set(id, message => message.error ? reject(new Error(message.error.message)) : resolve(message.result))
    socket.send(JSON.stringify({ id, method, params, ...sessionId ? { sessionId } : {} }))
  })
  await send('Target.setDiscoverTargets', { discover: true })
  assert.ok(events.some(event => event.method === 'Target.targetCreated'), 'the startup page is announced')
  await assert.rejects(connect(endpoint), 'a second client is refused')
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.navigate', { url: 'data:text/html,<title>frame</title><body style="background:%23c00">' }, sessionId)
  const { result } = await send('Runtime.evaluate', { expression: 'new Promise(r => document.readyState === "complete" ? r(document.title) : addEventListener("load", () => r(document.title)))', awaitPromise: true }, sessionId)
  assert.equal(result.value, 'frame')
  const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  assert.equal(Buffer.from(data, 'base64').subarray(1, 4).toString(), 'PNG')
  await send('Browser.close').catch(() => {})
  await exited
})
