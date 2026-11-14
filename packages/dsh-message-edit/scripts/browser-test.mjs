// Browser acceptance against the locked DSH Runtime: a private DSH home with
// this package linked in, a synthetic model, and headless Chromium. Every
// reply lists the user texts the model saw, so each check reads what a resend
// carried. Not part of `npm run check`: it needs a Playwright Chromium.
//   EDUWORK_MESSAGE_EDIT_RUNTIME=<runtime> node scripts/browser-test.mjs --output <new directory>
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { output: { type: 'string' } } })
if (!values.output || !process.env.EDUWORK_MESSAGE_EDIT_RUNTIME) throw Error('Set EDUWORK_MESSAGE_EDIT_RUNTIME and pass --output <new directory>')
const runtime = resolve(process.env.EDUWORK_MESSAGE_EDIT_RUNTIME)
const output = resolve(values.output)
const plugin = fileURLToPath(new URL('../', import.meta.url))
await mkdir(output)
const home = join(output, 'dsh-home'), osHome = join(output, 'os-home')
await mkdir(osHome)
const { chromium } = createRequire(join(runtime, 'package.json'))('playwright-core')
const dsh = join(runtime, 'node_modules/.bin/dsh')
const result = { schemaVersion: 1, kind: 'message-edit-browser-acceptance', synthetic: true, externalModelRequests: 0, checks: [], consoleErrors: [], passed: false }

// A Messages-compatible model: the reply names every user text starting with
// "Q", the images and files of the last user message, and how many referenced
// conversation snapshots the request carried. "SLOW" holds the reply.
const blocks = message => (typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content)
const model = createServer(async (request, response) => {
  let raw = ''
  for await (const chunk of request) raw += chunk
  const path = new URL(request.url, 'http://model').pathname
  if (request.method === 'GET' && path.endsWith('/models')) return response.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-flash', object: 'model' }] }))
  if (!path.endsWith('/messages')) return response.writeHead(404).end()
  const users = (JSON.parse(raw).messages ?? []).filter(message => message.role === 'user')
  const texts = users.flatMap(message => blocks(message).filter(block => block.type === 'text').map(block => block.text))
  const last = blocks(users.at(-1) ?? { content: [] })
  const lastText = last.filter(block => block.type === 'text').map(block => block.text)
  if (lastText.join('').includes('SLOW')) await new Promise(settle => setTimeout(settle, 4000))
  const files = lastText.map(text => text.match(/^\[File "([^"]+)"/)?.[1]).filter(Boolean)
  const snapshots = texts.filter(text => text.includes('Referenced sessions')).length
  const text = `模型看到：${texts.filter(text => text.startsWith('Q')).join(' | ') || '（无）'}；最后一条带图 ${last.filter(block => block.type === 'image').length} 张`
    + `${files.length ? `、文件 ${files.join('+')}` : ''}${snapshots ? `、引用快照 ${snapshots}` : ''}`
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const [event, data] of [
    ['message_start', { type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'fixture', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }],
    ['message_stop', { type: 'message_stop' }],
  ]) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  response.end()
})
// Everything started here is stopped in the `finally` below, whatever fails.
let host, browser, page, url
async function start() {
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  const environment = {
    ...process.env, HOME: osHome, USERPROFILE: osHome, DSH_HOME: home, NO_PROXY: '127.0.0.1,localhost',
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, DEEPSEEK_API_KEY: 'synthetic',
  }
  execFileSync(dsh, ['plugin', '--profile', 'web', 'add', `link:${plugin}`], { env: environment, stdio: 'ignore' })
  // The first-use workspace lives under the account's Documents folder, found
  // through the OS rather than HOME; keep it inside the output as well.
  await writeFile(join(home, 'profiles/web/cordis.patch.yml'), `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(join(output, 'documents'))}\n`)
  const port = await new Promise(settle => { const probe = createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => settle(port)) }) })
  host = spawn(dsh, ['web', '--no-open', '--port', String(port)], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  url = await new Promise((settle, fail) => {
    const read = chunk => { log += chunk; const found = log.match(/http:\/\/\S+/)?.[0]; if (found) settle(found) }
    host.stdout.on('data', read); host.stderr.on('data', read)
    host.once('exit', code => fail(Error(`dsh web exited with ${code}: ${log.replace(/token=\S+/g, 'token=[redacted]').slice(-1600)}`)))
  })
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage({ viewport: { width: 1280, height: 860 }, locale: 'zh-CN' })
  page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text().slice(0, 400)) })
  page.on('pageerror', error => result.consoleErrors.push(`pageerror: ${error.message}`))
}

