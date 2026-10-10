// Tests for the device gate. A fake upstream stands in for the DSH host so the
// assertions can be about what does and does not reach it, which is the actual
// acceptance question: an unauthorised device must not reach sessions or files.
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DEVICE_COOKIE, DeviceStore, createGatedRelay, isLoopbackAddress, readDeviceCookie } from '../src/listener.js'
import { createInvitation, emptyInvitations } from '../src/pairing.js'

const temporaryDirectories = []
const openHosts = []

function storePath() {
  const directory = mkdtempSync(join(tmpdir(), 'eduwork-relay-'))
  temporaryDirectories.push(directory)
  return join(directory, 'devices.json')
}

test.after(() => {
  for (const host of openHosts) host.close()
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
})

/** An upstream that records every request it answers. `/api/stream` is held open
 * so a test can observe what happens to an established connection. */
async function fakeHost() {
  const seen = []
  const held = []
  const server = http.createServer((request, response) => {
    seen.push({ url: request.url, host: request.headers.host })
    if (request.url === '/api/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('event: hello\n\n')
      held.push({ response, request })
      return
    }
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('from-host')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  openHosts.push(server)
  return { server, seen, held, port: server.address().port }
}

async function startRelay(options) {
  const relay = createGatedRelay(options)
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve))
  const { port } = relay.server.address()
  return { relay, store: relay.store, port, base: `http://127.0.0.1:${String(port)}` }
}

/** Pair a device end to end and return its cookie header. */
async function pair(base, store, { name = '测试手机', confirm = true } = {}) {
  const invitation = store.invite()
  const response = await fetch(`${base}/__remote/pair?token=${encodeURIComponent(invitation.code)}&name=${encodeURIComponent(name)}`, {
    redirect: 'manual',
  })
  assert.equal(response.status, 302)
  const setCookie = response.headers.get('set-cookie')
  assert.ok(setCookie, 'pairing must set a device cookie')
  const cookie = setCookie.split(';')[0]
  if (confirm) {
    const parsed = readDeviceCookie(cookie)
    store.confirm(parsed.deviceId)
  }
  return { cookie, deviceId: readDeviceCookie(cookie).deviceId }
}

test('readDeviceCookie parses the device cookie and ignores everything else', () => {
  assert.deepEqual(readDeviceCookie('a=1; eduwork_device=dev-1.secret; b=2'), { deviceId: 'dev-1', secret: 'secret' })
  assert.equal(readDeviceCookie('a=1; b=2'), undefined)
  assert.equal(readDeviceCookie('eduwork_device=no-dot'), undefined)
  assert.equal(readDeviceCookie('eduwork_device=.secret'), undefined)
  assert.equal(readDeviceCookie('eduwork_device=dev-1.'), undefined)
  assert.equal(readDeviceCookie(''), undefined)
  assert.equal(readDeviceCookie(undefined), undefined)
})

test('a request without a device cookie is answered by the relay and never reaches the host', async () => {
  const host = await fakeHost()
  const { relay, base } = await startRelay({ hostPort: host.port, store: new DeviceStore(storePath()) })
  const response = await fetch(`${base}/api/anything`)
  assert.equal(response.status, 401)
  assert.equal(host.seen.length, 0, 'an unauthorised request must not reach the host at all')
  await relay.close()
  host.server.close()
})

test('a forged device cookie is refused and never reaches the host', async () => {
  const host = await fakeHost()
  const { relay, base } = await startRelay({ hostPort: host.port, store: new DeviceStore(storePath()) })
  for (const cookie of ['eduwork_device=dev-1.forged', 'eduwork_device=.x', 'eduwork_device=dev-1.']) {
    const response = await fetch(`${base}/api/sessions`, { headers: { cookie } })
    assert.equal(response.status, 401, `${cookie} must be refused`)
  }
  assert.equal(host.seen.length, 0)
  await relay.close()
  host.server.close()
})

test('a paired and confirmed device reaches the host with the host header rewritten', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const { cookie } = await pair(base, store)
  const response = await fetch(`${base}/api/sessions`, { headers: { cookie } })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'from-host')
  assert.equal(host.seen.length, 1)
  assert.equal(host.seen[0].host, `127.0.0.1:${String(host.port)}`, 'the phone address must not be forwarded as Host')
  await relay.close()
  host.server.close()
})

