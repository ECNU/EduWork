import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { readDirectRouting, probeDirect, proxyFromDecision, routeHostEnvironment } from '../src/direct-hosts.mjs'

const probe = { url: 'https://id.example.edu/netcheck', field: 'campus' }

test('routing comes from the policy file and rejects malformed entries', () => {
  const read = text => () => text
  assert.deepEqual(readDirectRouting('p', read('{"directHosts":[".example.edu","bad host","*",3]}')), { hosts: ['.example.edu'] })
  assert.deepEqual(readDirectRouting('p', read('{"schemaVersion":1}')), { hosts: [] })
  assert.deepEqual(readDirectRouting('p', () => { throw Object.assign(Error('x'), { code: 'ENOENT' }) }), { hosts: [] })
  assert.deepEqual(readDirectRouting('p', read(JSON.stringify({ directHosts: ['.a.edu'], directProbe: probe }))), { hosts: ['.a.edu'], probe })
  for (const bad of [{ url: 'http://id.example.edu/x', field: 'campus' }, { url: 'https://u:p@id.example.edu/', field: 'campus' }, { url: 'https://id.example.edu/', field: 'a.b' }, { url: 'nope', field: 'campus' }])
    assert.deepEqual(readDirectRouting('p', read(JSON.stringify({ directHosts: ['.a.edu'], directProbe: bad }))), { hosts: ['.a.edu'] })
})

test('system proxy decisions map to an HTTP proxy URL only for PROXY and HTTPS entries', () => {
  assert.equal(proxyFromDecision('PROXY 127.0.0.1:7890; DIRECT'), 'http://127.0.0.1:7890')
  assert.equal(proxyFromDecision('HTTPS proxy.example.edu:443'), 'https://proxy.example.edu:443')
  assert.equal(proxyFromDecision('PROXY [::1]:8080'), 'http://[::1]:8080')
  for (const value of ['DIRECT', 'SOCKS5 127.0.0.1:1086', '', undefined, 'PROXY host:99999', 'PROXY a b:1']) assert.equal(proxyFromDecision(value), undefined)
})

test('a campus tunnel in HTTP proxy mode keeps campus hosts on the proxy', () => {
  // The system proxy is the tunnel and the direct probe sees an off-campus address.
  const env = routeHostEnvironment({ PATH: '/bin' }, { hosts: ['.example.edu'], probe, direct: false, systemProxy: 'http://127.0.0.1:7890' })
  assert.equal(env.https_proxy, 'http://127.0.0.1:7890')
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890')
  assert.equal(env.NO_PROXY, undefined)
  const inherited = routeHostEnvironment({ https_proxy: 'http://127.0.0.1:7890' }, { hosts: ['.example.edu'], probe, direct: false })
  assert.equal(inherited.no_proxy, undefined)
})

test('on campus with a local proxy, confirmed direct access bypasses the proxy for campus hosts', () => {
  const env = routeHostEnvironment({ https_proxy: 'http://127.0.0.1:1087', no_proxy: 'localhost, .example.edu' }, { hosts: ['.example.edu', 'api.example.edu'], probe, direct: true, systemProxy: 'http://127.0.0.1:9999' })
  assert.equal(env.no_proxy, 'localhost,.example.edu,api.example.edu')
  assert.equal(env.NO_PROXY, env.no_proxy)
  assert.equal(env.https_proxy, 'http://127.0.0.1:1087', 'an inherited proxy wins over the system one')
  assert.equal(routeHostEnvironment({ https_proxy: 'x' }, { hosts: ['.a.edu'], probe, direct: undefined }).NO_PROXY, undefined, 'an unanswered probe never bypasses')
})

test('without a probe or proxy the earlier behaviour is unchanged', () => {
  assert.deepEqual(routeHostEnvironment({ PATH: '/bin' }, { hosts: ['.example.edu'] }), { PATH: '/bin' })
  assert.equal(routeHostEnvironment({ http_proxy: 'x' }, { hosts: ['.example.edu'] }).NO_PROXY, '.example.edu')
  assert.deepEqual(routeHostEnvironment({ http_proxy: 'x' }, { hosts: [] }), { http_proxy: 'x' })
})

function fakeRequest(status, body, { fail = false } = {}) {
  const seen = []
  const request = (url, options, callback) => {
    seen.push({ url, options })
    const req = new EventEmitter()
    req.destroy = () => req.emit('error', new Error('destroyed'))
    req.end = () => queueMicrotask(() => {
      if (fail) { req.emit('error', new Error('ECONNREFUSED')); return }
      const res = new EventEmitter(); res.statusCode = status; res.setEncoding = () => {}; res.resume = () => {}
      callback(res); res.emit('data', body); res.emit('end')
    })
    return req
  }
  return { request, seen }
}

test('the direct probe needs an explicit confirmation and never uses a proxy agent', async () => {
  const yes = fakeRequest(200, '{"campus":1}')
  assert.equal(await probeDirect(probe, { request: yes.request }), true)
  assert.equal(yes.seen[0].options.agent, false)
  assert.equal(await probeDirect(probe, { request: fakeRequest(200, '{"campus":0}').request }), false)
  assert.equal(await probeDirect(probe, { request: fakeRequest(502, '{"campus":1}').request }), false)
  assert.equal(await probeDirect(probe, { request: fakeRequest(200, 'not json').request }), false)
  assert.equal(await probeDirect(probe, { request: fakeRequest(200, '', { fail: true }).request }), false)
  assert.equal(await probeDirect(undefined), undefined)
})
