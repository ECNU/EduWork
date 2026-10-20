// The built plugin in a Cordis context with stand-in DSH services: off until
// switched on and configured, then registered with a real relay, and stopped
// with its fiber. Run `node scripts/build.ts` first.
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { parsePairingLink } from '../src/protocol/auth.ts'
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

test('remote access runs only while switched on and configured, and stops with the plugin', async t => {
  const home = await mkdtemp(join(tmpdir(), 'remote-access-plugin-'))
  process.env.DSH_HOME = home
  const distIndex = join(home, 'index.html')
  await writeFile(distIndex, '<!doctype html><head></head>')
  const relay = await startRelay(t)
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const [name, value] of Object.entries(services)) ctx.provide(name, value)
  const load = async (config: object): Promise<{ fiber: { dispose(): Promise<void> }; service: InstanceType<Plugin['default']> }> => {
    const fiber = await ctx.plugin(RemoteDevices, { distIndex, ...config })
    return { fiber, service: ctx.get('remoteDevices') }
  }

  const off = await load({})
  assert.deepEqual(await off.service.status(), { accessKeySet: false, state: 'off' })
  await assert.rejects(off.service.createInvite(), /not running/)
  await off.fiber.dispose()

  const unconfigured = await load({ enabled: true, accessKey: ACCESS_KEY })
  assert.deepEqual(await unconfigured.service.status(), { accessKeySet: true, state: 'off' }, 'no relay yet')
  await unconfigured.fiber.dispose()

  const { fiber, service: running } = await load({ enabled: true, relay, accessKey: ACCESS_KEY, hostName: 'Lab PC' })
  await until(async () => {
    const status = await running.status()
    return status.state === 'on' && status.link.state === 'online'
  }, 'registration')
  const status = await running.createInvite()
  assert.ok(status.state === 'on' && status.invite !== undefined)
  assert.equal(parsePairingLink(new URL(status.invite.link).hash)?.hostId, status.hostId)
  assert.ok(status.invite.link.startsWith(`${relay}/#`))

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
  for (const [name, value] of Object.entries({ ...services, connection })) ctx.provide(name, value)
  await transaction.run(true, () => ctx.plugin(RemoteDevices, { distIndex, enabled: true, relay, accessKey: ACCESS_KEY }))
  const service: InstanceType<Plugin['default']> = ctx.get('remoteDevices')
  await service.status()
  transaction.run(true, () => ctx.emit('loader/volatile-update'))
  await service.status()
  assert.deepEqual(started, [undefined, undefined])
})