const check = (name, ok, detail = '') => {
  result.checks.push({ name, passed: Boolean(ok), ...detail === '' ? {} : { detail: String(detail) } })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

const composer = () => page.locator('[contenteditable="true"]').first()
const editors = () => page.locator('.eduwork-message-editor')
const replyCount = () => page.evaluate(() => [...document.querySelectorAll('*')].filter(node => node.childElementCount === 0 && node.textContent.startsWith('模型看到：')).length)
const reply = text => page.getByText(text).first().waitFor({ timeout: 30_000 })
const lastReply = () => page.getByText(/^模型看到：/).last().innerText()
const current = () => page.locator('[role="treeitem"][aria-selected="true"]').getAttribute('data-row-key')
// The workspace registry's own record of archived conversations, and the logs on disk.
const archivedIds = async () => JSON.parse(await readFile(join(home, 'storages/workspace.json'), 'utf8')).global.archivedSessionIds
const sessionCount = async () => (await readdir(join(home, 'sessions'), { recursive: true })).filter(path => /session-[^/]+$/.test(path)).length
const row = text => page.locator('[data-chat-node-key]').filter({ has: page.locator('[data-eduwork-message-edit]') }).filter({ hasText: text }).first()
const caretTo = (field, at) => field.evaluate((node, at) => { const offset = at === 'end' ? node.value.length : typeof at === 'number' ? at : node.value.indexOf(at); node.setSelectionRange(offset, offset) }, at)
const select = (field, needle) => field.evaluate((node, needle) => { const at = node.value.indexOf(needle); node.setSelectionRange(at, at + needle.length) }, needle)

async function newSession() {
  await page.getByText(/^(新会话|New Session)$/).first().click()
  await page.waitForTimeout(800)
}
async function send(text, { wait = true, steer = false } = {}) {
  const before = await replyCount()
  await composer().click()
  await page.keyboard.type(text)
  await page.keyboard.press(steer ? (process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter') : 'Enter')
  if (wait) await page.waitForFunction(count => [...document.querySelectorAll('*')].filter(node => node.childElementCount === 0 && node.textContent.startsWith('模型看到：')).length > count, before, { timeout: 30_000 })
  await page.waitForTimeout(600)
}
async function open(text) {
  const target = row(text)
  await target.scrollIntoViewIfNeeded()
  await target.hover()
  await target.locator('[data-eduwork-message-edit]').click()
  return target
}
// Replace the "Qn" tag that starts the text, keys at the caret like a user.
async function retag(field, tag) {
  await caretTo(field, 0)
  await field.press('Delete')
  await field.press('Delete')
  await field.pressSequentially(tag)
}
async function sendEdit(target, expected) {
  const before = await current()
  await target.locator('.eduwork-message-editor button[data-primary]').click()
  await reply(expected)
  await page.waitForFunction(previous => document.querySelector('[role="treeitem"][aria-selected="true"]')?.getAttribute('data-row-key') !== previous, before, { timeout: 20_000 })
  await page.waitForTimeout(1200)
}
const transcript = async () => (await page.locator('[data-chat-node-key]').allInnerTexts()).join('\n')

try {
  await start()
  await page.goto(url)
  await page.waitForTimeout(3000)
  for (const name of [/^(继续|Continue)$/, /^(我知道了|Got it)$/]) {
    const button = page.getByRole('button', { name }).first()
    if (await button.isVisible().catch(() => false)) await button.click()
  }

  // Editing a middle message replaces the conversation with a branch cut before it.
  await newSession()
  for (const text of ['Q1 第一个问题', 'Q2 原来的第二个问题', 'Q3 第三个问题']) await send(text)
  const original = await current()
  let target = row('Q2 原来的第二个问题')
  await target.hover()
  check('pencil follows the copy button', JSON.stringify(await target.locator('[data-clock] button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))) === '["复制","编辑消息"]')
  await target.locator('[data-eduwork-message-edit]').click()
  const field = target.locator('textarea')
  check('editor holds the text with the caret after it', await field.inputValue() === 'Q2 原来的第二个问题' && await field.evaluate(node => node.selectionStart === node.value.length && document.activeElement === node))
  await field.press('Escape')
  check('Escape restores the message', await editors().count() === 0 && await target.locator('[data-message-bubble]').isVisible())
  target = await open('Q2 原来的第二个问题')
  await retag(target.locator('textarea'), 'Q2')
  await caretTo(target.locator('textarea'), 'end')
  await target.locator('textarea').pressSequentially(' 改过')
  await sendEdit(target, '模型看到：Q1 第一个问题 | Q2 原来的第二个问题 改过；')
  const text = await transcript()
  check('branch keeps the history before the edit and nothing after it', text.includes('Q1 第一个问题') && !text.includes('Q3 第三个问题'))
  const originalId = original.slice('session:'.length)
  check('the original conversation is archived, its log kept', await page.locator(`[data-row-key="${original}"]`).count() === 0
    && (await archivedIds()).includes(originalId) && (await readdir(join(home, 'sessions'), { recursive: true })).some(path => path.endsWith(originalId)))

  // While a Turn runs the pencil waits; a steered message goes with its Turn.
  await newSession()
  await send('Q1 SLOW 被插话的问题', { wait: false })
  check('pencil is unavailable while the reply runs', await row('Q1 SLOW').locator('[data-eduwork-message-edit]').getAttribute('aria-disabled') === 'true')
  await send('Q2 插话', { wait: false, steer: true })
  await reply(/^模型看到：Q1 SLOW 被插话的问题 \| Q2 插话/)
  await page.waitForTimeout(1500)
  const steering = page.locator('[data-chat-flow-kind="steering"]').filter({ hasText: 'Q2 插话' })
  const steeringPencil = steering.locator('[data-eduwork-steering-edit]')
  check('a steered message shows an unavailable pencil', await steeringPencil.getAttribute('aria-disabled') === 'true' && await steeringPencil.getAttribute('title') === '插话不能单独编辑，请编辑这一轮开头的消息')
  await steering.hover()
  await steeringPencil.click({ force: true })
  check('clicking it opens no editor', await editors().count() === 0)
  target = await open('Q1 SLOW 被插话的问题')
  check('the Turn message editor says the steered message goes too', await target.locator('.eduwork-message-editor-steers').innerText() === '这一轮还有 1 条插话，发送后会一起替换')
  await retag(target.locator('textarea'), 'Q3')
  await sendEdit(target, /^模型看到：Q3 SLOW 被插话的问题；/)
  check('the steered message is replaced with its Turn', !(await transcript()).includes('Q2 插话'))

  // Stored attachments carry over, removable; new ones upload while editing.
  await newSession()
  await page.locator('input[type="file"]:not(.eduwork-message-editor *)').first().setInputFiles([
    { name: 'red.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic notes') },
  ])
  await page.waitForTimeout(1500)
  await send('Q1 带图和文件')
  check('the original Turn carried both', (await lastReply()).includes('最后一条带图 1 张、文件 notes.txt'))
  target = await open('Q1 带图和文件')
  const chips = () => target.locator('.eduwork-message-editor-attachment').evaluateAll(nodes => nodes.map(node => `${node.dataset.kind}:${node.dataset.state}:${node.title}`))
  check('editor lists the stored image and file', JSON.stringify(await chips()) === '["image:ready:red.png","file:ready:notes.txt"]', JSON.stringify(await chips()))
  await target.locator('.eduwork-message-editor-attachment[data-kind="image"]').hover()
  await target.locator('.eduwork-message-editor-attachment[data-kind="image"] .eduwork-message-editor-remove').click()
  await target.locator('.eduwork-message-editor input[type="file"]').setInputFiles({ name: 'added.txt', mimeType: 'text/plain', buffer: Buffer.from('added while editing') })
  await page.locator('.eduwork-message-editor-attachment[data-state="ready"][title="added.txt"]').waitFor({ timeout: 15_000 })
  await retag(target.locator('textarea'), 'Q2')
  await sendEdit(target, '模型看到：Q2 带图和文件；最后一条带图 0 张、文件 notes.txt+added.txt')
  check('the resend drops the removed image and carries the stored and added files', true)

  // A referenced conversation stays referenced while its mention is left alone.
  await newSession()
  await composer().click()
  await page.keyboard.type('Q1 看看 @')
  await page.waitForTimeout(1200)
  const label = (await page.locator('[role="option"]').first().innerText()).split('\n')[0]
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await page.keyboard.type(' 这个')
  const before = await replyCount()
  await page.keyboard.press('Enter')
  await page.waitForFunction(count => [...document.querySelectorAll('*')].filter(node => node.childElementCount === 0 && node.textContent.startsWith('模型看到：')).length > count, before, { timeout: 30_000 })
  check('the original Turn carried the snapshot', (await lastReply()).includes('引用快照 1'))
  target = await open('Q1 看看')
  check('editor names the referenced conversation', await target.locator('.eduwork-message-editor-references').innerText() === `引用会话 · ${label}`)
  await retag(target.locator('textarea'), 'Q2')
  await sendEdit(target, /^模型看到：Q2 看看 .*引用快照 1$/)
  check('the edited message is sent with the reference', true)
  target = await open('Q2 看看')
  await select(target.locator('textarea'), `@${label}`)
  await target.locator('textarea').press('Backspace')
  check('deleting the mention removes the reference line', await target.locator('.eduwork-message-editor-references').count() === 0)
  await retag(target.locator('textarea'), 'Q3')
  await sendEdit(target, /^模型看到：Q3 看看/)
  check('a deleted mention sends no snapshot', !(await lastReply()).includes('引用快照'))

  // Other open edits of a replaced conversation: earlier ones move along, later ones close.
  await newSession()
  for (const text of ['Q1 甲', 'Q2 乙', 'Q3 丙']) await send(text)
  await open('Q1 甲')
  await caretTo(editors().first().locator('textarea'), 'end')
  await editors().first().locator('textarea').pressSequentially(' 草稿')
  await open('Q3 丙')
  target = await open('Q2 乙')
  check('three editors open at once', await editors().count() === 3)
  const replaced = await current()
  const during = await target.evaluate(async node => {
    node.querySelector('.eduwork-message-editor button[data-primary]').click()
    await new Promise(settle => requestAnimationFrame(() => setTimeout(settle, 0)))
    const first = document.querySelector('.eduwork-message-editor')
    return { disabled: first.querySelector('button[data-primary]').disabled, note: first.querySelector('.eduwork-message-editor-note').textContent }
  })
  check('other editors wait while one sends', during.disabled && during.note.includes('另一条编辑正在发送'), JSON.stringify(during))
  await page.waitForFunction(previous => document.querySelector('[role="treeitem"][aria-selected="true"]')?.getAttribute('data-row-key') !== previous, replaced, { timeout: 20_000 })
  await page.waitForTimeout(2500)
  check('the earlier draft moves to the replacement; the later one closes', await editors().count() === 1 && await editors().locator('textarea').inputValue() === 'Q1 甲 草稿')
  await editors().locator('textarea').press('Escape')

  // Two sends in the same tick replace the conversation once.
  await newSession()
  for (const text of ['Q1 戊', 'Q2 己']) await send(text)
  const sessions = await sessionCount()
  await open('Q1 戊')
  await open('Q2 己')
  await page.evaluate(() => { for (const button of document.querySelectorAll('.eduwork-message-editor button[data-primary]')) button.click() })
  await page.waitForTimeout(4000)
  check('two sends in one tick create one branch', await sessionCount() === sessions + 1, `${sessions} -> ${await sessionCount()}`)

  // After a reload every user message has its pencil again.
  await page.reload()
  await page.locator('[role="treeitem"][data-row-key^="session:"]').first().click()
  await page.locator('[data-chat-flow-kind="user"]').first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  const pencils = await page.locator('button[data-eduwork-message-edit]').count()
  check('every user message has one pencil after a reload', pencils > 0 && pencils === await page.locator('[data-chat-flow-kind="user"]').count())
  await page.screenshot({ path: join(output, 'final.png') })
} catch (error) {
  const notes = await page?.locator('.eduwork-message-editor-note').allInnerTexts().catch(() => []) ?? []
  check('scenario completed', false, `${error.message.split('\n')[0]}${notes.length ? ` (editor: ${notes.join(' / ')})` : ''}`)
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
} finally {
  await browser?.close().catch(() => {})
  // A Host that already exited, by code or by signal, has nothing left to stop.
  if (host?.exitCode === null && host.signalCode === null) {
    host.kill()
    await once(host, 'exit')
  }
  model.closeAllConnections()
  model.close()
  result.passed = result.checks.every(entry => entry.passed) && result.consoleErrors.length === 0
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(`${result.checks.filter(entry => entry.passed).length}/${result.checks.length} checks passed; console errors: ${result.consoleErrors.length}`)
  if (result.consoleErrors.length) console.log(result.consoleErrors.join('\n'))
  assert.ok(result.passed, 'Browser acceptance failed')
}
