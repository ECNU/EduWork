// Browser half of scripts/check-browser.ts: the device side of the protocol,
// bundled for the page exactly as the web client will use it.
import { deviceAuth, generateDeviceKey, pairingCode } from '../../src/protocol/auth.ts'
import { fromBase64url } from '../../src/protocol/bytes.ts'
import { Channel } from '../../src/protocol/channel.ts'
import { prologue } from '../../src/protocol/noise.ts'
import { TunnelClient } from '../../src/protocol/tunnel.ts'

export async function run(url: string, hostId: string, hostKey: string, uploadBytes: number) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  const channel = await Channel.connect(socket, fromBase64url(hostKey), prologue('relay', hostId), AbortSignal.timeout(10_000))
  const device = await generateDeviceKey()
  channel.send(await deviceAuth(device, channel.hash, { invite: 'x'.repeat(22), name: navigator.userAgent.slice(0, 64) }))
  const reply = await channel.receive()
  const client = new TunnelClient(channel)

  const upload = new Uint8Array(uploadBytes).map((_, i) => (i * 7) % 256)
  const started = performance.now()
  const response = await client.fetch({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/octet-stream' }, body: upload })
  const echoed = new Uint8Array(await response.arrayBuffer())
  const roundTripMs = performance.now() - started
  const intact = echoed.length === upload.length && echoed.every((byte, i) => byte === upload[i])

  const items: unknown[] = []
  for await (const item of client.openStream('$events', { from: 0 }, new AbortController().signal)) items.push(item)
  await client.ping()
  return { reply: reply.header, code: await pairingCode(channel.hash), intact, roundTripMs: Math.round(roundTripMs), items }
}