test('a pending device is held until the operator decides', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const asked = []
  const { relay, base } = await startRelay({
    hostPort: host.port,
    store,
    onRequest: async (device) => {
      asked.push(device.deviceId)
      return true
    },
  })
  const { cookie, deviceId } = await pair(base, store, { confirm: false })
  const response = await fetch(`${base}/api/sessions`, { headers: { cookie } })
  assert.equal(response.status, 200)
  assert.deepEqual(asked, [deviceId], 'the operator must be asked about the pending device')
  assert.equal(store.device(deviceId).status, 'trusted')
  await relay.close()
  host.server.close()
})

test('a device the operator refuses never reaches the host', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store, onRequest: async () => false })
  const { cookie } = await pair(base, store, { confirm: false })
  const response = await fetch(`${base}/api/sessions`, { headers: { cookie } })
  assert.equal(response.status, 403)
  assert.equal(host.seen.length, 0, 'a refused device must not reach the host')
  await relay.close()
  host.server.close()
})

test('the operator is asked once, not once per request', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  let asked = 0
  const { relay, base } = await startRelay({
    hostPort: host.port,
    store,
    onRequest: async () => { asked += 1; return true },
  })
  const { cookie } = await pair(base, store, { confirm: false })
  await Promise.all([1, 2, 3, 4, 5].map(() => fetch(`${base}/api/sessions`, { headers: { cookie } })))
  assert.equal(asked, 1, 'five concurrent requests must not produce five prompts')
  await relay.close()
  host.server.close()
})

test('an invitation cannot be redeemed twice', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const invitation = store.invite()
  const first = await fetch(`${base}/__remote/pair?token=${encodeURIComponent(invitation.code)}`, { redirect: 'manual' })
  assert.equal(first.status, 302)
  const second = await fetch(`${base}/__remote/pair?token=${encodeURIComponent(invitation.code)}`, { redirect: 'manual' })
  assert.equal(second.status, 403, 'a replayed invitation must fail')
  // A wrong code must fail identically, so the response cannot be used to tell
  // a used invitation from a guessed one.
  const wrong = await fetch(`${base}/__remote/pair?token=totally-wrong`, { redirect: 'manual' })
  assert.equal(wrong.status, 403)
  await relay.close()
  host.server.close()
})

test('two devices pair independently and only the revoked one is cut off', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const first = await pair(base, store, { name: '手机 A' })
  const second = await pair(base, store, { name: '手机 B' })
  assert.equal((await fetch(`${base}/api/a`, { headers: { cookie: first.cookie } })).status, 200)
  assert.equal((await fetch(`${base}/api/b`, { headers: { cookie: second.cookie } })).status, 200)

  relay.revoke(first.deviceId)

  assert.equal((await fetch(`${base}/api/a`, { headers: { cookie: first.cookie } })).status, 401)
  assert.equal((await fetch(`${base}/api/b`, { headers: { cookie: second.cookie } })).status, 200)
  await relay.close()
  host.server.close()
})

test('revoking closes a live connection instead of only refusing the next request', async () => {
  // The acceptance item in its exact form. An SSE stream is the case that
  // matters: it keeps delivering model output for as long as it stays open, so a
  // relay that only refuses the *next* request leaves a revoked device watching
  // the session.
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const { cookie, deviceId } = await pair(base, store)

  let torn = false
  const response = await new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port: new URL(base).port, path: '/api/stream', headers: { cookie } })
    request.on('response', resolve)
    request.on('error', reject)
  })
  response.on('close', () => { torn = true })
  response.on('data', () => {})
  await new Promise(resolve => setTimeout(resolve, 50))

  assert.equal(host.held.length, 1, 'the stream must have reached the host')
  assert.equal(relay.connections.count(deviceId), 1, 'the stream must be registered as a live connection')

  relay.revoke(deviceId)
  await new Promise(resolve => setTimeout(resolve, 100))

  assert.equal(relay.connections.count(deviceId), 0, 'revocation must drop the live connection')
  assert.equal(relay.connections.isSealed(deviceId), true, 'the device must stay sealed')
  assert.equal(torn, true, 'the stream must actually be torn down, not merely left open')
  await relay.close()
})

test('a sealed device cannot open a new connection even in the same instant', async () => {
  // Otherwise a device that reconnects while the operator is revoking it slips
  // through the sweep and keeps its stream.
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const { cookie, deviceId } = await pair(base, store)
  relay.revoke(deviceId)
  const response = await fetch(`${base}/api/sessions`, { headers: { cookie } })
  assert.equal(response.status, 401, 'a revoked device must not authenticate again')
  assert.equal(host.seen.length, 0)
  await relay.close()
})

