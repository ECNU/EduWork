/**
 * Run the relay with its web client. TLS belongs to a reverse proxy in front;
 * the relay listens on loopback by default.
 *
 *   RELAY_ORIGIN=https://remote.example.edu RELAY_ACCESS_KEYS=key1,key2 eduwork-remote-relay
 *
 * RELAY_ORIGIN            public origin of the relay (required)
 * RELAY_ACCESS_KEYS       comma-separated access keys issued to Host owners
 * RELAY_OIDC_ISSUER       admit Hosts signed in to this OpenID Connect issuer, by their ID Token
 * RELAY_OIDC_CLIENT_IDS   comma-separated client IDs of the applications whose sign-in counts
 *                         (at least the keys, or the issuer with its client IDs, is required)
 * RELAY_CLIENT_IP_HEADER  header in which the reverse proxy passes the client's address, e.g. x-real-ip
 * HOST, PORT              listening address (default 127.0.0.1:8787)
 */
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { IdTokens } from './id-token.ts'
import { Relay } from './relay.ts'
import { webClient } from './web.ts'

const list = (value = ''): string[] => value.split(',').map(item => item.trim()).filter(Boolean)
const origin = process.env.RELAY_ORIGIN ?? ''
const accessKeys = list(process.env.RELAY_ACCESS_KEYS)
const issuer = process.env.RELAY_OIDC_ISSUER ?? ''
const clientIds = list(process.env.RELAY_OIDC_CLIENT_IDS)
const header = process.env.RELAY_CLIENT_IP_HEADER?.toLowerCase()
if (!/^https?:\/\/[^/]+$/.test(origin) || (accessKeys.length === 0 && issuer === '') || (issuer === '') !== (clientIds.length === 0)) {
  console.error('Set RELAY_ORIGIN (e.g. https://remote.example.edu), and RELAY_ACCESS_KEYS or RELAY_OIDC_ISSUER with RELAY_OIDC_CLIENT_IDS.')
  process.exit(2)
}

const relay = new Relay({
  origin,
  accessKeys,
  ...issuer !== '' && { idTokens: new IdTokens({ issuer, clientIds }) },
  ...header !== undefined && { address: request => String(request.headers[header] ?? '') },
})
const web = webClient(fileURLToPath(new URL('./web/', import.meta.url)), origin)
const server = createServer((request, response) => {
  if (request.url === '/healthz') return void response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
  web(request, response).catch(error => {
    console.error(error)
    response.writeHead(500).end()
  })
})
server.on('upgrade', (request, socket, head) => relay.upgrade(request, socket, head) || socket.destroy())
server.listen(Number(process.env.PORT ?? 8787), process.env.HOST ?? '127.0.0.1', () => {
  console.log(`relay for ${origin} listening on ${JSON.stringify(server.address())}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    relay.close()
    server.close(() => process.exit(0))
  })
}
