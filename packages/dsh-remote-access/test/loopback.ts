// A real relay on loopback for the Host-side tests, and polling for a condition.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { TestContext } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Relay, type RelayOptions } from '../src/relay/relay.ts'

export const ACCESS_KEY = 'issued-to-this-host'

/** The credential option of a Host that registers with an access key. */
export const withKey = (accessKey = ACCESS_KEY) => async () => ({ credential: { accessKey } })

/** A relay accepting {@link ACCESS_KEY} below a path, as when it shares a domain, closed after the test; resolves with its base URL. */
export async function startRelay(t: TestContext, options: Partial<RelayOptions> = {}): Promise<string> {
  const server = createServer((_request, response) => response.writeHead(404).end())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/remote/`
  const relay = new Relay({ url, accessKeys: [ACCESS_KEY], ...options })
  server.on('upgrade', (request, socket, head) => relay.upgrade(request, socket, head) || socket.destroy())
  t.after(() => {
    relay.close()
    server.close()
  })
  return url
}

export async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200 && !await condition(); i++) await sleep(10)
  assert.ok(await condition(), `timed out waiting for ${what}`)
}