test('pairing lands on a waiting page rather than holding a request open', async () => {
  // A direct redirect would leave the phone's browser waiting on the host until
  // the operator presses y, and timing out if they take a moment. The waiting
  // page polls instead, so the phone shows progress and taking a minute is free.
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  let upstreamCalled = false
  const { relay, base } = await startRelay({
    hostPort: host.port,
    store,
    upstreamToken: () => { upstreamCalled = true; return 'tok-123' },
  })
  const invitation = store.invite()
  const pairing = await fetch(`${base}/__remote/pair?token=${encodeURIComponent(invitation.code)}`, { redirect: 'manual' })
  const location = pairing.headers.get('location') ?? ''
  assert.equal(pairing.status, 302)
  assert.equal(location.startsWith('/__remote/waiting'), true, location)
  assert.equal(decodeURIComponent(location).endsWith('/?token=tok-123'), true, 'the waiting page must carry the host exchange')
  assert.equal(upstreamCalled, true, 'the host token must be read when the redirect is built')

  const cookie = (pairing.headers.get('set-cookie') ?? '').split(';')[0]
  const page = await fetch(`${base}${location}`, { headers: { cookie } })
  const body = await page.text()
  assert.equal(page.status, 200)
  assert.equal(body.includes('/__remote/status'), true, 'the page must poll the relay, not the host')
  assert.equal(host.seen.length, 0, 'the waiting page must not reach the host')
  await relay.close()
  host.server.close()
})

test('the status endpoint tells a device about itself and nothing else', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store })

  const pending = await pair(base, store, { name: '手机', confirm: false })
  const before = await (await fetch(`${base}/__remote/status`, { headers: { cookie: pending.cookie } })).json()
  assert.deepEqual(before, { status: 'pending', name: '手机' })

  store.confirm(pending.deviceId)
  const after = await (await fetch(`${base}/__remote/status`, { headers: { cookie: pending.cookie } })).json()
  assert.equal(after.status, 'trusted')

  // No credential, and a forged one, both learn nothing.
  assert.equal((await fetch(`${base}/__remote/status`)).status, 401)
  assert.equal((await fetch(`${base}/__remote/status`, { headers: { cookie: 'eduwork_device=x.y' } })).status, 401)

  // The endpoint must never leak another device: it answers only about the
  // caller, so a second device cannot be observed through it.
  const other = await pair(base, store, { name: '笔记本' })
  const otherStatus = await (await fetch(`${base}/__remote/status`, { headers: { cookie: other.cookie } })).json()
  assert.equal(otherStatus.name, '笔记本')
  assert.equal(JSON.stringify(otherStatus).includes(pending.deviceId), false)

  store.revoke(pending.deviceId)
  assert.equal((await fetch(`${base}/__remote/status`, { headers: { cookie: pending.cookie } })).status, 401, 'a revoked credential stops answering')
  await relay.close()
  host.server.close()
})

test('every way an invitation can fail looks the same from outside', async () => {
  // The protocol document promises that a wrong code, a spent one, an expired one
  // and a missing one cannot be told apart. That is a security property, not a
  // nicety: if the answers differed, the endpoint would confirm which guesses were
  // closer, and it would also reveal whether an invitation had ever been issued.
  // Prose in a document does not hold that; this does.
  const path = storePath()
  // The store tolerates a missing file rather than creating one, so a first write
  // is what brings the state file into existence before it can be seeded.
  new DeviceStore(path).invite()
  const past = new Date(Date.now() - 3_600_000).toISOString()
  const expired = createInvitation(emptyInvitations(), { now: past, ttlMs: 60_000 })
  const seeded = JSON.parse(readFileSync(path, 'utf8'))
  seeded.invitations = expired.invitations
  writeFileSync(path, JSON.stringify(seeded))

  const store = new DeviceStore(path)
  const host = await fakeHost()
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const spendable = store.invite().code

  const answers = []
  const ask = async (label, query) => {
    const response = await fetch(`${base}/__remote/pair${query}`, { redirect: 'manual' })
    const body = await response.text()
    answers.push({ label, status: response.status, body, cookie: response.headers.get('set-cookie') })
  }

  await ask('正确的一次', `?token=${encodeURIComponent(spendable)}`)          // succeeds
  const devicesAfterSuccess = store.devices().length
  await ask('已用过', `?token=${encodeURIComponent(spendable)}`)
  await ask('写错了', '?token=edw-inv-not-a-real-code')
  await ask('已过期', `?token=${encodeURIComponent(expired.code)}`)
  await ask('根本没带', '')

  const devicesAfterFailures = store.devices().length
  await relay.close()
  host.server.close()

  const [first, ...failures] = answers
  assert.equal(first.status, 302, 'the one good invitation must work')
  assert.notEqual(first.cookie, null)

  for (const failure of failures) {
    assert.equal(failure.status, 403, `${failure.label} must be a plain 403`)
    assert.equal(failure.body, failures[0].body, `${failure.label} must not differ in wording`)
    assert.equal(failure.cookie, null, `${failure.label} must not hand out a credential`)
  }
  // Not merely similar: one string, four causes.
  assert.equal(new Set(failures.map(entry => `${String(entry.status)}|${entry.body}`)).size, 1)
  // A failed pairing registers nothing. The one that succeeded did register a
  // device — that is its job — so the count is the claim, not zero.
  assert.equal(devicesAfterSuccess, 1, 'the successful pairing registers exactly one device')
  assert.equal(devicesAfterFailures, devicesAfterSuccess, 'a failed pairing must not register a device')
})

