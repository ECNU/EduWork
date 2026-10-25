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
const { values } = parseArgs({ options: { product: { type: 'string' }, output: { type: 'string' }, desktop: { type: 'string' }, 'appearance-only': { type: 'boolean', default: false } } })
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
  if (values['appearance-only'] && !['message-side-actions-match-adjacent-native-buttons', 'selection-toolbar-preserves-normal-annotation'].includes(name)) return
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

async function selectSourceReply(text = 'SOURCE_FIRST_REPLY') {
  const reply = page.getByText(text, { exact: true }).first()
  await reply.scrollIntoViewIfNeeded()
  // A real selection first transfers focus away from the side composer.
  // Updating only document.Selection leaves its old focus intact and misses
  // the native blur/focus restoration race.
  await reply.click()
  await reply.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = document.getSelection()
    selection.removeAllRanges(); selection.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
  const toolbar = page.locator('[data-eduwork-selection-toolbar]')
  await toolbar.waitFor()
  return toolbar
}

const closeSide = () => page.locator('[data-dockkit-tab]:visible').filter({ hasText: /^(侧边聊天|Side chat)$/ }).locator('[data-dockkit-tab-close]').click()

async function assertComposerAlignment() {
  await waitFor(async () => page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-composer-card]')].filter(node => node.getBoundingClientRect().height > 0)
    const side = cards.find(node => node.closest('[data-eduwork-side-chat]'))
    const main = cards.find(node => !node.closest('[data-eduwork-side-chat]'))
    return side && main && Math.abs(side.getBoundingClientRect().bottom - main.getBoundingClientRect().bottom) <= 1
  }), 'Main and side composer cards do not share a bottom baseline')
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
  await check('message-side-actions-match-adjacent-native-buttons', async () => {
    const inspect = () => page.locator('[data-eduwork-side-action]').evaluateAll(buttons => buttons.map(button => {
      const group = button.closest('[data-clock]')
      const copy = group.querySelector('button:not([data-eduwork-side-action])')
      const read = element => {
        const css = getComputedStyle(element), rect = element.getBoundingClientRect(), icon = element.querySelector('svg').getBoundingClientRect()
        return { color: css.color, width: rect.width, height: rect.height, top: rect.top, iconWidth: icon.width, iconHeight: icon.height, display: css.display, alignItems: css.alignItems }
      }
      return { clock: group.dataset.clock, side: read(button), copy: read(copy) }
    }))
    const verify = async () => {
      const rows = await inspect()
      assert.ok(rows.some(row => row.clock === 'start') && rows.some(row => row.clock === 'end'), 'verify both user and assistant actions')
      for (const row of rows) assert.deepEqual(row.side, row.copy)
    }
    await verify()
    const scale = await page.addStyleTag({ content: '[data-clock]{--dsh-content-font-delta:3px!important}' })
    await verify()
    await scale.evaluate(node => node.remove())
    for (const clock of ['start', 'end']) {
      const side = page.locator(`[data-clock="${clock}"] [data-eduwork-side-action]:visible`).last()
      const copy = side.locator('xpath=ancestor::*[@data-clock][1]').locator('button:not([data-eduwork-side-action])').first()
      await side.hover()
      const color = await side.evaluate(element => getComputedStyle(element).color)
      await copy.hover()
      assert.equal(await copy.evaluate(element => getComputedStyle(element).color), color, 'hover colors must match')
    }
    await page.mouse.move(10, 10)
    await page.screenshot({ path: join(output, 'screenshots/message-actions.png'), fullPage: true })
  })
  await check('open-from-earlier-user-message', async () => {
    const response = page.waitForResponse(response => response.url().includes('/api/eduwork/side-chat') && response.request().postDataJSON()?.action === 'open')
    await page.getByText('SOURCE_FIRST', { exact: true }).first().hover()
    await sideAction().first().waitFor()
    await sideAction().first().click()
    const reply = await (await response).json()
    assert.ok(reply.sessionId?.startsWith('side-'))
    sideId = reply.sessionId
    await page.locator('[data-eduwork-side-chat]').waitFor()
    assert.equal(await page.locator('[data-eduwork-side-chat]').getByText('SOURCE_FIRST', { exact: true }).count(), 0, 'new side chat must not display inherited records')
    assert.equal(await page.locator('[data-eduwork-side-chat]').getByText('SOURCE_FIRST_REPLY', { exact: true }).count(), 0)
    const side = page.locator('[data-eduwork-side-chat]')
    await side.getByText('侧边聊天是临时聊天，关闭后会消失', { exact: true }).waitFor()
    assert.equal(await side.getByText('关闭后丢弃').count(), 0)
    assert.equal(await side.getByRole('button', { name: /返回|关闭侧聊|Return|Close side chat/ }).count(), 0)
    const pane = await side.boundingBox(), composer = await side.locator('[data-composer-seat]').boundingBox()
    assert.ok(composer.y > pane.y + pane.height / 2, 'empty composer should sit at the bottom')
    assert.ok(pane.y + pane.height - composer.y - composer.height < 32, 'empty composer should align with pane bottom')
    await assertComposerAlignment()
    // Exercise conditional footer content without changing either session's
    // transcript: native pills disappearing must release the shared space.
    const hiddenFooters = await page.addStyleTag({ content: '[data-composer-dock] > * { display:none !important }' })
    await assertComposerAlignment()
    await waitFor(() => page.locator('[data-composer-dock]').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height <= 5)), 'Empty footers did not release their clearance')
    await hiddenFooters.evaluate(node => node.remove())
    await assertComposerAlignment()
    await page.screenshot({ path: join(output, 'screenshots/side-empty.png'), fullPage: true })
    if (!desktopApp) {
      await page.setViewportSize({ width: 1200, height: 640 })
      await assertComposerAlignment()
      const smallPane = await side.boundingBox(), smallComposer = await side.locator('[data-composer-seat]').boundingBox()
      assert.ok(smallPane.y + smallPane.height - smallComposer.y - smallComposer.height < 32)
      assert.ok(smallComposer.y > smallPane.y + smallPane.height / 2)
      await page.screenshot({ path: join(output, 'screenshots/side-empty-short.png'), fullPage: true })
      await page.setViewportSize({ width: 1500, height: 980 })
    }
    await check('native-side-chat-notice-is-compact-transient-and-dismissible', async () => {
      const trigger = async () => {
        await page.getByText('SOURCE_FUTURE', { exact: true }).first().hover()
        await sideAction().last().click()
      }
      const notice = page.getByRole('alert').filter({ hasText: '已有侧聊。请先关闭，再从这里开启。' })
      await trigger()
      await notice.waitFor()
      const style = await notice.evaluate(element => {
        const css = getComputedStyle(element), rect = element.getBoundingClientRect()
        return { fontSize: css.fontSize, height: rect.height, top: rect.top }
      })
      assert.equal(style.fontSize, '14px')
      assert.ok(style.height <= 72 && style.top < 100, 'native notice must stay compact and clear of the composer')
      await page.screenshot({ path: join(output, 'screenshots/side-notice.png'), fullPage: true })
      await delay(1200)
      await trigger()
      assert.equal(await notice.count(), 1, 'repeated notices must replace, not stack')
      await delay(2100)
      assert.equal(await notice.isVisible(), true, 'the latest trigger must get its own display duration')
      await notice.waitFor({ state: 'detached', timeout: 2000 })
      await trigger()
      await notice.getByRole('button', { name: '关闭', exact: true }).click()
      await notice.waitFor({ state: 'detached' })
    })
    await closeSide()
    await side.waitFor({ state: 'detached' })
  })
  await check('selection-toolbar-preserves-normal-annotation', async () => {
    const toolbar = await selectSourceReply()
    await toolbar.getByRole('button', { name: '在侧边聊天提问', exact: true }).waitFor()
    const icons = await toolbar.locator('button svg').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect()
      return { width: rect.width, height: rect.height, top: rect.top, color: getComputedStyle(node).color }
    }))
    assert.equal(icons.length, 2)
    assert.deepEqual(icons[0], icons[1], 'toolbar icons must share size, color and alignment')
    await page.screenshot({ path: join(output, 'screenshots/selection-toolbar.png'), fullPage: true })
    await toolbar.getByRole('button', { name: '批注', exact: true }).click()
    const note = page.getByRole('textbox', { name: '批注内容', exact: true })
    await note.fill('SOURCE_DRAFT_NOTE')
    await page.getByRole('button', { name: '加入输入框', exact: true }).click()
    await page.getByRole('button', { name: '1 条批注', exact: true }).waitFor()
  })
  await check('selection-becomes-an-unsent-side-annotation-and-keeps-source-draft', async () => {
    const toolbar = await selectSourceReply()
    const response = page.waitForResponse(response => response.url().includes('/api/eduwork/side-chat') && response.request().postDataJSON()?.action === 'open')
    await toolbar.getByRole('button', { name: '在侧边聊天提问', exact: true }).click()
    sideId = (await (await response).json()).sessionId
    const side = page.locator('[data-eduwork-side-chat]')
    await side.getByRole('button', { name: '1 条批注', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '1 条批注', exact: true }).count(), 2)
    assert.equal((await trace()).filter(row => row.sideBoundary).length, 0, 'insertion must not auto-send')
    const editor = side.locator('[contenteditable="true"]')
    // Type immediately, without focusing or moving the caret in the test:
    // first-mount focus must retain the insertion's native trailing position.
    await page.keyboard.insertText('FIRST_CARET_PROBE')
    const firstDraft = await editor.innerText()
    assert.ok(firstDraft.indexOf('SOURCE_FIRST_REP') < firstDraft.indexOf('FIRST_CARET_PROBE'), 'first side insertion must place typing after the annotation')
    await side.getByRole('button', { name: '1 条批注', exact: true }).click()
    await page.getByRole('dialog', { name: '待发送批注' }).getByRole('button', { name: 'SOURCE_FIRST_REPLY', exact: true }).click()
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByRole('textbox', { name: '批注内容', exact: true }).fill('SIDE_DRAFT_NOTE')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await editor.focus()
    await editor.press('End')
    await page.keyboard.insertText(' DRAFT_PREFIX')
    const again = await selectSourceReply()
    await again.getByRole('button', { name: '在侧边聊天提问', exact: true }).click()
    await side.getByRole('button', { name: '2 条批注', exact: true }).waitFor()
    await page.keyboard.insertText('NEXT_CARET_PROBE')
    const nextDraft = await editor.innerText()
    assert.ok(nextDraft.lastIndexOf('SOURCE_FIRST_REP') < nextDraft.indexOf('NEXT_CARET_PROBE'), 'subsequent insertion must place typing after the new annotation')
    assert.ok((await editor.innerText()).includes('DRAFT_PREFIX'), 'adding another selection must preserve typed text')
    await side.getByRole('button', { name: '2 条批注', exact: true }).click()
    await page.getByRole('dialog', { name: '待发送批注' }).getByRole('button', { name: 'SOURCE_FIRST_REPLY', exact: true }).nth(1).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await side.getByRole('button', { name: '1 条批注', exact: true }).waitFor()
    await page.screenshot({ path: join(output, 'screenshots/side-selected-draft.png'), fullPage: true })
    await editor.focus()
    await editor.press('End')
    await page.keyboard.insertText(' SIDE_QUESTION')
    await editor.press('Enter')
    await page.locator('[data-eduwork-side-chat]').getByText('SCRIPTED_SIDE_REPLY', { exact: true }).waitFor()
    const model = (await trace()).find(row => row.marker === 'SIDE_QUESTION')
    assert.equal(model.inheritedReference, true)
    assert.equal(model.inheritedFuture, false)
    assert.equal(model.sideBoundary, true)
    assert.equal(model.selectedAnnotation, true)
    assert.equal(model.editedSideNote, true)
    assert.equal(model.sourceDraftLeak, false)
    assert.equal(await side.locator('[data-side-chat-empty]').count(), 0)
    await assertComposerAlignment()
    await page.screenshot({ path: join(output, 'screenshots/side-chat.png'), fullPage: true })
  })
  await check('reused-side-chat-after-a-completed-turn-keeps-the-caret-after-the-annotation', async () => {
    const side = page.locator('[data-eduwork-side-chat]')
    const editor = side.locator('[contenteditable="true"]')
    const toolbar = await selectSourceReply()
    await toolbar.getByRole('button', { name: '在侧边聊天提问', exact: true }).click()
    await side.getByRole('button', { name: '1 条批注', exact: true }).waitFor()
    await page.keyboard.insertText('AFTER_TURN_CARET_PROBE')
    const draft = await editor.innerText()
    assert.ok(draft.indexOf('SOURCE_FIRST_REP') < draft.indexOf('AFTER_TURN_CARET_PROBE'), 'reusing a side chat after a reply must place typing after the annotation')
    assert.equal((await trace()).filter(row => row.kind === 'request' && row.marker === 'SIDE_QUESTION').length, 1, 'adding a selection must not send another request')
  })
  await check('side-chat-hides-the-normal-conversation-fork-action', async () => {
    const branch = /^(在新对话中分支|Branch into a new conversation)$/
    await page.locator('[data-eduwork-side-chat] [data-turn-tail]').last().hover()
    assert.equal(await page.locator('[data-eduwork-side-chat]').getByRole('button', { name: branch }).count(), 0)
    assert.ok(await page.getByRole('button', { name: branch }).count() > 0, 'the source conversation must retain its fork action')
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
    const sideFor = id => page.locator(`[data-eduwork-side-chat][data-side-source="${id}"]`)
    const a = sideFor(main.sessionId)
    const aDraft = await a.locator('[contenteditable="true"]').textContent()
    const other = await rpc('session/create', { request: { workspaceId: workspace.workspaceId } })
    await rpc('session/rename', { request: { sessionId: other.sessionId, title: 'Other synthetic conversation' } })
    await rpc('session/prompt', { request: { sessionId: other.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'MAIN_PARALLEL' }] } })
    await waitFor(async () => (await trace()).some(row => row.marker === 'MAIN_PARALLEL'), 'Other main conversation did not run')
    await page.getByText('Other synthetic conversation', { exact: true }).first().click()
    await a.waitFor({ state: 'hidden' })
    const toolbar = await selectSourceReply('SCRIPTED_MAIN_REPLY')
    await toolbar.getByRole('button', { name: '在侧边聊天提问', exact: true }).click()
    const b = sideFor(other.sessionId)
    await b.getByRole('button', { name: '1 条批注', exact: true }).waitFor()
    const bId = await b.getAttribute('data-side-session')
    assert.notEqual(bId, sideId)
    await b.locator('[contenteditable="true"]').fill('MULTI_SIDE_QUESTION')
    await b.locator('[contenteditable="true"]').press('Enter')
    await b.getByText('MULTI_SIDE_REPLY', { exact: true }).waitFor()
    await b.locator('[contenteditable="true"]').fill('B_DRAFT_MARKER')
    assert.equal(await a.locator('[contenteditable="true"]').textContent(), aDraft)
    const third = await rpc('session/create', { request: { workspaceId: workspace.workspaceId } })
    await rpc('session/rename', { request: { sessionId: third.sessionId, title: 'Third synthetic conversation' } })
    await rpc('session/prompt', { request: { sessionId: third.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'MAIN_PARALLEL_C' }] } })
    await page.getByText('Third synthetic conversation', { exact: true }).first().click()
    await page.getByText('SCRIPTED_MAIN_REPLY', { exact: true }).first().waitFor()
    const thirdToolbar = await selectSourceReply('SCRIPTED_MAIN_REPLY')
    await thirdToolbar.getByRole('button', { name: '在侧边聊天提问', exact: true }).click()
    const c = sideFor(third.sessionId)
    await c.getByRole('button', { name: '1 条批注', exact: true }).waitFor()
    assert.ok(![sideId, bId].includes(await c.getAttribute('data-side-session')))
    await closeSide()
    await c.waitFor({ state: 'detached' })
    await page.getByText('Other synthetic conversation', { exact: true }).first().click()
    await b.getByText('MULTI_SIDE_REPLY', { exact: true }).waitFor()
    assert.equal(await b.getAttribute('data-side-session'), bId)
    assert.equal(await b.locator('[contenteditable="true"]').innerText(), 'B_DRAFT_MARKER')
    await closeSide()
    await b.waitFor({ state: 'detached' })
    await sourceTitle.click()
    await a.getByText('SCRIPTED_SIDE_REPLY', { exact: true }).waitFor()
    assert.equal(await a.getAttribute('data-side-session'), sideId)
    assert.equal(await a.locator('[contenteditable="true"]').textContent(), aDraft)
    const sideRequests = (await trace()).filter(row => row.kind === 'request' && row.marker === 'SIDE_QUESTION')
    assert.equal(sideRequests.length, 1, 'navigation must not replay a side request')
  })
  if (desktopApp) await check('hide-and-show-native-window-preserves-side-chat', async () => {
    await desktopApp.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('dsh-app://app/')); window.hide(); window.show() })
    await page.locator('[data-eduwork-side-chat]').getByText('SCRIPTED_SIDE_REPLY', { exact: true }).waitFor()
  })
  if (desktopApp) await check('hidden-inactive-side-chat-survives-with-renderer-timers-paused', async () => {
    const side = page.locator('[data-eduwork-side-chat]')
    const editor = side.locator('[contenteditable="true"]')
    const draft = await editor.innerText()
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    await desktopApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('dsh-app://app/')).minimize())
    // Real Host time exceeds the old 45-second lease while renderer timers
    // cannot renew anything. No wall-clock timeout may destroy this chat.
    await delay(55_000)
    await desktopApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('dsh-app://app/'))
      window.restore(); window.show()
    })
    await page.clock.resume()
    assert.equal(await editor.innerText(), draft, 'inactivity must retain the draft')
    assert.equal(await side.getByText('SCRIPTED_SIDE_REPLY', { exact: true }).count(), 1)
    await askSide('SIDE_QUESTION AFTER_IDLE')
    await waitFor(async () => (await trace()).filter(row => row.kind === 'request' && row.marker === 'SIDE_QUESTION').length === 2, 'The original side chat could not continue after inactivity')
    await side.getByText('SCRIPTED_SIDE_REPLY', { exact: true }).nth(1).waitFor()
    assert.equal(await page.getByText('临时侧聊已结束。', { exact: true }).count(), 0)
  })
  await check('close-stops-streaming-and-does-not-touch-source', async () => {
    await askSide('SIDE_HANG')
    await page.locator('[data-eduwork-side-chat]').getByText('SIDE_STREAM_PARTIAL', { exact: true }).waitFor()
    await closeSide()
    await page.locator('[data-eduwork-side-chat]').waitFor({ state: 'detached' })
    await waitFor(async () => (await trace()).some(row => row.kind === 'aborted' && row.marker === 'SIDE_HANG'), 'Closing did not cancel the actual Agent model stream')
    await page.getByText('SOURCE_FUTURE_REPLY', { exact: true }).waitFor()
    assert.equal(await page.getByText('临时侧聊已结束。', { exact: true }).count(), 0)
  })
  await check('streaming-source-opens-and-answers-a-side-question-without-stopping', async () => {
    await prompt('SOURCE_STREAM')
    await page.getByText('SOURCE_STREAM_PARTIAL', { exact: true }).first().waitFor()
    const toolbar = await selectSourceReply('SOURCE_STREAM_PARTIAL')
    assert.equal(await toolbar.getByRole('button', { name: '批注', exact: true }).count(), 0, 'live excerpts must not invent ordinary message badges')
    const opened = page.waitForResponse(response => response.url().includes('/api/eduwork/side-chat') && response.request().postDataJSON()?.action === 'open')
    await toolbar.getByRole('button', { name: '在侧边聊天提问', exact: true }).click()
    assert.ok((await (await opened).json()).sessionId.startsWith('side-'))
    const side = page.locator('[data-eduwork-side-chat]')
    await side.getByRole('button', { name: '1 条批注', exact: true }).waitFor()
    await page.keyboard.insertText(' STREAM_SIDE_QUESTION')
    await side.locator('[contenteditable="true"]').press('Enter')
    await side.getByText('STREAM_SIDE_REPLY', { exact: true }).waitFor()
    const requests = await trace()
    assert.ok(requests.some(row => row.marker === 'STREAM_SIDE_QUESTION' && row.sideBoundary && row.liveAnnotation))
    assert.equal(requests.some(row => row.kind === 'aborted' && row.marker === 'SOURCE_STREAM'), false)
    await closeSide()
    assert.equal((await trace()).some(row => row.kind === 'aborted' && row.marker === 'SOURCE_STREAM'), false)
    await rpc('session/cancel', { request: { sessionId: main.sessionId } })
    await waitFor(async () => (await trace()).some(row => row.kind === 'aborted' && row.marker === 'SOURCE_STREAM'), 'Only cancelling the source may stop its stream')
  })
  await check('refresh-does-not-restore-a-side-chat', async () => {
    const owners = []
    const opened = () => page.waitForResponse(response => response.url().includes('/api/eduwork/side-chat') && response.request().postDataJSON()?.action === 'open')
    const remember = async response => owners.push({ owner: response.request().postDataJSON().owner, sessionId: (await response.json()).sessionId })
    await page.getByText('SOURCE_FIRST_REPLY', { exact: true }).first().hover()
    const firstOpen = opened()
    await sideAction().first().click()
    await remember(await firstOpen)
    await page.locator('[data-eduwork-side-chat]').waitFor()
    await page.getByText('Other synthetic conversation', { exact: true }).first().click()
    const toolbar = await selectSourceReply('SCRIPTED_MAIN_REPLY')
    const secondOpen = opened()
    await toolbar.getByRole('button', { name: '在侧边聊天提问', exact: true }).click()
    await remember(await secondOpen)
    await page.locator(`[data-side-session="${owners[1].sessionId}"]`).getByRole('button', { name: '1 条批注', exact: true }).waitFor()
    await sourceTitle.click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dismissOnboarding()
    await page.getByText('SOURCE_FUTURE_REPLY', { exact: true }).first().waitFor()
    assert.equal(await page.locator('[data-eduwork-side-chat]').count(), 0)
    await waitFor(() => page.evaluate(async owners => {
      const statuses = await Promise.all(owners.map(async owner => (await fetch('api/eduwork/side-chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...owner, action: 'heartbeat' }),
      })).status))
      return statuses.every(status => status === 410)
    }, owners), 'Refreshing must close every side chat owned by the window, including hidden ones')
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
    const updaterState = join(output, 'desktop-data/updates/state/updates/electron-edition.json')
    const updaterStarted = await readFile(updaterState).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
    result.softwareUpdateBackendStarted = updaterStarted
    if (updaterStarted) { result.passed = false; result.cleanupError = 'Experimental default unexpectedly started the software updater'; process.exitCode = 1 }
  }
  if (started) await lifecycle('stop').catch(error => { result.cleanupError = redact(error.message); result.passed = false; process.exitCode = 1 })
  result.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, browserErrors: result.browserErrors.length }))
}
