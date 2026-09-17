import assert from 'node:assert/strict'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import OidcAccountService from '../src/host/index.js'
import { fixture } from './helpers/desktop-fixture.js'

test('real DSH Web Host uses one OIDC Access Token for models and explicit extension reads', async t => {
  const f = await fixture(t, { resources: true })
  class Credentials extends Service {
    constructor(ctx) { super(ctx, 'credentials') }
    resolve(ref) { return Promise.resolve(f.records.has(ref) ? { value: f.records.get(ref) } : undefined) }
    set(ref, value) { f.records.set(ref, value); return Promise.resolve() }
    unset(ref) { f.records.delete(ref); return Promise.resolve() }
  }
  const ctx = new Context(), events = [], fibers = []
  ctx.on('oidc/accounts-changed', event => events.push(event))
  t.after(async () => { for (const fiber of fibers.reverse()) await fiber.dispose() })
  fibers.push(await ctx.plugin(LlmRuntime), await ctx.plugin(Credentials),
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 }),
    await ctx.plugin(OidcAccountService, { backend: 'web', profile: f.rawProfile }))
  assert.deepEqual(ctx.llm.listProviders(), [])
  assert.equal(await ctx.oidcAccounts.modelAuthorization(f.profile.id, f.origin + '/v1'), false)
  const begin = await ctx.oidcAccounts.begin(f.profile.id)
  const authorization = await fetch(begin.authorizationURL, { redirect: 'manual' })
  const callback = await fetch(authorization.headers.get('location'), { redirect: 'manual' })
  assert.match(callback.headers.get('location'), /dsh_oidc=connected/)
  assert.equal((await ctx.oidcAccounts.status(f.profile.id)).credentialReady, true)
  assert.equal((await ctx.llm.listModels('fixture-ai'))[0].id, 'fixture-model')
  assert.ok(!f.requests.some(row => /bootstrap|runtime-credential|quota/.test(row.path)))
  assert.equal(f.records.has('EDUWORK_API_KEY'), false)
  assert.equal(await ctx.oidcAccounts.modelAuthorization(f.profile.id, f.origin + '/v1'), true)
  assert.equal(await ctx.oidcAccounts.modelAuthorization(f.profile.id, 'https://other.example/v1'), false)
  assert.equal(await ctx.oidcAccounts.modelAuthorization(f.profile.id, f.origin + '/v1/'), false)
  assert.equal(await ctx.oidcAccounts.modelAuthorization(f.profile.id), false)
  const chunks = []
  for await (const chunk of ctx.llm.stream({ provider: 'fixture-ai', model: 'fixture-model', messages: [] })) chunks.push(chunk)
  assert.ok(chunks.some(chunk => chunk.type === 'text-delta'))
  assert.ok(!chunks.some(chunk => chunk.type === 'finish' && chunk.reason?.kind === 'error'))
  const quota = await ctx.oidcAccounts.modelResourceFetch(f.profile.id, '/quota')
  assert.equal(quota.status, 200)
  assert.equal((await quota.json()).provider_id, 'fixture-ai')
  assert.ok(!JSON.stringify(await ctx.oidcAccounts.configuration()).includes('<ACCESS_TOKEN>'))
  await ctx.oidcAccounts.logout(f.profile.id)
  assert.deepEqual([...f.records.keys()], ['PERSONAL_API_KEY'])
  assert.equal(await ctx.oidcAccounts.modelAuthorization(f.profile.id, f.origin + '/v1'), false)
  assert.deepEqual(events.map(event => event.state), ['connected', 'signed_out'])
  const before = f.requests.length
  await assert.rejects(ctx.oidcAccounts.modelResourceFetch(f.profile.id, '/quota'), { code: 'oidc_login_required' })
  assert.equal(f.requests.length, before)
  assert.ok(!f.requests.some(row => /bootstrap|runtime-credential/.test(row.path)))
})