test('isLoopbackAddress recognises this machine and nothing else', () => {
  // Node reports an IPv4 peer on a dual-stack listener in the mapped form, so a
  // comparison that forgot to unwrap it would lock the operator out of their own
  // device list.
  for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '::ffff:127.9.9.9']) {
    assert.equal(isLoopbackAddress(address), true, `${address} is this machine`)
  }
  for (const address of ['192.168.1.10', '10.0.0.7', '::ffff:192.168.1.10', '0.0.0.0', '128.0.0.1', '127.0.0.999', '::2', 'localhost', '', undefined, null, 42, {}]) {
    assert.equal(isLoopbackAddress(address), false, `${String(address)} must not be treated as this machine`)
  }
})

test('the device list is readable from this machine', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const { deviceId } = await pair(base, store, { name: '手机' })
  const response = await fetch(`${base}/__remote/devices`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.devices.length, 1)
  assert.equal(body.devices[0].deviceId, deviceId)
  assert.equal(body.devices[0].name, '手机')
  assert.deepEqual(body.devices[0].agent, store.device(deviceId).surfaces.agent)
  await relay.close()
  host.server.close()
})

test('the device list is refused to a caller that is not this machine', async () => {
  // The list carries device names and ids. It is the operator's view, so an
  // unpaired caller reaching the relay port must not be able to enumerate it.
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const relay = createGatedRelay({ hostPort: host.port, store })
  // Listen on every interface, then reach it through a real address rather than
  // loopback, which is the only way to produce a non-loopback peer in a test.
  await new Promise(resolve => relay.listen(0, '0.0.0.0', resolve))
  const { port } = relay.server.address()
  const external = Object.values(networkInterfaces()).flat()
    .filter(iface => iface && iface.family === 'IPv4' && !iface.internal)
    .map(iface => iface.address)[0]
  if (external === undefined) {
    await relay.close()
    host.server.close()
    return
  }
  const response = await fetch(`http://${external}:${String(port)}/__remote/devices`)
  assert.equal(response.status, 403, 'a non-loopback caller must not read the device list')
  assert.equal((await response.text()).includes('只能在本机查看'), true)
  await relay.close()
  host.server.close()
})
test('the relay control surface is never forwarded upstream', async () => {
  const host = await fakeHost()
  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  await fetch(`${base}/__remote/devices`)
  await fetch(`${base}/__remote/pair?token=x`)
  assert.equal(host.seen.length, 0, 'relay control paths must never reach the host')
  await relay.close()
  host.server.close()
})

test('the store survives a restart', async () => {
  const path = storePath()
  const host = await fakeHost()
  const first = await startRelay({ hostPort: host.port, store: new DeviceStore(path) })
  const { cookie, deviceId } = await pair(first.base, first.store)
  await first.relay.close()

  const second = await startRelay({ hostPort: host.port, store: new DeviceStore(path) })
  assert.equal(second.store.device(deviceId).status, 'trusted', 'a trusted device must stay trusted across a restart')
  assert.equal((await fetch(`${second.base}/api/sessions`, { headers: { cookie } })).status, 200)
  await second.relay.close()
  host.server.close()
})

