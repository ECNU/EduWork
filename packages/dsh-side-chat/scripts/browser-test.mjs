import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const { values } = parseArgs({ options: { product: { type: 'string' }, output: { type: 'string' }, desktop: { type: 'string' } } })
if (!values.product || !values.output) throw new Error('Use --product <experimental product> --output <new private evidence directory>')
const product = resolve(values.product), output = resolve(values.output)
await mkdir(output)
await mkdir(join(output, 'screenshots'))
const result = { schemaVersion: 1, kind: 'side-chat-browser-acceptance', synthetic: true, externalModelRequests: 0, checks: [], browserErrors: [], passed: false }
const configPath = join(output, 'web.private.json')
let browser, desktopApp, page, base, cookie, url, started = false
const redact = text => String(text).replace(/([?&]token=)[^\s&"']+/g, '$1[redacted]')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
async function waitFor(operation, message, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let last
  do { try { const value = await operation(); if (value) return value } catch (error) { last = error }
    await delay(100)
  } while (Date.now() < deadline)
  throw new Error(`${message}${last ? ': ' + last.message : ''}`)
}
async function lifecycle(action) {
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(repository, 'scripts/dev-eduwork-web.mjs'), action, configPath], { cwd: repository, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = ''
    child.stdout.on('data', data => { text += data }); child.stderr.on('data', data => { text += data })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? accept() : reject(new Error(`Host ${action} failed: ${redact(text).slice(-1600)}`)))
  })
}
async function rpc(endpoint, args = {}) {
  const body = JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } })
  if (desktopApp) {
    const { ok, envelope } = await page.evaluate(async ({ endpoint, body }) => {
      const response = await fetch(`api/${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      return { ok: response.ok, envelope: await response.json() }
    }, { endpoint, body })
    assert.equal(ok && envelope.result?.ok === true, true, `${endpoint}: ${JSON.stringify(envelope.result?.error)}`)
    return envelope.result.value
  }
  const response = await fetch(`${base}/api/${endpoint}`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
    body })
  const envelope = await response.json()
  assert.equal(response.ok && envelope.result?.ok === true, true, `${endpoint}: ${JSON.stringify(envelope.result?.error)}`)
  return envelope.result.value
}
async function authenticate() {
  url = await waitFor(async () => (await readFile(join(output, 'logs/url.txt'), 'utf8')).trim(), 'Host did not announce its local URL')
  base = new URL(url).origin
  const response = await fetch(url, { redirect: 'manual' })
  cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie)
}
async function check(name, operation) {
  await operation()
  result.checks.push({ name, passed: true })
  console.log(`PASS ${name}`)
}
const trace = async () => (await readFile(join(output, 'model-trace.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
async function dismissOnboarding() {
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).waitFor({ timeout: 120_000 })
  for (let attempt = 0; attempt < 8; attempt++) {
    for (const name of [/^(继续|Continue)$/, /^(稍后配置|Configure later|Maybe later)$/, /^(使用其他模型|Use another model)$/]) {
      const button = page.getByRole('button', { name }).last()
      if (await button.isVisible() && await button.isEnabled()) await button.click()
    }
    await delay(200)
  }
}
async function askSide(text) {
  const editor = page.locator('[data-eduwork-side-chat] [contenteditable="true"]')
  await editor.fill(text)
  await editor.press('Enter')
}

try {
  const identity = await json(join(product, 'assembly.json'))
  assert.equal(identity.experimental, true)
  assert.equal(identity.runtimeMode, 'experimental-side-chat')
  result.version = identity.version
  const socket = createServer()
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  const fixture = join(output, 'model-fixture')
  await mkdir(fixture)
  const require = createRequire(join(product, 'd/package.json'))
  const fixtureSource = await readFile(join(repository, 'packages/dsh-side-chat/test/browser-model.mjs'), 'utf8')
  await writeFile(join(fixture, 'index.mjs'), fixtureSource.replace("'@deepseek-ai/dsh-llm'", JSON.stringify(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href)))
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: '@eduwork/side-chat-test-model', version: '0.0.0', type: 'module', main: 'index.mjs' }))
  const home = join(output, 'home'), isolatedOSHome = join(output, 'os-home')
  await mkdir(isolatedOSHome)
  const privateConfig = {
    assembly: product, home, logs: join(output, 'logs'), node: process.execPath, port,
    profileName: 'side-chat-acceptance', environment: { HOME: isolatedOSHome, USERPROFILE: isolatedOSHome },
    patches: [
      { id: 'agent-default-model', config: { provider: 'side-fixture', model: 'fixture' } },
      { insert: [{ id: 'side-chat-model-fixture', name: pathToFileURL(join(fixture, 'index.mjs')).href, config: { output: join(output, 'model-trace.jsonl') } }] },
    ],
  }
  await writeFile(configPath, JSON.stringify(privateConfig, null, 2))
  const { chromium, _electron } = require('playwright-core')
  if (values.desktop) {
    const userConfig = join(output, 'eduwork.jsonc')
    const defaultConfiguration = await readFile(join(product, 'resources/desktop/eduwork.jsonc'), 'utf8')
    assert.equal(JSON.parse(defaultConfiguration).updates.provider, 'disabled')
    await writeFile(userConfig, defaultConfiguration)
    desktopApp = await _electron.launch({ executablePath: resolve(values.desktop), timeout: 120_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, EDUWORK_DESKTOP_TEST_DATA_ROOT: join(output, 'desktop-data'),
        EDUWORK_CONFIG_FILE: userConfig, EDUWORK_DESKTOP_PRIVATE_CONFIG: configPath, HOME: isolatedOSHome, USERPROFILE: isolatedOSHome } })
    page = await waitFor(() => desktopApp.windows().find(window => window.url().startsWith('dsh-app://app/')), 'Packaged Electron did not open the actual product page', 120_000)
    page.setDefaultTimeout(20_000)
    page.on('pageerror', error => result.browserErrors.push(redact(error.message)))
    await dismissOnboarding()
    result.kind = 'side-chat-packaged-electron-acceptance'
    result.electron = await desktopApp.evaluate(() => process.versions.electron)
  } else {
    started = true; await lifecycle('start')
    await authenticate()
    await check('owner-only-side-chat-route', async () => {
    const response = await fetch(`${base}/api/eduwork/side-chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'open' }) })
    assert.equal(response.ok, false)
    })
  }
  await waitFor(async () => {
    const catalog = await rpc('session/modelCatalog')
    await writeFile(join(output, 'model-catalog.json'), JSON.stringify(catalog, null, 2))
    return catalog.groups.some(group => group.id === 'side-fixture')
  }, 'Scripted model did not enter the actual Host catalog')
  const workspacePath = join(output, 'synthetic-workspace')
  await mkdir(workspacePath)
  await writeFile(join(workspacePath, 'fixture.txt'), 'Synthetic attachment/reference content.\n')
  const workspace = (await rpc('workspace/create', { request: { path: workspacePath } })).workspace
  const main = await rpc('session/create', { request: { workspaceId: workspace.workspaceId } })
  await rpc('session/rename', { request: { sessionId: main.sessionId, title: 'Side chat acceptance' } })
  const prompt = text => rpc('session/prompt', { request: { sessionId: main.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } })
  await prompt('SOURCE_FIRST')
  await waitFor(async () => (await trace()).some(row => row.marker === 'SOURCE_FIRST'), 'First main request did not reach the scripted adapter')
  await prompt('SOURCE_FUTURE')
  await waitFor(async () => (await trace()).some(row => row.marker === 'SOURCE_FUTURE'), 'Second main request did not reach the scripted adapter')
  if (!desktopApp) {
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) })
    page = await browser.newPage({ viewport: { width: 1500, height: 980 }, locale: 'zh-CN' })
    page.setDefaultTimeout(15_000)
    page.on('pageerror', error => result.browserErrors.push(redact(error.message)))
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await dismissOnboarding()
  }
  const sourceTitle = page.getByText('Side chat acceptance', { exact: true }).first()
  if (!await sourceTitle.isVisible()) await page.getByText('synthetic-workspace', { exact: true }).first().click()
  await sourceTitle.click()
  await page.getByText('SOURCE_FUTURE_REPLY', { exact: true }).first().waitFor()
  const sideAction = () => page.getByRole('button', { name: /^(开启侧边聊天|Open side chat)$/ })
  let sideId
  await check('open-from-earlier-user-message', async () => {
    assert.ok(await sideAction().count() >= 4, 'Both user and assistant messages require actions')
    const response = page.waitForResponse(response => response.url().includes('/api/eduwork/side-chat') && response.request().postDataJSON()?.action === 'open')
    await sideAction().first().click()
    const reply = await (await response).json()
    assert.ok(reply.sessionId?.startsWith('side-'))
    sideId = reply.sessionId
    await page.locator('[data-eduwork-side-chat]').waitFor()
    assert.equal(await page.locator('[data-eduwork-side-chat]').getByText('SOURCE_FIRST', { exact: true }).count(), 0, 'new side chat must not display inherited records')
    assert.equal(await page.locator('[data-eduwork-side-chat]').getByText('SOURCE_FIRST_REPLY', { exact: true }).count(), 0)
    await askSide('SIDE_QUESTION')
    await page.locator('[data-eduwork-side-chat]').getByText('SCRIPTED_SIDE_REPLY', { exact: true }).waitFor()
    const model = (await trace()).find(row => row.marker === 'SIDE_QUESTION')
    assert.equal(model.inheritedReference, true)
    assert.equal(model.inheritedFuture, false)
    assert.equal(model.sideBoundary, true)
    await page.screenshot({ path: join(output, 'screenshots/side-chat.png'), fullPage: true })
  })
  await check('temporary-chat-outside-lists-and-browser-storage', async () => {
    const list = await rpc('session/list', { _request: {} })
    assert.equal(list.items.some(item => item.sessionId === sideId), false)
    const storage = await page.evaluate(() => Object.entries(localStorage))
    assert.equal(storage.some(([key, value]) => key.includes('side-') || value.includes(sideId)), false)
  })
  await check('collapse-preserves-the-chat', async () => {
    await page.getByRole('button', { name: /^(收起右侧边栏|Collapse right sidebar)$/ }).click()
    await page.getByRole('button', { name: /^(打开右侧边栏|Open right sidebar)$/ }).click()
    await page.locator('[data-eduwork-side-chat]').getByText('SCRIPTED_SIDE_REPLY', { exact: true }).waitFor()
  })
  await check('main-session-navigation-preserves-the-side-snapshot', async () => {
    const other = await rpc('session/create', { request: { workspaceId: workspace.workspaceId } })
    await rpc('session/rename', { request: { sessionId: other.sessionId, title: 'Other synthetic conversation' } })
    await rpc('session/prompt', { request: { sessionId: other.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'MAIN_PARALLEL' }] } })
    await waitFor(async () => (await trace()).some(row => row.marker === 'MAIN_PARALLEL'), 'Other main conversation did not run')
    await page.getByText('Other synthetic conversation', { exact: true }).first().click()
    await page.locator('[data-eduwork-side-chat]').waitFor({ state: 'hidden' })
    await sourceTitle.click()
    await page.locator('[data-eduwork-side-chat]').getByText('SCRIPTED_SIDE_REPLY', { exact: true }).waitFor()
    const sideRequests = (await trace()).filter(row => row.kind === 'request' && row.marker === 'SIDE_QUESTION')
    assert.equal(sideRequests.length, 1, 'navigation must not replay a side request')
  })
  if (desktopApp) await check('hide-and-show-native-window-preserves-side-chat', async () => {
    await desktopApp.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('dsh-app://app/')); window.hide(); window.show() })
    await page.locator('[data-eduwork-side-chat]').getByText('SCRIPTED_SIDE_REPLY', { exact: true }).waitFor()
  })
  await check('close-stops-streaming-and-does-not-touch-source', async () => {
    await askSide('SIDE_HANG')
    await page.locator('[data-eduwork-side-chat]').getByText('SIDE_STREAM_PARTIAL', { exact: true }).waitFor()
    await page.getByRole('button', { name: /^(关闭侧聊|Close side chat)$/ }).click()
    await page.locator('[data-eduwork-side-chat]').waitFor({ state: 'detached' })
    await waitFor(async () => (await trace()).some(row => row.kind === 'aborted' && row.marker === 'SIDE_HANG'), 'Closing did not cancel the actual Agent model stream')
    await page.getByText('SOURCE_FUTURE_REPLY', { exact: true }).waitFor()
  })
  await check('refresh-does-not-restore-a-side-chat', async () => {
    await sideAction().nth(1).click()
    await page.locator('[data-eduwork-side-chat]').waitFor()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dismissOnboarding()
    await page.getByText('SOURCE_FUTURE_REPLY', { exact: true }).first().waitFor()
    assert.equal(await page.locator('[data-eduwork-side-chat]').count(), 0)
  })
  assert.deepEqual(result.browserErrors, [])
  result.passed = true
} catch (error) {
  result.error = redact(error.stack)
  console.error(redact(error.message))
  if (page) {
    await page.screenshot({ path: join(output, 'screenshots/failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(output, 'page.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable'))
  }
  process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  if (desktopApp) {
    // The fixture owns this isolated app and all its synthetic tasks. Confirm
    // its native quit prompt without leaving an unattended OS modal open.
    await desktopApp.evaluate(({ dialog }) => {
      globalThis.__sideChatQuitPrompts = []
      dialog.showMessageBox = async options => {
        globalThis.__sideChatQuitPrompts.push(options.message)
        return { response: 0, checkboxChecked: false }
      }
    }).catch(() => {})
    await desktopApp.close({ timeout: 30_000 }).catch(error => { result.cleanupError = redact(error.message); result.passed = false; process.exitCode = 1 })
    const updaterState = join(dirname(resolve(values.desktop)), 'data/state/updates/electron-edition.json')
    const updaterStarted = await readFile(updaterState).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
    result.softwareUpdateBackendStarted = updaterStarted
    if (updaterStarted) { result.passed = false; result.cleanupError = 'Experimental default unexpectedly started the software updater'; process.exitCode = 1 }
  }
  if (started) await lifecycle('stop').catch(error => { result.cleanupError = redact(error.message); result.passed = false; process.exitCode = 1 })
  result.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, browserErrors: result.browserErrors.length }))
}
