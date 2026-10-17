/**
 * The device page is the operator's only way to confirm or revoke a device, so its
 * contracts are worth pinning: the token is the path, mutations are JSON-only, and
 * revoking closes the live connection instead of only refusing the next call.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { ADMIN_PATH, adminUrl, registerAdminSurface } from '../src/admin.js'

function fakeServer() {
  const routes = new Map()
  return {
    routes,
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
}

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body ?? ''
    },
  }
}

function request({ method = 'GET', type, body } = {}) {
  return {
    method,
    headers: type === undefined ? {} : { 'content-type': type },
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(body)
    },
  }
}

function fakeRegistry(initial) {
  const devices = initial.map(device => ({ surfaces: { agent: [], host: [] }, ...device }))
  const find = id => devices.find(device => device.deviceId === id)
  return {
    devices,
    read: () => ({ devices }),
    async confirm(id) {
      const device = find(id)
      if (device === undefined) throw new Error(`unknown device "${id}"`)
      device.status = 'trusted'
      return { registry: { devices } }
    },
    async revoke(id) {
      const device = find(id)
      if (device === undefined) throw new Error(`unknown device "${id}"`)
      device.status = 'revoked'
      return { registry: { devices }, revoked: device }
    },
    async remove(id) {
      const index = devices.findIndex(device => device.deviceId === id)
      if (index >= 0) devices.splice(index, 1)
      return { devices }
    },
  }
}

function setup(devices = []) {
  const webServer = fakeServer()
  const registry = fakeRegistry(devices)
  const closed = []
  const connections = {
    count: () => 0,
    closeAll(id) {
      closed.push(id)
      return 1
    },
  }
  const dispose = registerAdminSurface({ webServer, token: 'token-1', registry, connections })
  const base = `${ADMIN_PATH}/token-1`
  const route = path => webServer.routes.get(path)?.handler
  return { webServer, registry, closed, connections, dispose, base, route }
}

test('the route table only answers the exact token path', () => {
  const { webServer, base } = setup()
  assert.equal(webServer.routes.has(`${ADMIN_PATH}/wrong-token`), false)
  assert.equal(webServer.routes.has(base), true)
  assert.equal(webServer.routes.has(`${base}/`), true)
  assert.equal(webServer.routes.has(`${base}/state`), true)
  assert.equal(webServer.routes.has(`${base}/confirm`), true)
  assert.equal(webServer.routes.has(`${base}/revoke`), true)
  assert.equal(webServer.routes.has(`${base}/remove`), true)
})

test('the page is HTML and carries no device data', () => {
  const { route, base } = setup([{ deviceId: 'dev-1', name: '手机', status: 'trusted', publicKey: 'p256:x' }])
  const response = fakeResponse()
  route(base)(request(), response)
  assert.equal(response.status, 200)
  assert.match(response.headers['content-type'], /text\/html/u)
  assert.match(response.body, /设备授权/u)
  assert.doesNotMatch(response.body, /dev-1/u, 'device rows are rendered from /state, not baked into the page')
})

test('state reports devices and their live connection count', async () => {
  const { route, base } = setup([{ deviceId: 'dev-1', name: '手机', status: 'trusted', publicKey: 'p256:x' }])
  const response = fakeResponse()
  route(`${base}/state`)(request(), response)
  const body = JSON.parse(response.body)
  assert.equal(response.status, 200)
  assert.deepEqual(body.devices.map(device => device.deviceId), ['dev-1'])
  assert.equal(body.devices[0].live, 0)
})

test('confirm accepts JSON and flips the device to trusted', async () => {
  const { route, base, registry } = setup([{ deviceId: 'dev-1', name: '手机', status: 'pending', publicKey: 'p256:x', agreementKey: 'p256:y' }])
  const response = fakeResponse()
  await route(`${base}/confirm`)(request({ method: 'POST', type: 'application/json', body: JSON.stringify({ deviceId: 'dev-1' }) }), response)
  assert.equal(response.status, 200)
  assert.equal(registry.devices[0].status, 'trusted')
  assert.equal(JSON.parse(response.body).devices[0].status, 'trusted')
})

test('revoke closes the live connections as part of the same action', async () => {
  const { route, base, registry, closed } = setup([{ deviceId: 'dev-1', name: '手机', status: 'trusted', publicKey: 'p256:x', agreementKey: 'p256:y' }])
  const response = fakeResponse()
  await route(`${base}/revoke`)(request({ method: 'POST', type: 'application/json', body: JSON.stringify({ deviceId: 'dev-1' }) }), response)
  assert.equal(response.status, 200)
  assert.equal(registry.devices[0].status, 'revoked')
  assert.deepEqual(closed, ['dev-1'], 'writing the record is not the whole revocation')
})

test('a form-encoded or non-POST mutation is refused before anything changes', async () => {
  const { route, base, registry } = setup([{ deviceId: 'dev-1', name: '手机', status: 'pending', publicKey: 'p256:x', agreementKey: 'p256:y' }])

  const form = fakeResponse()
  await route(`${base}/confirm`)(request({ method: 'POST', type: 'application/x-www-form-urlencoded', body: 'deviceId=dev-1' }), form)
  assert.equal(form.status, 415)
  assert.equal(registry.devices[0].status, 'pending', 'no mutation on a refused content type')

  const get = fakeResponse()
  await route(`${base}/confirm`)(request({ method: 'GET' }), get)
  assert.equal(get.status, 405)
  assert.equal(registry.devices[0].status, 'pending')
})

test('unknown devices and malformed bodies are reported, not thrown', async () => {
  const { route, base } = setup([{ deviceId: 'dev-1', name: '手机', status: 'pending', publicKey: 'p256:x', agreementKey: 'p256:y' }])

  const unknown = fakeResponse()
  await route(`${base}/confirm`)(request({ method: 'POST', type: 'application/json', body: JSON.stringify({ deviceId: 'nope' }) }), unknown)
  assert.equal(unknown.status, 400)
  assert.match(JSON.parse(unknown.body).error, /unknown device/u)

  const missing = fakeResponse()
  await route(`${base}/confirm`)(request({ method: 'POST', type: 'application/json', body: '{}' }), missing)
  assert.equal(missing.status, 400)

  const broken = fakeResponse()
  await route(`${base}/confirm`)(request({ method: 'POST', type: 'application/json', body: '{' }), broken)
  assert.equal(broken.status, 400)
})

test('the disposer removes every route it registered', () => {
  const { webServer, dispose } = setup()
  assert.ok(webServer.routes.size > 0)
  dispose()
  assert.equal(webServer.routes.size, 0)
})

test('the operator URL puts the token in the path', () => {
  assert.equal(adminUrl('127.0.0.1:59488', 'abc'), 'http://127.0.0.1:59488/remote-access-admin/abc/')
})