test('a revoked device stays revoked across a restart', async () => {
  const path = storePath()
  const host = await fakeHost()
  const first = await startRelay({ hostPort: host.port, store: new DeviceStore(path) })
  const { cookie, deviceId } = await pair(first.base, first.store)
  first.relay.revoke(deviceId)
  await first.relay.close()

  const second = await startRelay({ hostPort: host.port, store: new DeviceStore(path) })
  assert.equal(second.store.device(deviceId).status, 'revoked')
  assert.equal((await fetch(`${second.base}/api/sessions`, { headers: { cookie } })).status, 401)
  await second.relay.close()
  host.server.close()
})

test('a burst of requests does not rewrite the store once per request', async () => {
  // Authentication runs on every request, so persisting the use stamp each time
  // would turn one page load into hundreds of whole-file rewrites. The stamp is
  // refreshed on a quiet period instead, and the verdict must not depend on it.
  const host = await fakeHost()
  const path = storePath()
  const store = new DeviceStore(path)
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const { cookie } = await pair(base, store)

  // The first authenticated request necessarily writes: the device has no stamp
  // yet. That write is the point of the quiet period, not a violation of it, so
  // it happens before the measurement starts.
  assert.equal((await fetch(`${base}/api/sessions`, { headers: { cookie } })).status, 200)

  const before = statSync(path).mtimeMs
  await new Promise(resolve => setTimeout(resolve, 20))
  for (let index = 0; index < 25; index += 1) {
    const response = await fetch(`${base}/api/sessions`, { headers: { cookie } })
    assert.equal(response.status, 200)
  }
  const after = statSync(path).mtimeMs
  assert.equal(after, before, 'twenty-five requests inside the quiet period must not rewrite the store')

  // The stamp is still eventually recorded, and the credential still works.
  assert.equal((await fetch(`${base}/api/sessions`, { headers: { cookie } })).status, 200)
  await relay.close()
  host.server.close()
})

test('an unreachable host answers 502 rather than hanging', async () => {
  const store = new DeviceStore(storePath())
  // Port 1 is reserved and nothing listens there.
  const { relay, base } = await startRelay({ hostPort: 1, store })
  const { cookie } = await pair(base, store)
  const response = await fetch(`${base}/api/sessions`, { headers: { cookie } })
  assert.equal(response.status, 502)
  await relay.close()
})

// The two tests below guard the host's own idempotency rather than adding any.
// `dsh-api-session-controller` admits a prompt at most once per `requestId`: a
// repeat returns `{ accepted: true }` without executing, and the check covers
// messages still sitting in the agent's inbox as well as those already recorded
// in the session, so the window where the request arrived but its acknowledgement
// was lost is covered too. The relay's only job is not to break that — if it
// re-sent a request the host never saw, or rewrote the id on the way through, the
// guarantee would be gone and a dropped connection would produce two turns.

test('the relay never re-sends a request it has already forwarded', async () => {
  // A host that takes the request and then drops the connection, which is what a
  // network failure mid-prompt looks like from the relay's side. Retrying here
  // would be the one way this relay could turn a lost acknowledgement into a
  // second execution.
  let seen = 0
  const host = http.createServer((request, response) => {
    seen += 1
    request.resume()
    request.on('end', () => response.socket?.destroy())
  })
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
  openHosts.push(host)

  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.address().port, store })
  const { cookie } = await pair(base, store)

  await fetch(`${base}/api/session/prompt`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'sub-1', text: '你好' }),
  }).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 150))

  assert.equal(seen, 1, 'a failed forward must not be retried by the relay')
  await relay.close()
})

test('the request body reaches the host unchanged, requestId included', async () => {
  // The id has to survive the relay byte for byte: it is the only thing tying a
  // retry to the original send, so a rewrite here silently disables the dedup.
  const bodies = []
  const host = http.createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'))
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
    })
  })
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
  openHosts.push(host)

  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.address().port, store })
  const { cookie } = await pair(base, store)
  const payload = JSON.stringify({ requestId: 'sub-42', text: '把这句话原样送达', content: [{ type: 'text', text: '你好' }] })

  const response = await fetch(`${base}/api/session/prompt`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: payload,
  })

  assert.equal(response.status, 200)
  assert.equal(bodies.length, 1)
  assert.equal(bodies[0], payload, 'the body must arrive byte for byte')
  assert.equal(JSON.parse(bodies[0]).requestId, 'sub-42')
  await relay.close()
})

