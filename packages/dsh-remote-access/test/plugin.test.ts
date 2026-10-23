// The built plugin in a Cordis context with stand-in DSH services: off until
// switched on, configured and given the access key, then registered with a
// real relay, and stopped with its fiber. Run `node scripts/build.ts` first.
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { parsePairingLink } from '../src/protocol/auth.ts'
import { ACCESS_KEY_REF } from '../src/typert.ts'
import { ACCESS_KEY, startRelay, until } from './loopback.ts'

type Plugin = typeof import('../src/plugin.ts')
const { default: RemoteDevices } = await import(new URL('../lib/index.js', import.meta.url).href) as Plugin

const services = {
  webServer: { renderIndex: (html: string) => html, getOrigin: () => 'http://127.0.0.1:9' },
  connection: {
    createPeer: () => ({ dispose: async () => {} }),
    createSharedFetchHandler: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
  },
  typertGateway: { wireStream: { open: async () => [], failure: () => ({ code: 'internal', message: '', details: {} }) } },
}

/** DSH's credential service over the values stored so far. */
const credentials = (stored: Map<string, string>) => ({
  resolve: async (ref: string) => stored.has(ref) ? { value: stored.get(ref)! } : undefined,
})

test('remote access runs only while switched on and configured, starts once the access key is stored, and stops with the plugin', async t => {
  const home = await mkdtemp(join(tmpdir(), 'remote-access-plugin-'))
  process.env.DSH_HOME = home
  const distIndex = join(home, 'index.html')
  await writeFile(distIndex, '<!doctype html><head></head>')
  const relay = await startRelay(t)
  const stored = new Map<string, string>()
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const [name, value] of Object.entries({ ...services, credentials: credentials(stored) })) ctx.provide(name, value)
  const load = async (config: object): Promise<{ fiber: { dispose(): Promise<void> }; service: InstanceType<Plugin['default']> }> => {
    const fiber = await ctx.plugin(RemoteDevices, { distIndex, ...config })
    return { fiber, service: ctx.get('remoteDevices') }
  }

  const off = await load({})
  assert.deepEqual(await off.service.status(), { state: 'off' })
  await assert.rejects(off.service.createInvite(), /not running/)
  await off.fiber.dispose()

  const { fiber, service: running } = await load({ enabled: true, relay, hostName: 'Lab PC' })
  assert.deepEqual(await running.status(), { state: 'off' }, 'no access key yet')
  // The settings page stores the key through DSH, which announces the change.
  stored.set(ACCESS_KEY_REF, ACCESS_KEY)
  ctx.emit('credentials/reference-updated', ACCESS_KEY_REF)
  await until(async () => {
    const status = await running.status()
    return status.state === 'on' && status.link.state === 'online'
  }, 'registration')
  const status = await running.createInvite()
  assert.ok(status.state === 'on' && status.invite !== undefined)
  assert.equal(parsePairingLink(new URL(status.invite.link).hash)?.hostId, status.hostId)
  assert.ok(status.invite.link.startsWith(`${relay}#`))

  await fiber.dispose()
  assert.equal((await running.status()).state, 'off')
})

test('remote access starts outside the settings change that switched it on', async t => {
  const home = await mkdtemp(join(tmpdir(), 'remote-access-plugin-'))
  process.env.DSH_HOME = home
  const distIndex = join(home, 'index.html')
  await writeFile(distIndex, '<!doctype html><head></head>')
  const relay = await startRelay(t)
  // Stands in for DSH's configuration transaction, which refuses nested settings writes.
  const transaction = new AsyncLocalStorage<boolean>()
  const started: (boolean | undefined)[] = []
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const connection = { ...services.connection, createSharedFetchHandler: () => {
    started.push(transaction.getStore())
    return services.connection.createSharedFetchHandler()
  } }
  const stored = new Map([[ACCESS_KEY_REF, ACCESS_KEY]])
  for (const [name, value] of Object.entries({ ...services, connection, credentials: credentials(stored) })) ctx.provide(name, value)
  await transaction.run(true, () => ctx.plugin(RemoteDevices, { distIndex, enabled: true, relay }))
  const service: InstanceType<Plugin['default']> = ctx.get('remoteDevices')
  await service.status()
  transaction.run(true, () => ctx.emit('loader/volatile-update'))
  await service.status()
  assert.deepEqual(started, [undefined, undefined])
})

test('with an organization set, remote access uses its relay and follows its sign-in', async t => {
  const home = await mkdtemp(join(tmpdir(), 'remote-access-plugin-'))
  process.env.DSH_HOME = home
  const distIndex = join(home, 'index.html')
  await writeFile(distIndex, '<!doctype html><head></head>')
  // `member:<exp>` stands in for an ID Token of the organization's sign-in.
  const relay = await startRelay(t, { accessKeys: [], idTokens: { verify: async token => ({ subject: 'alice', expiresAt: Number(token.split(':')[1]) }) } })
  const account = { state: 'signed_out', tokens: 0, renewed: true }
  const oidcAccounts = {
    status: async (profileID: string) => ({ profileID, state: account.state, displayName: 'Example University' }),
    identityToken: async () => {
      if (!account.renewed) throw Object.assign(new Error('The issuer did not renew the ID Token; please sign in again'), { code: 'oidc_identity_token_unavailable' })
      account.tokens++
      const expiresAt = Math.floor(Date.now() / 1000) + 3600
      return { token: `member:${expiresAt}`, expiresAt }
    },
  }
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const [name, value] of Object.entries({ ...services, credentials: credentials(new Map()), oidcAccounts })) ctx.provide(name, value)
  // The relay set on the settings page does not count; the token goes only to the organization's.
  await ctx.plugin(RemoteDevices, { distIndex, enabled: true, relay: 'https://elsewhere.example', organization: { relay, oidcProfileId: 'example' } })
  const service: InstanceType<Plugin['default']> = ctx.get('remoteDevices')
  const organization = { name: 'Example University', relay }
  assert.deepEqual(await service.status(), { state: 'sign-in', organization })

  account.state = 'connected'
  ctx.emit('oidc/accounts-changed', { profileID: 'other' })
  assert.equal((await service.status()).state, 'sign-in', 'another sign-in changes nothing')
  ctx.emit('oidc/accounts-changed', { profileID: 'example' })
  await until(async () => {
    const status = await service.status()
    return status.state === 'on' && status.link.state === 'online'
  }, 'registration by ID Token')
  assert.deepEqual((await service.status()).organization, organization)
  assert.equal(account.tokens, 1)

  // Once the sign-in yields no ID Token, remote access waits for the user to sign in again, then resumes.
  account.renewed = false
  ctx.emit('oidc/accounts-changed', { profileID: 'example' })
  await until(async () => {
    const status = await service.status()
    return status.state === 'on' && status.link.state === 'lapsed'
  }, 'the lapsed sign-in')
  account.renewed = true
  ctx.emit('oidc/accounts-changed', { profileID: 'example' })
  await until(async () => {
    const status = await service.status()
    return status.state === 'on' && status.link.state === 'online'
  }, 'registration after signing in again')

  account.state = 'signed_out'
  ctx.emit('oidc/accounts-changed', { profileID: 'example' })
  assert.deepEqual(await service.status(), { state: 'sign-in', organization })
})
