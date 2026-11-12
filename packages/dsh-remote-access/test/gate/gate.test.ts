import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { allowed, allowsApiCall, allowsApiRequest, allowsEndpoint, REFUSED } from '../../src/gate/gate.ts'
import { descriptors } from '../../src/typert.ts'

const refused = new Set(Object.values(REFUSED).flat())

test('every endpoint and route of an assembled product is classified on purpose', async () => {
  for (const file of ['dsh-0.2.1-rc.2-web.json', 'eduwork-0.4.6-desktop.json']) {
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

test('rc.2 UI can list providers, stop subagents and acknowledge notices without administering the Host', () => {
  for (const endpoint of ['web/listProviders', 'subagents/interruptByUser',
    'account/getNotifications', 'account/getNotificationContent', 'account/reportNotificationEvent']) {
    assert.ok(allowsApiRequest('POST', `/api/${endpoint}`), endpoint)
    assert.ok(!allowsApiRequest('GET', `/api/${endpoint}`), endpoint)
  }
  for (const endpoint of ['mcpManager/restart', 'mcpManager/probe', 'mcpManager/watch',
    'account/login', 'account/logout', 'credentials/set', 'terminal/create']) {
    assert.ok(!allowsApiRequest('POST', `/api/${endpoint}`), endpoint)
  }
})

test('Office preview accepts the rc.2 service name without granting other Kit operations', () => {
  for (const service of ['officeToPdf', 'officeKit']) {
    for (const method of ['generation', 'render']) {
      assert.ok(allowsEndpoint(`${service}/${method}`))
      assert.ok(allowsApiRequest('POST', `/api/${service}/${method}`))
      assert.ok(!allowsApiRequest('GET', `/api/${service}/${method}`))
    }
  }
  for (const method of ['convert', 'recalculate', 'dispose', 'renderImages', 'outputDirectory']) {
    assert.ok(!allowsEndpoint(`officeKit/${method}`))
    assert.ok(!allowsApiRequest('POST', `/api/officeKit/${method}`))
  }
})

test('a device may acknowledge the preview notice and change no other setting', () => {
  const ops = (path: string[], value: unknown = '2026-09-28.1') => [{ op: 'set', path, value }]
  const acknowledge = { ns: 'ui-settings-general', ops: ops(['welcomeNoticeVersion']), expectedRevision: 3 }
  assert.ok(allowsApiCall('POST', '/api/settings/mutate', acknowledge))
  for (const args of [
    { ...acknowledge, ns: 'locale' },
    { ...acknowledge, ops: ops(['theme']) },
    { ...acknowledge, ops: ops(['welcomeNoticeVersion'], { version: 1 }) },
    { ...acknowledge, ops: [{ op: 'unset', path: ['welcomeNoticeVersion'] }] },
    { ...acknowledge, ops: [...acknowledge.ops, ...ops(['theme'])] },
    { ...acknowledge, ops: [{ ...acknowledge.ops[0], extra: true }] },
    { ...acknowledge, ops: [null] },
    null,
  ]) assert.ok(!allowsApiCall('POST', '/api/settings/mutate', args), JSON.stringify(args))
  assert.ok(!allowsApiCall('GET', '/api/settings/mutate', acknowledge))
  assert.ok(!allowsApiCall('POST', '/api/settings/update', acknowledge))
  assert.ok(!allowsApiCall('POST', '/api/settings/mutate/', acknowledge))
})