test('two devices share one host session and both see the same stream', async () => {
  // This is the mechanism behind "continue the same task from another device".
  // The session lives in the host, not in either client: the relay must let both
  // devices onto the same upstream at the same time, and an event the host pushes
  // once has to reach both. A relay that serialised devices, or that gave each one
  // its own upstream, would break the acceptance item without failing anything
  // else.
  const subscribers = new Set()
  const host = http.createServer((request, response) => {
    if (request.url === '/api/stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      response.write('retry: 1000\n\n')
      subscribers.add(response)
      request.on('close', () => subscribers.delete(response))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ sessions: ['s-1'] }))
  })
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
  openHosts.push(host)

  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.address().port, store })
  const phone = await pair(base, store, { name: '手机' })
  const laptop = await pair(base, store, { name: '笔记本' })

  const received = { phone: [], laptop: [] }
  const openStream = (label, cookie) => new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port: new URL(base).port, path: '/api/stream', headers: { cookie } })
    request.on('response', (response) => {
      response.setEncoding('utf8')
      response.on('data', (chunk) => received[label].push(chunk))
      resolve(response)
    })
  })
  const phoneStream = await openStream('phone', phone.cookie)
  const laptopStream = await openStream('laptop', laptop.cookie)
  await new Promise(resolve => setTimeout(resolve, 80))

  assert.equal(subscribers.size, 2, 'both devices must be attached to the host at once')
  assert.equal(relay.connections.count(phone.deviceId), 1)
  assert.equal(relay.connections.count(laptop.deviceId), 1)

  // One event, pushed once by the host, must arrive at both devices.
  for (const response of subscribers) response.write('data: 轮次继续\n\n')
  await new Promise(resolve => setTimeout(resolve, 120))

  for (const label of ['phone', 'laptop']) {
    assert.ok(received[label].join('').includes('轮次继续'), `${label} must receive the event the host pushed once`)
  }

  // And a read from either device is answered from the same session.
  const listing = await (await fetch(`${base}/api/sessions`, { headers: { cookie: laptop.cookie } })).json()
  assert.deepEqual(listing.sessions, ['s-1'])
  const fromPhone = await (await fetch(`${base}/api/sessions`, { headers: { cookie: phone.cookie } })).json()
  assert.deepEqual(fromPhone.sessions, listing.sessions, 'both devices must read the same session')

  // Revoking one device must not disturb the other's stream.
  relay.revoke(phone.deviceId)
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(subscribers.size, 1, 'only the revoked device stream may be dropped')
  for (const response of subscribers) response.write('data: 仍在继续\n\n')
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.ok(received.laptop.join('').includes('仍在继续'), 'the surviving device must keep receiving')
  assert.equal(received.phone.join('').includes('仍在继续'), false, 'the revoked device must not')

  phoneStream.destroy()
  laptopStream.destroy()
  await relay.close()
})
test('a retried request with the same requestId is delivered as-is, not deduplicated here', async () => {
  // The relay must stay out of the decision. Two identical bodies with the same
  // requestId both reach the host, and the host is the one that decides the
  // second is a repeat — a relay that swallowed it instead would hide a genuine
  // second send from the only component able to judge it.
  const bodies = []
  const host = http.createServer((request, response) => {
    const chunks = []
    request.on('data', chunk => chunks.push(chunk))
    request.on('end', () => {
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')).requestId)
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('ok')
    })
  })
  await new Promise(resolve => host.listen(0, '127.0.0.1', resolve))
  openHosts.push(host)

  const store = new DeviceStore(storePath())
  const { relay, base } = await startRelay({ hostPort: host.address().port, store })
  const { cookie } = await pair(base, store)
  const send = () => fetch(`${base}/api/session/prompt`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: 'sub-7', text: '同样一句' }),
  })

  assert.equal((await send()).status, 200)
  assert.equal((await send()).status, 200)
  assert.deepEqual(bodies, ['sub-7', 'sub-7'], 'both attempts must reach the host so its dedup can decide')
  await relay.close()
})

/**
 * Send a raw upgrade through the relay and return whatever comes back.
 *
 * `fetch` cannot express an upgrade, and the response is what the test is about, so
 * this speaks the wire format directly. The timeout matters: the failure being
 * guarded against is silence, and without a deadline the run would hang instead of
 * reporting it.
 */
function rawUpgrade(port, path, cookie) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    let received = ''
    socket.setTimeout(6000, () => {
      socket.destroy()
      resolve(received)
    })
    socket.on('connect', () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${String(port)}`,
        `Cookie: ${cookie}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        '', '',
      ].join('\r\n'))
    })
    socket.on('data', chunk => { received += String(chunk) })
    socket.on('error', error => { socket.destroy(); reject(error) })
    socket.on('close', () => resolve(received))
  })
}

