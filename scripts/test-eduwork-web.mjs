/**
 * Exercise a frozen EduWork Web assembly through its real Loader, RPC transport,
 * and browser UI. This is wiring acceptance, not a model/output-quality score.
 *
 * node scripts/test-eduwork-web.mjs --assembly <dir> --evidence <private-dir>
 *   [--config <private-running-web.json>] [--mode full-ready|clean-ci]
 *
 * Without --config the launcher owns an isolated home and ephemeral localhost
 * port. With --config the existing process is reused and is never stopped.
 * DSH_OFFICE_PYTHON, DSH_MEDIA_BROWSER and EDUWORK_OIDC_PROFILE are inherited.
 * Evidence belongs in an ignored directory: it includes local runtime logs.
 * Default full-ready requires all eight Host-reported capabilities available.
 * clean-ci explicitly checks wiring and stable readiness without claiming that
 * missing optional local services can run. Neither mode assesses model quality.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { releaseIdentity } from '../dsh-host/release-policy.mjs'

export function studioReadiness(rows, mode = 'full-ready') {
  assert.ok(['full-ready', 'clean-ci'].includes(mode), 'Unknown Web acceptance mode')
  assert.ok(Array.isArray(rows), 'Studio capabilities must be an array')
  assert.deepEqual(rows.map(row => row.id).sort(), ['audio', 'flashcards', 'mindmap', 'quiz', 'report', 'slides', 'table', 'video'])
  const unavailable = []
  for (const row of rows) {
    assert.equal(typeof row.available, 'boolean', `${row.id} must declare readiness explicitly`)
    for (const field of ['title', 'description', 'rendererKey']) assert.ok(typeof row[field] === 'string' && row[field].trim(), `${row.id} requires ${field}`)
    assert.ok(['none', 'inline', 'dialog'].includes(row.interaction), `${row.id} interaction`)
    assert.equal(row.execution, 'artifact', `${row.id} execution`)
    assert.ok(['interactive', 'document', 'media'].includes(row.output), `${row.id} output`)
    assert.ok(Array.isArray(row.parameters), `${row.id} parameters must be an array`)
    assert.equal(new Set(row.parameters.map(param => param.id)).size, row.parameters.length, `${row.id} repeats a parameter`)
    for (const param of row.parameters) {
      assert.ok(typeof param.id === 'string' && param.id && typeof param.label === 'string' && param.label, `${row.id} parameter identity`)
      assert.ok(['text', 'textarea', 'select', 'number', 'boolean'].includes(param.type), `${row.id} parameter type`)
      if (param.type === 'select') assert.ok(Array.isArray(param.options), `${row.id}.${param.id} options`)
    }
    if (row.available) continue
    // Frozen Studio reports native media readiness separately from voices: a
    // system voice may exist while the browser/FFmpeg runtime is unavailable.
    // Preserve that explicit Host reason, then verify it is stable on reread.
    if (['audio', 'video'].includes(row.id) && typeof row.unavailableReason === 'string' && row.unavailableReason.trim()) {
      unavailable.push({ id: row.id, reason: 'host-reported-unavailable', detail: row.unavailableReason.trim() })
      continue
    }
    // Compatibility with older descriptors: the same provider choices shown
    // in the UI can prove there is no usable voice. Never accept a bare false.
    const provider = row.parameters.find(param => param.id === 'provider')
    assert.ok(row.id === 'audio' && provider?.type === 'select' && provider.options.length === 0,
      `${row.id} is unavailable without a recognized, observable readiness reason`)
    unavailable.push({ id: row.id, reason: 'no-speech-provider-with-voices' })
  }
  if (mode === 'full-ready') assert.equal(unavailable.length, 0, 'Full-ready acceptance requires all eight Studio entry points available')
  return { ids: rows.map(row => row.id), allReportedAvailable: unavailable.length === 0, unavailable,
    scope: 'Host-reported capability readiness; runtime execution and rendering need separate acceptance' }
}

export function oidcProfilePolicy(configuration, expectedIDs) {
  assert.equal(configuration?.schemaVersion, 'dsh-oidc/v1alpha1')
  assert.ok(Array.isArray(configuration.profiles), 'OIDC profiles must be an array')
  const actualIDs = configuration.profiles.map(profile => profile.id)
  assert.ok(actualIDs.every(id => typeof id === 'string' && id), 'OIDC profiles need stable IDs')
  assert.equal(new Set(actualIDs).size, actualIDs.length, 'OIDC repeats a profile')
  assert.equal(new Set(expectedIDs).size, expectedIDs.length, 'Explicit OIDC configuration repeats a profile')
  assert.ok(actualIDs.length === expectedIDs.length && expectedIDs.every(id => actualIDs.includes(id)),
    expectedIDs.length ? 'Every explicitly configured OIDC profile must load; unexpected profiles are not allowed'
      : 'No OIDC profile was configured; the candidate must allow personal keys without an injected institution profile')
  return { profiles: actualIDs.length, configuredProfiles: expectedIDs.length,
    profileConfiguration: expectedIDs.length ? 'explicit' : 'not-configured', personalKeyAllowed: true }
}

export async function configuredOIDCProfileIDs(config, composition, environment = process.env) {
  const plugins = new Map()
  for (const patch of composition) for (const plugin of patch.insert ?? []) {
    if (plugin.name === '@eduwork/dsh-oidc') plugins.set(plugin.id, { ...plugin.config, ...config.pluginConfig?.[plugin.id] })
  }
  for (const patch of config.patches ?? []) {
    if (plugins.has(patch.id)) plugins.set(patch.id, { ...plugins.get(patch.id), ...patch.config })
    for (const plugin of patch.insert ?? []) if (plugin.name === '@eduwork/dsh-oidc') plugins.set(plugin.id, plugin.config ?? {})
  }
  const effective = { ...environment, ...config.environment }
  if (config.enterpriseProfile) effective.EDUWORK_OIDC_PROFILE = effective.DSH_OIDC_ENTERPRISE_PROFILE = config.enterpriseProfile
  const ids = []
  const add = rows => {
    assert.ok(Array.isArray(rows), 'Explicit OIDC profiles must be an array')
    for (const profile of rows) {
      assert.ok(typeof profile?.id === 'string' && profile.id.trim(), 'Explicit OIDC profile needs an ID')
      ids.push(profile.id)
    }
  }
  for (const plugin of plugins.values()) {
    if (plugin.profile !== undefined) add([plugin.profile])
    if (plugin.profiles !== undefined) add(plugin.profiles)
    const key = plugin.profilePathEnv ?? 'EDUWORK_OIDC_PROFILE'
    const path = effective[key] || (key === 'EDUWORK_OIDC_PROFILE' ? effective.DSH_OIDC_ENTERPRISE_PROFILE : undefined)
    if (path) {
      let document
      try { document = JSON.parse((await readFile(resolve(config.assembly, path), 'utf8')).replace(/^\uFEFF/, '')) }
      catch { throw new Error('Explicit OIDC profile document is unreadable or invalid; refusing to treat it as unconfigured') }
      const rows = Array.isArray(document) ? document : document?.profiles ?? [document]
      assert.ok(Array.isArray(rows) && rows.length > 0, 'Explicit OIDC profile document must declare at least one profile')
      add(rows)
    }
  }
  assert.ok(plugins.size > 0, 'Composition must declare the public OIDC plugin')
  return ids
}

if (import.meta.main) {
const repository = resolve(import.meta.dirname, '..')
const options = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  assert.ok(['--assembly', '--evidence', '--config', '--mode'].includes(key), `Unknown option: ${key}`)
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `${key} needs a value`)
  assert.equal(options[key.slice(2)], undefined, `Duplicate option: ${key}`)
  options[key.slice(2)] = key === '--mode' ? process.argv[index + 1] : resolve(process.argv[index + 1])
}
options.mode ??= 'full-ready'
assert.ok(['full-ready', 'clean-ci'].includes(options.mode), '--mode must be full-ready or clean-ci')
assert.ok(options.assembly && options.evidence,
  'Usage: node scripts/test-eduwork-web.mjs --assembly <dir> --evidence <private-dir> [--config <running-web.json>] [--mode full-ready|clean-ci]')
await mkdir(options.evidence, { recursive: true })
const evidence = await mkdtemp(join(options.evidence, 'run-'))
const screenshots = join(evidence, 'screenshots')
await mkdir(screenshots)
const identity = await readJSON(join(options.assembly, 'assembly.json'))
const runID = randomUUID().slice(0, 8)
const checks = []
const calls = []
const browserErrors = []
const cleanupErrors = []
const secrets = new Set()
let owned = false
let configPath, config, base, cookie, browser, page, modelFixture
let settings, capabilities, oidc, workspace, session
let savedStyle, savedStudioOpen, customProvider, customCredential
let expectedBrand = identity.brand

function redact(value) {
  let text = String(value ?? '')
  for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[redacted]')
  return text.replace(/([?&](?:token|access_token|code|state)=)[^\s&#"']+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
}
async function readJSON(path) { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) }
async function eventually(predicate, message, timeout = 20000) {
  const deadline = Date.now() + timeout
  let last
  do {
    try { const value = await predicate(); if (value) return value } catch (error) { last = error }
    await delay(150)
  } while (Date.now() < deadline)
  throw new Error(`${message}${last ? `: ${redact(last.message).slice(0, 300)}` : ''}`)
}
async function check(name, operation) {
  const start = Date.now()
  try {
    const details = await operation()
    checks.push({ name, passed: true, durationMs: Date.now() - start, ...(details ?? {}) })
    console.log(`PASS ${name}`)
    return true
  } catch (error) {
    checks.push({ name, passed: false, durationMs: Date.now() - start, error: redact(error.message).slice(0, 1800) })
    console.error(`FAIL ${name}: ${redact(error.message).split('\n')[0].slice(0, 250)}`)
    if (page) {
      await page.screenshot({ path: join(screenshots, `failure-${checks.length}.png`), fullPage: true,
        mask: [page.locator('input[type=password]')] }).catch(() => {})
      await writeFile(join(evidence, `failure-${checks.length}.txt`), redact(await page.locator('body').innerText().catch(() => 'Page unavailable')))
    }
    return false
  }
}
async function lifecycle(action) {
  const output = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(repository, 'scripts/dev-eduwork-web.mjs'), action, configPath],
      { cwd: repository, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let data = ''
    child.stdout.on('data', part => { data += part })
    child.stderr.on('data', part => { data += part })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? accept(data) : reject(new Error(`Web ${action} exited ${code}: ${redact(data).slice(-1500)}`)))
  })
  await writeFile(join(evidence, `launcher-${action}.txt`), redact(output))
}
async function rpc(endpoint, args = {}, { timeoutMs = 30000 } = {}) {
  let response
  try { response = await fetch(`${base}/api/${endpoint}`, {
    method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
    signal: AbortSignal.timeout(timeoutMs),
  }) } catch (error) {
    calls.push({ endpoint, ok: false, error: redact(error.message) })
    throw error
  }
  const envelope = await response.json()
  const ok = response.ok && envelope.type === 'server-response' && envelope.result?.ok === true
  calls.push({ endpoint, status: response.status, ok })
  assert.ok(ok, `${endpoint}: HTTP ${response.status}; ${redact(envelope.result?.error?.message ?? envelope.result?.error?.code ?? 'invalid RPC response')}`)
  return envelope.result.value
}
async function screenshot(name) {
  await page.screenshot({ path: join(screenshots, `${name}.png`), fullPage: true, mask: [page.locator('input[type=password]')] })
}
async function dismissOnboarding() {
  // The notice is saved on the Host, while a missing-key prompt may reappear in
  // a fresh browser. Wait for the real shell before inspecting either modal.
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).waitFor()
  for (let attempt = 0; attempt < 8; attempt++) {
    let dismissed = false
    for (const name of [/^(继续|Continue)$/, /^(稍后配置|Configure later|Maybe later)$/, /^(使用其他模型|Use another model)$/]) {
      const button = page.getByRole('button', { name }).last()
      if (await button.isVisible()) { await button.click(); dismissed = true }
    }
    // The first key prompt follows the asynchronous notice/settings read, so
    // one frame without a dialog is not evidence that onboarding is finished.
    if (attempt >= 5 && !dismissed && await page.getByRole('dialog').count() === 0) return
    await delay(200)
  }
}
async function openSettings(section) {
  const close = page.getByRole('button', { name: /^(关闭|Close)$/ }).last()
  if (!(await close.isVisible())) await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
  await page.getByRole('button', { name: section }).click()
}
async function closeSettings() {
  const close = page.getByRole('button', { name: /^(关闭|Close)$/ }).last()
  if (await close.isVisible()) await close.click()
}
async function listen(server) {
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept) })
  return server.address().port
}
async function localModelFixture() {
  const key = `eduwork-ci-${randomUUID()}`
  secrets.add(key)
  const requests = []
  const server = createServer((request, response) => {
    // A synthetic model catalog verifies credential forwarding without spending
    // credits, sending user content, or pretending to assess model quality.
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname
    const authenticated = request.headers.authorization === `Bearer ${key}`
    const observed = { method: request.method, pathname, authenticated, at: Date.now(), bodyBytes: 0 }
    requests.push(observed)
    if (!authenticated) { response.writeHead(401).end(); return }
    if (request.method === 'GET' && pathname === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ object: 'list', data: [{ id: 'eduwork-ci-model', object: 'model', created: 0, owned_by: 'local-fixture' }] }))
      return
    }
    if (request.method === 'POST' && pathname === '/v1/chat/completions') {
      // Consume the prompt before ending the response; early replies can race uploads.
      request.on('data', bytes => { observed.bodyBytes += bytes.length })
      request.once('aborted', () => { observed.aborted = true; response.destroy() })
      request.once('error', () => response.destroy())
      request.once('end', () => {
        observed.received = true
        response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
        const chunk = { id: 'synthetic-ci', object: 'chat.completion.chunk', created: 0, model: 'eduwork-ci-model' }
        response.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'Synthetic local CI reply.' }, finish_reason: null }] }) + '\n\n')
        response.write('data: ' + JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\n')
        response.end('data: [DONE]\n\n')
      })
      return
    }
    response.writeHead(404).end()
  })
  const port = await listen(server)
  return { server, key, requests, baseURL: `http://127.0.0.1:${port}/v1` }
}

try {
  assert.equal(identity.kind, 'eduwork-web', 'Use an assembled EduWork Web product')
  assert.ok(identity.brand?.product?.name, 'Assembly must declare product identity')
  assert.equal(typeof identity.capabilities?.institution, 'boolean')
  assert.equal(typeof identity.capabilities?.images, 'boolean')
  await check('frozen-package-identity', async () => {
    const runtime = await readJSON(join(options.assembly, 'd/.chatecnu-dsh-runtime.json'))
    const dsh = await readJSON(join(options.assembly, 'd/node_modules/@deepseek-ai/dsh/package.json'))
    assert.equal(runtime.dshVersion, identity.dshVersion)
    assert.equal(dsh.version, identity.dshVersion)
    assert.equal(runtime.dshCommit, identity.dshCommit)
    if (identity.runtimeMode === 'npm') assert.equal(runtime.source, 'npm-lock')
    if (identity.runtimeMode === 'source') assert.equal(runtime.source, 'source-release-pack')
    assert.equal(runtime.source === 'npm-lock' ? runtime.packageLockSHA256 : runtime.sourceInstallLockSHA256, identity.runtimeLockSHA256)
    for (const [name, receipt] of Object.entries(identity.managedPackages)) {
      const installed = await readJSON(join(options.assembly, 'd/node_modules', name, 'package.json'))
      assert.equal(installed.name, name)
      assert.equal(installed.version, receipt.version, `${name} must match assembly receipt`)
      assert.match(receipt.tarballSHA256, /^[a-f0-9]{64}$/i, `${name} must identify inspected bytes`)
    }
    assert.match(identity.runtimeLockSHA256, /^[a-f0-9]{64}$/i)
    assert.equal(new Set(identity.skills).size, identity.skills.length, 'No duplicate packaged skill names')
    assert.ok(!identity.skills.some(name => /wiki/i.test(name)), 'Wiki is not shipped in this edition')
    if (!identity.capabilities.images) assert.ok(!identity.skills.some(name => /image|图像/i.test(name)), 'No image-generation skill without image capability')
    return { packages: Object.fromEntries(Object.entries(identity.managedPackages).map(([name, row]) => [name, row.version])) }
  })
  if (options.config) {
    configPath = options.config
    config = await readJSON(configPath)
    assert.equal(resolve(config.assembly), options.assembly, 'Private config must point at this exact assembly')
  } else {
    const socket = createServer()
    const port = await listen(socket)
    await new Promise(accept => socket.close(accept))
    const isolatedHome = join(evidence, 'os-home')
    await mkdir(isolatedHome)
    config = { assembly: options.assembly, home: join(evidence, 'home'), logs: join(evidence, 'logs'),
      profileName: `eduwork-ci-${runID}`, port,
      environment: options.mode === 'clean-ci' ? { HOME: isolatedHome, USERPROFILE: isolatedHome } : undefined }
    configPath = join(evidence, 'web.private.json')
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n')
    owned = true
    await lifecycle('start')
  }
  const brandOverride = config.pluginConfig?.['eduwork-brand-settings']
  if (brandOverride) expectedBrand = { ...identity.brand, ...brandOverride,
    product: { ...identity.brand.product, ...brandOverride.product } }
  const bootstrapURL = await eventually(async () => {
    const value = (await readFile(join(config.logs, 'url.txt'), 'utf8')).trim()
    const url = new URL(value)
    assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1', 'Only a local single-user Web may be tested')
    assert.equal(Number(url.port), config.port)
    const token = url.searchParams.get('token')
    if (token) secrets.add(token)
    const response = await fetch(value, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
    const established = response.headers.getSetCookie().map(row => row.split(';')[0]).join('; ')
    if (!established) return false
    base = url.origin
    cookie = established
    secrets.add(cookie)
    return value
  }, 'Loader did not establish local authenticated Web', 60000)
  checks.push({ name: 'loader-authenticated-http', passed: true, reused: !owned })

  await check('studio-capabilities', async () => {
    capabilities = await rpc('knowledgeStudio/listCapabilities')
    const readiness = studioReadiness(capabilities, options.mode)
    if (options.mode === 'clean-ci') {
      const repeated = studioReadiness(await rpc('knowledgeStudio/listCapabilities'), options.mode)
      assert.deepEqual(repeated, readiness, 'Clean-CI readiness and unavailable reasons must be stable across reads')
    }
    return { mode: options.mode, ...readiness }
  })
  await check('oidc-profile-policy', async () => {
    oidc = await rpc('oidcAccounts/configuration')
    const expectedIDs = await configuredOIDCProfileIDs(config, await readJSON(join(options.assembly, 'composition.json')))
    return oidcProfilePolicy(oidc, expectedIDs)
  })
  await check('memory-rpc-and-settings-registration', async () => {
    const stats = await rpc('localMemories/stats')
    const records = await rpc('localMemories/listRecords', { request: JSON.stringify({ offset: 0, limit: 10 }) })
    assert.ok(Number.isInteger(stats.total))
    assert.ok(Array.isArray(records.items))
    settings = await rpc('settings/describe')
    for (const ns of ['dsh-mail-assistant', 'memories']) assert.equal(settings.namespaces.filter(row => row.ns === ns).length, 1, `${ns} must register once`)
    const brand = settings.namespaces.find(row => row.ns === 'chatecnu-brand')
    assert.equal(brand?.base?.product?.name, expectedBrand.product.name, 'Brand is a product configuration, not an OIDC provider label')
    savedStyle = brand.value.visualStyle
    savedStudioOpen = await rpc('knowledgeStudio/readUIPreferences')
    return { memoryRecords: stats.total, namespaces: ['dsh-mail-assistant', 'memories'] }
  })
  await check('actual-agent-skill-catalog', async () => {
    const managed = await rpc('workbench/catalog')
    assert.deepEqual(managed.skills.filter(row => row.source === 'builtin').map(row => row.name).sort(), [...identity.skills].sort(), 'Skill management before creating a session must reflect the actual assembly')
    const path = join(evidence, `workspace-${runID}`)
    await mkdir(path)
    workspace = (await rpc('workspace/create', { request: { path } })).workspace
    assert.ok(workspace.workspaceId, 'Official Workspace projection must identify the workspace')
    session = await rpc('session/create', { request: { workspaceId: workspace.workspaceId } })
    await rpc('session/rename', { request: { sessionId: session.sessionId, title: `CI Studio ${runID}` } })
    const catalog = await rpc('skills/list', { request: { sessionId: session.sessionId } })
    const names = catalog.skills.map(row => row.name)
    assert.equal(names.length, new Set(names).size, 'The real Agent catalog must not repeat names')
    const undeclared = names.filter(name => !identity.skills.includes(name))
    assert.equal(undeclared.length, 0, `Do not expose undeclared/duplicate legacy skills: ${undeclared.join(', ')}`)
    const { parse } = createRequire(join(options.assembly, 'd/package.json'))('yaml')
    const metadata = await Promise.all(identity.skills.map(async name => {
      const text = await readFile(join(options.assembly, 'skills', name, 'SKILL.md'), 'utf8')
      const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
      assert.ok(header, `${name} must have a skill declaration`)
      const data = parse(header[1])
      assert.equal(data.name, name)
      return { name, credential: data.metadata?.eduwork?.credentialRef ?? data.metadata?.chatecnu?.credentialRef, account: data.metadata?.eduwork?.oidcProfileId, capability: data.metadata?.artifact?.capability }
    }))
    const refs = [...new Set(metadata.map(row => row.credential).filter(Boolean))]
    const credentials = refs.length ? await rpc('credentials/describe', { refs }) : {}
    const policy = settings.namespaces.find(row => row.ns === 'chatecnu-skills')?.value ?? {}
    const disabled = new Set([...(policy.disabled ?? []), ...(policy.defaultDisabled ?? []).filter(name => !(policy.enabled ?? []).includes(name))])
    const gated = []
    for (const row of metadata) {
      if (disabled.has(row.name) || row.credential && !credentials[row.credential]?.configured) {
        assert.ok(!names.includes(row.name), `${row.name} must respect its settings/credential gate`)
        gated.push({ name: row.name, reason: disabled.has(row.name) ? 'disabled in settings' : 'credential not configured' })
      } else if ((row.capability || row.account) && !names.includes(row.name)) {
        // Runtime provider readiness is separate from edition support: an
        // institution may ship image support before the user has logged in.
        gated.push({ name: row.name, reason: `runtime capability/account gate: ${row.capability ?? row.account}` })
      } else assert.ok(names.includes(row.name), `Ungated skill ${row.name} must be visible`)
    }
    return { skills: names, gated }
  })
  const require = createRequire(join(options.assembly, 'd/package.json'))
  const { chromium } = require('playwright-core')
  const executable = process.env.DSH_MEDIA_BROWSER || config.environment?.DSH_MEDIA_BROWSER
  browser = await chromium.launch({ headless: true, ...(executable ? { executablePath: executable } : process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => browserErrors.push({ type: 'pageerror', message: redact(error.message) }))
  page.on('console', message => { if (message.type() === 'error') browserErrors.push({ type: 'console', message: redact(message.text()), url: redact(message.location().url) }) })
  await page.goto(bootstrapURL, { waitUntil: 'domcontentloaded' })
  await check('product-welcome-policy', async () => {
    const description = await rpc('settings/describe')
    const onboarding = description.namespaces.find(row => row.ns === 'ui-onboarding')
    assert.equal(onboarding?.value?.welcomeNoticeVersion, identity.brand.upstreamWelcomeNoticeVersion)
    assert.ok(identity.brand.upstreamWelcomeNoticeVersion, 'Product must explicitly acknowledge the pinned upstream notice')
    await page.getByRole('button', { name: /^(设置|Settings)$/ }).waitFor()
    assert.equal(await page.getByRole('button', { name: /^(继续|Continue)$/ }).count(), 0, 'Upstream testing notice must not appear on a fresh installation')
    return { noticeVersion: onboarding.value.welcomeNoticeVersion }
  })
  await dismissOnboarding()

  await check('browser-public-workbench', async () => {
    await page.evaluate(() => { (window.__eduworkTrayActions ??= []).push('new-session'); window.dispatchEvent(new Event('eduwork:tray-action')) })
    await page.getByText(/今天想一起完成什么/).first().waitFor()
    await page.getByText(releaseIdentity(identity.version, identity.dshVersion).badge.zh, { exact: true }).waitFor()
    await openSettings(/^(插件|Plugins)$/)
    await page.getByRole('tab', { name: '技能', exact: true }).click()
    await page.getByRole('searchbox', { name: '搜索技能' }).waitFor()
    for (const name of identity.skills) {
      await page.locator(`[data-skill-name="${name}"]`).waitFor()
      assert.equal(await page.locator(`[data-skill-name="${name}"]`).count(), 1, `${name} appears exactly once`)
    }
    if (!identity.capabilities.institution) assert.equal(await page.locator('[data-skill-name="ecnu-campus-search"]').count(), 0)
    await screenshot('skills-without-active-session')
    const skill = `ci-personal-${runID.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`.slice(0, 60)
    await page.getByRole('button', { name: '创建技能', exact: true }).click()
    const form = page.getByRole('dialog', { name: '创建个人技能' })
    await form.getByLabel('技能标识').fill(skill)
    await form.getByLabel('用途说明').fill('Synthetic local skill acceptance')
    await form.getByLabel('工作指令').fill('Only for the isolated test workspace. Return a short test reply.')
    await form.getByRole('button', { name: '创建', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    const row = page.locator(`[data-skill-name="${skill}"]`), toggle = row.getByRole('switch')
    await toggle.click(); await eventually(async () => await toggle.getAttribute('aria-checked') === 'false', 'Skill switch persists')
    await toggle.click(); await eventually(async () => await toggle.getAttribute('aria-checked') === 'true', 'Skill can be re-enabled')
    await row.getByRole('button', { name: '移除', exact: true }).click()
    await page.getByRole('dialog', { name: '移除个人技能' }).getByRole('button', { name: '移除', exact: true }).click()
    await row.waitFor({ state: 'detached' })
    await openSettings(/^(个人概览|Activity)$/)
    await page.getByText(/^(累计 Token 数|Lifetime tokens)$/).waitFor()
    await openSettings(/^(通用设置|General)$/)
    await page.getByText('自动更新', { exact: true }).waitFor()
    await page.getByRole('button', { name: '导出诊断', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: '更新与桌面诊断请在客户端中使用' }).waitFor()
    assert.equal(await page.getByText('诊断信息已生成。', { exact: true }).count(), 0, 'Web must not claim a native diagnostics export')
    await screenshot('public-workbench')
    return { skills: identity.skills.length, personalCRUD: true, localActivity: true, desktopSettings: true }
  })

  await check('browser-brand-and-theme', async () => {
    assert.ok((await page.title()) === expectedBrand.product.name || (await page.title()).endsWith(' — ' + expectedBrand.product.name))
    await openSettings(/^(通用设置|General)$/)
    const colors = {}
    for (const [style, fallback] of [['dsh', '蓝色'], ['ecnu-liwa', '红色']]) {
      const label = expectedBrand.product.styleLabels?.[style] ?? fallback
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
      await eventually(async () => {
        const current = (await rpc('settings/describe')).namespaces.find(row => row.ns === 'chatecnu-brand')
        return current.value.visualStyle === style
      }, `Theme ${style} was not saved`)
      colors[style] = await page.locator('body').evaluate(element => getComputedStyle(element).getPropertyValue('--dsw-alias-brand-primary').trim())
      assert.ok((await page.title()) === expectedBrand.product.name || (await page.title()).endsWith(' — ' + expectedBrand.product.name))
      await screenshot(`theme-${style}`)
    }
    assert.ok(colors.dsh && colors['ecnu-liwa'] && colors.dsh !== colors['ecnu-liwa'], 'Global theme tokens must actually change')
    return { productName: expectedBrand.product.name, colors }
  })
  await check('browser-optional-preset-policy', async () => {
    assert.ok(owned, 'Preset switch acceptance requires an isolated test home')
    const ids = async () => (await rpc('agentPresets/list')).presets
    let rows = await ids()
    assert.ok(!rows.some(row => ['minimal', 'cordis'].includes(row.id)), 'Optional presets must start disabled')
    await openSettings(/^(Agent 预设|Agent presets)$/)
    for (const [id, title] of [['minimal', '极简模式'], ['cordis', '创造模式']]) {
      await page.getByRole('switch', { name: `启用${title}`, exact: true }).locator('..').click()
      await eventually(async () => (await ids()).some(row => row.id === id), `Enabling ${id} did not change the real roster`)
      rows = await ids()
      assert.equal(rows.find(row => row.id === id)?.broken, undefined, `${id} must load without a composition error`)
      await page.getByRole('switch', { name: `关闭${title}`, exact: true }).waitFor()
      await screenshot(`preset-${id}-enabled`)
      await page.getByRole('switch', { name: `关闭${title}`, exact: true }).locator('..').click()
      await eventually(async () => !(await ids()).some(row => row.id === id), `Disabling ${id} did not change the real roster`)
    }
    const settings = (await rpc('settings/describe')).namespaces.find(row => row.ns === 'chatecnu-brand')
    assert.deepEqual(settings.value.enabledOptionalPresets, [])
    return { defaultOff: ['minimal', 'cordis'], browserToggleRoundTrips: 2, realRosterHealthy: true }
  })
  await check('component-inventory-real-assembly', async () => {
    const inventory = await rpc('productComponents/list')
    assert.equal(inventory.release.productVersion, identity.version)
    assert.equal(inventory.release.dshVersion, identity.dshVersion)
    assert.equal(inventory.components.find(row => row.id === 'nodejs')?.version, process.versions.node)
    return { productVersion: inventory.release.productVersion, components: inventory.components.map(row => row.id) }
  })
  await check('browser-mail-settings', async () => {
    await openSettings(/^(邮件助手|Mail assistant)$/)
    await page.getByText(/^(邮箱账号|Mailbox account)$/).waitFor()
    for (const name of [/^(允许 Agent 读信|Allow the agent to read mail)/, /^(允许 Agent 发信|Allow the agent to send mail)/]) {
      assert.equal(await page.getByRole('checkbox', { name }).count(), 1)
    }
    assert.doesNotMatch(await page.locator('body').innerText(), /当前 DSH 连接未提供|does not expose the mail settings namespace|Failed to load plugins/)
    await screenshot('mail-settings')
  })
  await check('browser-memory-settings', async () => {
    await openSettings(/^(个性化|Personalization)$/)
    const toggle = page.getByRole('switch', { name: /^(启用本地 Memory|Enable local memories)$/ })
    await toggle.waitFor()
    assert.equal(await toggle.count(), 1)
    await page.getByRole('button', { name: /^(管理 Memory|Manage memories)$/ }).waitFor()
    await screenshot('memory-settings')
  })
  await check('browser-personal-key-and-model-discovery', async () => {
    modelFixture = await localModelFixture()
    customProvider = `eduwork-ci-${runID}`
    customCredential = `${customProvider.toUpperCase().replaceAll('-', '_')}_API_KEY`
    await openSettings(/^(模型|Models)$/)
    await page.getByRole('button', { name: /^(添加自定义提供方|Add custom provider)$/ }).click()
    await page.getByRole('textbox', { name: 'Provider ID', exact: true }).fill(customProvider)
    await page.getByRole('textbox', { name: /^(显示名称|Display name)$/, exact: true }).last().fill('EduWork CI local fixture')
    await page.getByRole('textbox', { name: /^(API 地址|API URL)$/, exact: true }).last().fill(modelFixture.baseURL)
    await page.getByLabel(/^(API 密钥|API key)$/, { exact: true }).last().fill(modelFixture.key)
    await page.getByRole('button', { name: /^(获取可用模型|Fetch available models)$/ }).last().click()
    await page.getByRole('button', { name: /^(添加所选|Add selected)$/ }).click()
    await page.getByRole('button', { name: /^(创建提供方|Create provider)$/ }).click()
    await eventually(async () => {
      const catalog = await rpc('session/modelCatalog')
      return catalog.groups.some(row => row.id === customProvider && row.models.some(model => model.id === 'eduwork-ci-model'))
    }, 'Saved personal provider did not enter the real Host model catalog')
    // Official provider creation writes configuration, then credentials. A
    // catalog refresh can arrive before the final save completes.
    await page.getByRole('button', { name: /^(创建提供方|Create provider)$/ }).waitFor({ state: 'hidden' })
    await eventually(async () => (await rpc('credentials/describe', { refs: [customCredential] }))[customCredential]?.configured === true,
      'The user-supplied API key must be stored after provider creation completes')
    assert.ok(modelFixture.requests.some(row => row.pathname === '/v1/models' && row.authenticated), 'Real discovery must forward the supplied key to the localhost fixture')
    await screenshot('personal-model-configured')
    return { localCatalogRequests: modelFixture.requests.length, identityLoginRequired: false, scope: 'Browser configuration and actual HTTP model discovery; no inference-quality claim' }
  })
  await check('browser-studio-entry', async () => {
    assert.ok(workspace, 'Test workspace must have been created')
    // Official rc sidebar belongs to a conversation, not the blank composer.
    // Exercise one real Host turn against only our loopback synthetic provider.
    await rpc('session/selectModel', { request: { sessionId: session.sessionId, provider: customProvider, model: 'eduwork-ci-model' } })
    // A fresh Windows CI Host can spend over 30 seconds initializing its first
    // model turn. Keep this budget local to the cold turn, not all RPC/UI calls.
    const turnTimeoutMs = options.mode === 'clean-ci' ? 120000 : 30000
    const turnDeadline = Date.now() + turnTimeoutMs
    await rpc('session/prompt', { request: { sessionId: session.sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Synthetic local CI check. Reply without tools.' }] } })
    await eventually(async () => {
      const state = (await rpc('session/list', { _request: {} }, { timeoutMs: Math.max(1, turnDeadline - Date.now()) })).items.find(row => row.sessionId === session.sessionId)
      return state && !state.running && modelFixture.requests.some(row => row.pathname === '/v1/chat/completions' && row.received)
    }, 'Synthetic local conversation did not finish', Math.max(1, turnDeadline - Date.now()))
    await rpc('session/rename', { request: { sessionId: session.sessionId, title: `CI Studio ${runID}` } })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dismissOnboarding()
    await closeSettings()
    const name = basename(workspace.path ?? join(evidence, `workspace-${runID}`))
    // Selecting the test workspace uses the same official workspace sidebar as
    // normal navigation. No private React state or service is reached here.
    const workspaceItem = page.getByRole('treeitem').filter({ has: page.getByText(name, { exact: true }) }).first()
    if (await workspaceItem.getAttribute('aria-expanded') === 'false') await workspaceItem.getByText(name, { exact: true }).click()
    await page.getByRole('treeitem').getByText(`CI Studio ${runID}`, { exact: true }).first().click()
    const expand = page.locator('[data-sidebar-right-expand]')
    if (await expand.count()) await expand.click()
    const studioTab = page.getByRole('tab').filter({ has: page.locator('[data-dockkit-tab-title]', { hasText: /^Studio$/ }) })
    if (await studioTab.count()) await studioTab.click()
    else {
      const guide = page.getByRole('button', { name: 'Studio 从工作区资料创建成果', exact: true })
      if (!await guide.isVisible()) await page.getByRole('button', { name: '新标签页', exact: true }).click()
      await guide.click()
    }
    await page.getByText(/^(最近成果|Recent artifacts|Recent results)$/).waitFor()
    for (const capability of capabilities) await page.getByText(capability.title, { exact: true }).last().waitFor()
    assert.doesNotMatch(await page.locator('body').innerText(), /工作区 Wiki|打开 Wiki|Build Wiki|Workspace Wiki|展开阅读/)
    await screenshot('studio-open')
    return { entry: 'User-visible Studio from official workspace navigation', capabilityCount: capabilities.length }
  })
  await check('browser-tray-settings-and-new-session', async () => {
    const dispatch = action => page.evaluate(value => {
      (window.__eduworkTrayActions ??= []).push(value)
      window.dispatchEvent(new Event('eduwork:tray-action'))
    }, action)
    await closeSettings()
    await dispatch('settings')
    await page.getByRole('button', { name: /^(通用设置|General)$/ }).waitFor()
    await closeSettings()
    await dispatch('new-session')
    await page.getByText(/今天想一起完成什么/).first().waitFor()
    assert.ok((await rpc('session/list', { _request: {} })).items.some(row => row.sessionId === session.sessionId), 'Starting another session preserves the previous session')
    assert.deepEqual(await page.evaluate(() => window.__eduworkTrayActions), [])
    await screenshot('tray-new-session')
    return { settings: 'official settings shell', newSession: 'official uiWorkspace navigation', nativeMenu: 'validated separately' }
  })
  await check('browser-runtime-errors', async () => {
    assert.deepEqual(browserErrors, [], 'Real browser must load without console/page errors; see result.json')
  })
} catch (error) {
  checks.push({ name: 'acceptance-infrastructure', passed: false, error: redact(error.message).slice(0, 1800) })
  console.error(`FAIL acceptance-infrastructure: ${redact(error.message).split('\n')[0].slice(0, 250)}`)
} finally {
  // Touch only test-created objects and the two explicitly exercised preferences.
  // A reused Web may be under parallel inspection; never replace whole settings.
  const clean = async (name, operation) => { try { await operation() } catch (error) { cleanupErrors.push({ name, error: redact(error.message).slice(0, 500) }) } }
  if (cookie) {
    if (customCredential) await clean('test-credential', () => rpc('credentials/unset', { ref: customCredential }))
    if (customProvider) await clean('test-provider', () => rpc('settings/mutate', { ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', customProvider] }] }))
    if (savedStyle) await clean('restore-theme', () => rpc('settings/update', { ns: 'chatecnu-brand', patch: { visualStyle: savedStyle } }))
    if (typeof savedStudioOpen?.open === 'boolean') await clean('restore-studio-preference', () => rpc('knowledgeStudio/setUIOpenPreference', { open: savedStudioOpen.open }))
    if (workspace?.workspaceId) await clean('test-workspace-registration', () => rpc('workspace/delete', { request: { workspaceId: workspace.workspaceId } }))
  }
  await browser?.close().catch(error => cleanupErrors.push({ name: 'browser', error: redact(error.message) }))
  if (modelFixture) await new Promise(accept => modelFixture.server.close(accept))
  if (owned) await clean('owned-web-stop', () => lifecycle('stop'))
  const result = { schemaVersion: 1, mode: options.mode, passed: checks.length > 0 && checks.every(row => row.passed) && cleanupErrors.length === 0,
    completedAt: new Date().toISOString(), assembly: options.assembly, distribution: identity.distribution,
    brand: expectedBrand.product.name, brandOverride: Boolean(config?.pluginConfig?.['eduwork-brand-settings']), capabilities: identity.capabilities, dshVersion: identity.dshVersion,
    dshCommit: identity.dshCommit, runtimeLockSHA256: identity.runtimeLockSHA256,
    packageReceipts: identity.managedPackages, checks, calls, browserErrors, cleanupErrors,
    syntheticModelRequests: modelFixture?.requests ?? [],
    coverage: { realLoader: checks.some(row => row.name === 'loader-authenticated-http' && row.passed),
      realHTTP: calls.some(row => row.ok), realBrowser: checks.some(row => row.name.startsWith('browser-') && row.passed), realModelInference: false,
      realOAuthLogin: false, realMailDelivery: false, artifactRenderingQuality: false },
    note: options.mode === 'clean-ci'
      ? 'Explicit clean-CI wiring/readiness acceptance. Unavailable capabilities are reported, not treated as executable. OAuth/heartbeat, live providers and artifact generation/preview/export need separate evidence.'
      : 'Full-ready Host capability and local product wiring acceptance. OAuth/heartbeat, live providers, eight artifact generation/preview/export quality need their separate evidence.' }
  await writeFile(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ passed: result.passed, distribution: result.distribution,
    checks: checks.length, failed: checks.filter(row => !row.passed).map(row => row.name),
    cleanupFailures: cleanupErrors.length, evidence: join(evidence, 'result.json') }))
  if (!result.passed) process.exitCode = 1
}
}
