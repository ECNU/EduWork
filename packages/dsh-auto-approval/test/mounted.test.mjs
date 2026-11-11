import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { apply, Config } from '../lib/index.js'

// A local SystemOne-compatible service: `reply(body)` decides each response.
async function service(t, reply) {
  const bodies = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    bodies.push({ body, auth: req.headers.authorization })
    const out = await reply(body, bodies.length)
    if (out === undefined) return // hang until the client gives up
    res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out.json ?? {}))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1`, bodies }
}
const answer = (body, auto, harm) => ({ json: {
  answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, id === 'harm' ? { type: 'noul', noul: harm } : { type: 'choice', choice: auto >= 0.5 ? 'auto' : 'ask', probabilities: { auto, ask: 1 - auto } }])),
} })

function mount(config, { preset = 'auto-approval', services = {}, events = [] } = {}) {
  const listeners = {}, logs = []
  const ctx = {
    on(name, listener, options) { (listeners[name] ??= [])[options?.prepend ? 'unshift' : 'push'](listener) },
    logger: () => ({ info: (...args) => logs.push(['info', ...args]), warn: (...args) => logs.push(['warn', ...args]) }),
    get: name => services[name],
    permissionPresets: { current: () => preset },
    workingDirectory: { get: () => '/work' },
  }
  apply(ctx, config)
  const agent = { session: { id: 'session-1', snapshotEvents: () => events } }
  let calls = 0
  async function escalate(command, { name = 'bash', fallback = 'rejected', signal, workdir } = {}) {
    const callId = `call-${++calls}`
    await listeners['tools/pre-execute'][0]({ name, callId, agent, arguments: { command, sandbox_permissions: 'danger-full-access', justification: '写到下载目录', ...(workdir && { workdir }) } }, async () => ({ kind: 'allow' }))
    return listeners['approval/request'][0]({ agent, toolName: name, callId, reason: 'escalate sandbox to danger-full-access: 写到下载目录', signal }, async () => fallback)
  }
  return { listeners, logs, escalate }
}
const base = { enabled: true, model: 'fixture-model', authMode: 'none' }

test('disabled by default: nothing is registered', () => {
  assert.deepEqual(mount({}).listeners, {})
  assert.ok(Config)
})

test('a plain request asks two questions and is approved on their mean; a rule hit asks one with the stricter threshold', async t => {
  const { baseURL, bodies } = await service(t, body => answer(body, 0.8, 0.3))
  const { escalate, logs } = mount({ ...base, baseURL }, { events: [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '把结果导出到下载目录' }] } }] })
  assert.equal(await escalate('mkdir -p ~/Downloads/out && cp out.csv ~/Downloads/out/'), 'allowed-once')
  assert.equal(bodies.length, 2)
  assert.deepEqual(bodies.map(b => Object.keys(b.body.questions)).sort(), [['decision'], ['harm']])
  assert.equal(bodies[0].body.model, 'fixture-model')
  assert.equal(bodies[0].body.state.待执行的命令, 'mkdir -p ~/Downloads/out && cp out.csv ~/Downloads/out/')
  assert.deepEqual(bodies[0].body.state.用户最近的消息, ['把结果导出到下载目录'])
  assert.equal(bodies[0].body.state.申请理由, '写到下载目录')
  assert.match(bodies[0].body.state.系统, /shell 为 bash$/)
  assert.equal(bodies[0].auth, undefined)
  assert.equal(bodies[0].body.state.工作区, '/work')
  assert.equal(bodies[0].body.state.当前目录, '/work')
  assert.equal(await escalate('git push origin main', { workdir: 'site' }), 'allowed-once')
  assert.equal(bodies.length, 3)
  assert.equal(bodies[2].body.state.工作区, '/work')
  assert.equal(bodies[2].body.state.当前目录, '/work/site')
  assert.deepEqual(Object.keys(bodies[2].body.questions), ['decision'])
  assert.match(bodies[2].body.state.风险标记, /^推送和发布/)
  assert.match(logs.at(-1)[1], /approved/)
})

test('low scores, other presets and other tools go to the user unchanged', async t => {
  const { baseURL, bodies } = await service(t, body => answer(body, 0.65, 0.2))
  assert.equal(await mount({ ...base, baseURL }).escalate('git push origin main', { fallback: 'rejected' }), 'rejected')
  assert.equal(bodies.length, 1)
  assert.equal(await mount({ ...base, baseURL }, { preset: 'workspace-write' }).escalate('ls ~/Downloads', { fallback: 'allowed-once' }), 'allowed-once')
  assert.equal(await mount({ ...base, baseURL }).escalate('ls ~/Downloads', { name: 'write', fallback: 'cancelled' }), 'cancelled')
  assert.equal(bodies.length, 1)
})

test('one retry for 5xx; failures, malformed answers and timeouts ask the user; three in a row pause the review', async t => {
  let mode = 'flaky'
  const { baseURL, bodies } = await service(t, (body, n) => {
    if (mode === 'flaky') return n % 2 ? { status: 503 } : answer(body, 0.9, 0.1)
    if (mode === 'malformed') return { json: { answers: { decision: { type: 'choice', choice: 'auto' } } } }
    if (mode === 'hang') return undefined
    return { status: 500 }
  })
  const mounted = mount({ ...base, baseURL, timeoutMs: 1000 })
  assert.equal(await mounted.escalate('git push origin main'), 'allowed-once')
  assert.equal(bodies.length, 2)
  mode = 'malformed'
  assert.equal(await mounted.escalate('git push origin main'), 'rejected')
  mode = 'down'
  assert.equal(await mounted.escalate('git push origin main'), 'rejected')
  assert.equal(bodies.length, 5) // the 500 was retried once
  mode = 'hang'
  const started = performance.now()
  assert.equal(await mounted.escalate('git push origin main'), 'rejected')
  assert.ok(performance.now() - started < 3000)
  const asked = bodies.length
  assert.equal(await mounted.escalate('git push origin main'), 'rejected')
  assert.equal(bodies.length, asked, 'paused after three failures in a row')
  assert.equal(mounted.logs.filter(([level]) => level === 'warn').length, 3)
})

test('API key and organization sign-in: no key or no sign-in asks the user and never falls back', async t => {
  const { baseURL, bodies } = await service(t, body => answer(body, 0.9, 0.1))
  const keyed = mount({ ...base, baseURL, authMode: 'api-key' }, { services: { credentials: { resolve: async ref => (assert.equal(ref, 'SYSTEMONE_API_KEY'), { value: 'SYNTHETIC_KEY' }) } } })
  assert.equal(await keyed.escalate('git push origin main'), 'allowed-once')
  assert.equal(bodies[0].auth, 'Bearer SYNTHETIC_KEY')
  assert.equal(await mount({ ...base, baseURL, authMode: 'api-key' }).escalate('git push origin main'), 'rejected')
  const signedOut = { modelAuthorization: async () => false, authorizedFetch: () => assert.fail('not signed in') }
  assert.equal(await mount({ ...base, baseURL, authMode: 'oidc', oidcProfileId: 'org' }, { services: { oidcAccounts: signedOut } }).escalate('git push origin main'), 'rejected')
  let seen
  const signedIn = { modelAuthorization: async (id, url) => id === 'org' && url === baseURL, authorizedFetch: (id, url, init) => { seen = id; return fetch(url, init) } }
  assert.equal(await mount({ ...base, baseURL, authMode: 'oidc', oidcProfileId: 'org' }, { services: { oidcAccounts: signedIn } }).escalate('git push origin main'), 'allowed-once')
  assert.equal(seen, 'org')
  assert.equal(bodies.length, 2)
})

test('a withdrawn request is not counted as a failure', async t => {
  const { baseURL } = await service(t, () => undefined)
  const mounted = mount({ ...base, baseURL })
  const controller = new AbortController()
  const pending = mounted.escalate('git push origin main', { signal: controller.signal, fallback: 'cancelled' })
  setTimeout(() => controller.abort(), 50)
  assert.equal(await pending, 'cancelled')
  assert.equal(mounted.logs.length, 0)
})

test('the bundle ships disabled under one plugin ID with no institution defaults', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(manifest.name, '@eduwork/dsh-auto-approval'); assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /id: auto-approval/); assert.match(patch, /enabled: false/)
  for (const file of ['index.js', 'review.js', 'rules.js', 'questions.js']) assert.doesNotMatch(await readFile(new URL('../lib/' + file, import.meta.url), 'utf8'), /ecnu|chatecnu|学校/i)
})
