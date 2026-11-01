import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import test, { after } from 'node:test'

// The native bridge and provider are real; only the Cordis service base is
// replaced so these credential contract checks need no installed Runtime.
const base = 'data:text/javascript,' + encodeURIComponent('export class CredentialProvider { constructor(ctx) { this.ctx = ctx } }')
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/dsh-credentials' && context.parentURL === new URL('../lib/index.js', import.meta.url).href) return { url: base, shortCircuit: true }
  return next(specifier, context)
} })
const { NativeCredentialProvider } = await import('../lib/index.js')
after(() => hooks.deregister())

async function provider(t, stored, environment) {
  const server = createServer(async (request, response) => {
    for await (const chunk of request) { /* drain the synthetic bridge request */ }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ configured: stored !== undefined, writable: true, source: 'os-encrypted-vault',
      ...(request.url.endsWith('/resolve') && stored !== undefined ? { value: stored } : {}) }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const nativeBridge = { baseURL: `http://127.0.0.1:${server.address().port}`, token: 'synthetic' }
  return new NativeCredentialProvider({ desktopBoundary: { ready: Promise.resolve({ nativeBridge }) }, get: () => environment })
}

test('stored native credentials override the launch environment', async t => {
  const p = await provider(t, 'stored-test-key', { get: () => ({ value: 'environment-test-key', source: 'process' }) })
  assert.deepEqual(await p.resolve('TEST_KEY'), { value: 'stored-test-key', source: 'os-encrypted-vault' })
  assert.deepEqual(await p.describe('TEST_KEY'), { configured: true, source: 'os-encrypted-vault', writable: true })
})

for (const source of ['process', 'project-env', 'user-env']) {
  test(`native credentials resolve and describe the ${source} fallback`, async t => {
    const p = await provider(t, undefined, { get: ref => ref === 'TEST_KEY' ? { value: 'environment-test-key', source } : undefined })
    const expectedSource = source === 'process' ? 'env' : source
    assert.deepEqual(await p.resolve('TEST_KEY'), { value: 'environment-test-key', source: expectedSource })
    assert.deepEqual(await p.describe('TEST_KEY'), { configured: true, source: expectedSource, writable: true })
    assert.equal(await p.resolve('MISSING_TEST_KEY'), undefined)
    assert.deepEqual(await p.describe('MISSING_TEST_KEY'), { configured: false, writable: true })
  })
}

test('an empty snapshot entry remains absent and does not use ambient process values', async t => {
  const ref = 'EDUWORK_SYNTHETIC_CREDENTIAL_TEST'
  const previous = process.env[ref]
  process.env[ref] = 'ambient-test-key'
  t.after(() => { if (previous === undefined) delete process.env[ref]; else process.env[ref] = previous })
  const p = await provider(t, undefined, { get: () => ({ value: '', source: 'process' }) })
  assert.equal(await p.resolve(ref), undefined)
  assert.deepEqual(await p.describe(ref), { configured: false, writable: true })
})

test('older Hosts without a snapshot can use the inherited environment', async t => {
  const ref = 'EDUWORK_SYNTHETIC_CREDENTIAL_TEST'
  const previous = process.env[ref]
  process.env[ref] = 'ambient-test-key'
  t.after(() => { if (previous === undefined) delete process.env[ref]; else process.env[ref] = previous })
  const p = await provider(t, undefined, undefined)
  assert.deepEqual(await p.resolve(ref), { value: 'ambient-test-key', source: 'env' })
  assert.deepEqual(await p.describe(ref), { configured: true, source: 'env', writable: true })
})