test('an upgrade the host refuses is relayed, not left hanging', async () => {
  // A host that refuses the stream mux does it with an ordinary HTTP response, not a
  // 101. Node only emits `upgrade` for a 101, so relaying that event alone leaves the
  // phone's socket with nothing written to it at all: the browser waits for a
  // handshake that will never arrive, and the page that loaded stops updating with no
  // error anywhere. The refusal has to reach the client so it can fail where the
  // failure actually is.
  const store = new DeviceStore(storePath())
  const host = await fakeHost()
  host.server.on('upgrade', (request, socket) => {
    socket.write('HTTP/1.1 403 Forbidden\r\ncontent-length: 0\r\nconnection: close\r\n\r\n')
    socket.destroy()
  })
  const { relay, base, port } = await startRelay({ hostPort: host.port, store })
  const { cookie } = await pair(base, store)

  const refusal = await rawUpgrade(port, '/api/remote.mux', cookie)
  assert.match(refusal, /^HTTP\/1\.1 403/u, '调度器拒绝必须传回手机，而不是让它干等')
  await relay.close()
  host.server.close()
})

test('a device that is not confirmed cannot open an upgrade either', async () => {
  // The gate has to cover the long-lived channel, not just requests. A phone that is
  // waiting for the operator must not be able to hold a stream open in the meantime.
  const store = new DeviceStore(storePath())
  const host = await fakeHost()
  let upgraded = 0
  host.server.on('upgrade', (request, socket) => {
    upgraded += 1
    socket.destroy()
  })
  const { relay, base, port } = await startRelay({ hostPort: host.port, store })
  const { cookie } = await pair(base, store, { confirm: false })

  const answer = await rawUpgrade(port, '/api/remote.mux', cookie)
  assert.equal(answer, '', '未确认的设备不应拿到任何响应，也不应到达宿主')
  assert.equal(upgraded, 0, '升级请求不得被转发出去')
  await relay.close()
  host.server.close()
})


test('the relay does not fence operations, and this records that rather than hiding it', async () => {
  // A characterisation test, deliberately asserting a limitation. `./gate` has a
  // decision table that refuses the host management surface, and the README used to
  // describe it as though it were in force. It has no caller, so a confirmed device
  // reaches whatever the host serves — and this is what puts that in the test output
  // instead of only in prose a reader may skip.
  //
  // It is written to fail the day someone wires the fence, which is the point: that
  // change should be a decision, not a surprise.
  const store = new DeviceStore(storePath())
  const host = await fakeHost()
  const { relay, base } = await startRelay({ hostPort: host.port, store })
  const { cookie } = await pair(base, store)

  // Paths that name host management. Today every one of them is forwarded untouched.
  const paths = ['/api/devices', '/api/plugins/install', '/api/terminal']
  for (const path of paths) {
    const response = await fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual' })
    assert.equal(response.status, 200, `${path} 目前会被原样转发——这正是尚未实现的围栏`)
  }
  assert.deepEqual(host.seen.map(entry => entry.url), paths, '宿主确实收到了这些请求')
  await relay.close()
  host.server.close()
})

