import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { allowed, allowsApiRequest, allowsEndpoint, REFUSED } from '../../src/gate/gate.ts'
import { descriptors } from '../../src/typert.ts'

const refused = new Set(Object.values(REFUSED).flat())

test('every endpoint and route of an assembled product is classified on purpose', async () => {
  for (const file of ['dsh-0.2.1-rc.2-web.json']) {
    const product = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8')) as { endpoints: string[]; routes: string[] }
    const unclassified = [...product.endpoints, ...product.routes]
      .filter(name => !allowed.endpoints.includes(name) && !allowed.routes.includes(name) && !refused.has(name))
    assert.deepEqual(unclassified, [], `${file}: classify these in src/gate/gate.ts`)
  }
  const both = [...allowed.endpoints, ...allowed.routes].filter(name => refused.has(name))
  assert.deepEqual(both, [], 'listed as both allowed and refused')
})

test('the settings page\'s own methods are refused by name', () => {
  for (const { namespace, method } of descriptors) assert.ok(refused.has(`${namespace}/${method}`), method)
})

test('the first-version boundary holds', () => {
  for (const endpoint of ['session/prompt', 'session/cancel', 'session/follow', 'userQuestions/answer', '$events', '$events/result', 'workspace/follow']) {
    assert.ok(allowsEndpoint(endpoint), endpoint)
  }
  for (const endpoint of ['workspace/create', 'directoryPicker/list', 'credentials/set', 'terminal/create', 'dynamicCordisRunner/invoke', 'session/openWorkspacePath', 'unknown/endpoint']) {
    assert.ok(!allowsEndpoint(endpoint), endpoint)
  }
})

test('API requests are judged by method and exact path', () => {
  assert.ok(allowsApiRequest('POST', '/api/session/prompt'))
  assert.ok(allowsApiRequest('GET', '/api/file'))
  assert.ok(allowsApiRequest('POST', '/api/session/uploadFileBinary'))
  assert.ok(!allowsApiRequest('GET', '/api/session/prompt'), 'RPC is POST only')
  assert.ok(!allowsApiRequest('POST', '/api/file'), 'route methods are exact')
  assert.ok(!allowsApiRequest('GET', '/api/present.open'))
  for (const path of ['/api/session/prompt/', '/api//session/prompt', '/api/session/../credentials/set', '/api/', '/apisession/prompt']) {
    assert.ok(!allowsApiRequest('POST', path), path)
  }
})
