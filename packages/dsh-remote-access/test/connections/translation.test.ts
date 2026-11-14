import assert from 'node:assert/strict'
import test from 'node:test'
import { remoteHandler, FORBIDDEN } from '../../src/connections/handler.ts'
import type { HostAdapter, Peer } from '../../src/host/adapter.ts'

test('remote reasoning translation boot and request reach the Host unchanged through its paired Peer', async () => {
  const peer: Peer = { async dispose() {} }
  const calls: { path: string; body: unknown }[] = [], refused: string[] = []
  const adapter: HostAdapter = {
    createPeer: () => peer,
    page: async () => { throw Error('unexpected page') },
    async api(request, caller) {
      assert.equal(caller, peer)
      const path = new URL(request.url).pathname
      const body = await request.json() as { rpcId: string; payload: { args: unknown } }
      calls.push({ path, body })
      return Response.json({ type: 'server-response', rpcId: body.rpcId, result: { ok: true,
        value: path.endsWith('/limits') ? { maxTextChars: 1000, preferences: { provider: 'bing', targetLanguage: 'auto' }, availableProviders: ['bing'] } : '合成译文' } })
    },
    async *openStream() { throw Error('unexpected stream') },
    streamFailure: () => ({ code: 'test', message: 'test', details: {} }),
  }
  const handler = remoteHandler(adapter, peer, name => refused.push(name))
  const request = (endpoint: string, args: unknown) => {
    const body = { rpcId: `synthetic-${endpoint}`, payload: { args } }
    return { body, value: new Request(`https://tunnel.invalid/api/${endpoint}`, { method: 'POST', body: JSON.stringify(body) }) }
  }
  // The official plugin awaits limits before mounting; the old gate returned
  // remote-access/forbidden here and stopped remote workbench initialization.
  const boot = request('cotTranslation/limits', {})
  const bootResponse = await (await handler.fetch(boot.value, new AbortController().signal)).json() as { result: { ok: boolean; value: { maxTextChars: number } } }
  assert.equal(bootResponse.result.ok, true)
  assert.equal(bootResponse.result.value.maxTextChars, 1000)
  const translation = request('cotTranslation/translate', { text: 'Synthetic reasoning', sessionId: 'synthetic-session', targetLanguage: 'zh-CN' })
  const translated = await (await handler.fetch(translation.value, new AbortController().signal)).json() as { result: { ok: boolean; value: string } }
  assert.equal(translated.result.ok, true); assert.equal(translated.result.value, '合成译文')
  assert.deepEqual(calls, [{ path: '/api/cotTranslation/limits', body: boot.body }, { path: '/api/cotTranslation/translate', body: translation.body }])
  assert.deepEqual(refused, [])

  // Knowing the namespace must not grant arbitrary new RPCs or settings writes.
  for (const [endpoint, args] of [
    ['cotTranslation/configure', {}],
    ['settings/mutate', { ns: 'cotTranslation', ops: [{ op: 'set', path: ['provider'], value: 'deepseek' }] }],
    ['credentials/set', { key: 'synthetic' }],
  ] as const) {
    const denied = request(endpoint, args)
    const response = await (await handler.fetch(denied.value, new AbortController().signal)).json() as { result: { ok: boolean; error: { code: string } } }
    assert.equal(response.result.ok, false)
    assert.equal(response.result.error.code, FORBIDDEN)
  }
  assert.equal(calls.length, 2, 'forbidden requests never reach the Host adapter')
})

test('translation errors remain Host errors rather than being converted to access denials', async () => {
  const peer: Peer = { async dispose() {} }
  const failure = { type: 'server-response', rpcId: 'synthetic-error', result: { ok: false, error: { code: 'cotTranslation/failed', message: 'Translation failed', details: {} } } }
  const adapter: HostAdapter = {
    createPeer: () => peer, page: async () => new Response(null),
    api: async () => Response.json(failure), async *openStream() {},
    streamFailure: () => ({ code: 'test', message: 'test', details: {} }),
  }
  const handler = remoteHandler(adapter, peer, () => assert.fail('translation should reach the Host'))
  const response = await handler.fetch(new Request('https://tunnel.invalid/api/cotTranslation/translate', { method: 'POST' }), new AbortController().signal)
  assert.deepEqual(await response.json(), failure)
})