test('a browser request survives the fence that compares Origin with Host', async () => {
  // Reproduces the rules the host applies to /api, from isTrustedApiRequest in
  // dsh-client-connection: the Host must be loopback (or a listed trusted authority),
  // a request marked `sec-fetch-site: cross-site` is refused, and an attached Origin
  // must be same-origin with the Host the host was given.
  //
  // Node's fetch sends no Origin at all, and the host returns true the instant it is
  // absent. That is exactly how a relay which rewrites Host and leaves Origin behind
  // passes every fetch-based test in this file while turning every request from a real
  // browser into a 403 — the page loads and then nothing in it works, with the failure
  // attributed to the network. A browser-shaped request is the only way to see it.
  const store = new DeviceStore(storePath())
  const verdicts = []
  const server = http.createServer((request, response) => {
    const host = request.headers.host ?? ''
    const origin = request.headers.origin
    const crossSite = request.headers['sec-fetch-site'] === 'cross-site'
    let sameOrigin = true
    if (origin !== undefined) {
      try { sameOrigin = new URL(origin).host === host } catch { sameOrigin = false }
    }
    const trusted = /^127\.0\.0\.1:\d+$/u.test(host) && sameOrigin && !crossSite
    verdicts.push({ host, origin, crossSite, trusted })
    response.writeHead(trusted ? 200 : 403)
    response.end(trusted ? 'from-host' : 'forbidden')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  openHosts.push(server)
  const authority = `127.0.0.1:${String(server.address().port)}`

  const { relay, base } = await startRelay({ hostPort: server.address().port, store })
  const { cookie } = await pair(base, store)

  // What a browser sends when the page was served by this relay.
  const browser = await fetch(`${base}/api/sessions`, {
    headers: { cookie, origin: base, 'sec-fetch-site': 'same-origin' },
    redirect: 'manual',
  })
  // The marker that must NOT be normalised away: a cross-site request has to keep
  // saying it is one, or the relay becomes a way around the host's own CSRF fence.
  const hostile = await fetch(`${base}/api/sessions`, {
    headers: { cookie, origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
    redirect: 'manual',
  })

  // Close before asserting: an assertion that throws with the servers still listening
  // leaves the runner holding open handles, so a failure would hang instead of report.
  await relay.close()
  server.close()

  assert.equal(browser.status, 200, '带 Origin 的浏览器请求必须穿过宿主的一致性检查')
  assert.deepEqual(verdicts[0], {
    host: authority,
    origin: `http://${authority}`,
    crossSite: false,
    trusted: true,
  })
  assert.equal(hostile.status, 403, '跨站标记不得被中继抹掉')
  assert.equal(verdicts[1].crossSite, true)
})

test('the waiting page can actually be confirmed', async () => {
  // The whole pairing flow, followed the way a browser follows it: redeem the
  // invitation, land on the waiting page, and poll the status endpoint until the
  // device is trusted. Nothing else is requested in between, because nothing else is
  // what a browser on that page does.
  //
  // Confirmation used to hang off an armed request instead. A phone sitting on the
  // waiting page never sends one, so the operator was never asked and the page span
  // forever; every test still passed because they all called `store.confirm()`
  // directly, and the probe passed because it fetched an armed path immediately after
  // pairing. Following the flow a browser follows is what exposes it.
  const store = new DeviceStore(storePath())
  const host = await fakeHost()
  const asked = []
  const { relay, base } = await startRelay({
    hostPort: host.port,
    store,
    onRequest: async (device) => { asked.push(device.deviceId); return true },
  })

  const invitation = store.invite()
  const paired = await fetch(`${base}/__remote/pair?token=${encodeURIComponent(invitation.code)}`, { redirect: 'manual' })
  assert.equal(paired.status, 302)
  const cookie = (paired.headers.get('set-cookie') ?? '').split(';')[0]
  assert.equal(store.devices()[0].status, 'pending')
  assert.equal(asked.length, 0, '还没问过')

  // The waiting page's one and only call.
  const seen = []
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await fetch(`${base}/__remote/status`, { headers: { cookie } })
    const body = await status.json()
    seen.push(body.status)
    if (body.status !== 'pending') break
  }
  const trusted = seen.at(-1)
  const askedOnce = asked.length

  await relay.close()
  host.server.close()

  assert.equal(askedOnce, 1, '轮询状态就该问到操作员，且只问一次')
  assert.equal(trusted, 'trusted', '确认后轮询必须报告已授权，否则等待页永远转下去')
  assert.equal(seen[0], 'trusted', '第一次轮询就该触发确认，而不是等到超时')
})

test('a refused confirmation reports refused rather than staying pending', async () => {
  // The other half: a device the operator turns down must not be left looking like it
  // is still waiting, or the page spins and the person believes a click is coming.
  const store = new DeviceStore(storePath())
  const host = await fakeHost()
  const { relay, base } = await startRelay({
    hostPort: host.port,
    store,
    onRequest: async () => false,
  })

  const invitation = store.invite()
  const paired = await fetch(`${base}/__remote/pair?token=${encodeURIComponent(invitation.code)}`, { redirect: 'manual' })
  const cookie = (paired.headers.get('set-cookie') ?? '').split(';')[0]

  const status = await fetch(`${base}/__remote/status`, { headers: { cookie } })
  const body = await status.json()
  const armed = await fetch(`${base}/api/sessions`, { headers: { cookie } })

  await relay.close()
  host.server.close()

  assert.equal(body.status, 'revoked', '被拒绝的设备应报告为已撤销，等待页据此停止轮询')
  // 401 rather than 403: refusing revokes the device, so its credential stops
  // authenticating at all. That is the stronger outcome — there is nothing left to
  // present — and it is why the waiting page can tell the person to pair again.
  assert.equal(armed.status, 401, '被拒绝的设备凭据必须失效')
})