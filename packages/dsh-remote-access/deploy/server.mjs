// Deployment entry point for the EduWork remote-access relay.
//
// This file is not part of the plugin package. The relay is meant to be built
// from `@eduwork/dsh-remote-access`'s `src/relay/` by whoever operates it, and
// `docs/protocol.md` says so; this is the operator's file, and it lives here so
// the checksums committed alongside it mean something.
//
// It is deliberately all configuration and no logic. Everything it can decide is
// read from the environment, and the three things it must not get wrong are:
//
//   * It binds to loopback. The relay is reached through a TLS terminator; if it
//     bound a public interface, the address in `/etc/eduwork-relay.env` would
//     become the only thing between the open internet and an unauthenticated
//     upgrade endpoint.
//   * It writes its host registry somewhere persistent. The registry is
//     trust-on-first-use: the first key to claim a host id keeps it, so losing
//     the file means losing the binding that stops someone else claiming it.
//   * It never enables anything optional. There is nothing to enable.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createRelay } from './relay.js'
import { RELAY_VERSION } from './protocol.js'

const here = dirname(fileURLToPath(import.meta.url))

function required(name) {
  const value = process.env[name]
  if (value === undefined || value === '') {
    // Failing loudly at startup beats binding to a default port nobody wrote
    // down, which is how a service ends up unreachable with no error anywhere.
    process.stderr.write(`eduwork-relay: ${name} is required\n`)
    process.exit(1)
  }
  return value
}

const host = process.env.EDUWORK_RELAY_BIND ?? '127.0.0.1'
const port = Number.parseInt(required('EDUWORK_RELAY_PORT'), 10)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.stderr.write(`eduwork-relay: EDUWORK_RELAY_PORT is not a port: ${process.env.EDUWORK_RELAY_PORT}\n`)
  process.exit(1)
}

// The relay's own source, copied next to this file by the deploy step.
const storePath = process.env.EDUWORK_RELAY_STORE ?? '/var/lib/eduwork-relay/hosts.json'
const webRoot = process.env.EDUWORK_RELAY_WEB_ROOT ?? join(here, 'web')
const frontendRoot = process.env.EDUWORK_RELAY_FRONTEND_ROOT ?? join(here, 'frontend')

// The URL the page is told to load the bootstrap from.
//
// This has to be the URL a *browser* can reach, which is not always the path the
// relay serves it on. When a reverse proxy publishes the relay under a prefix and
// strips that prefix before forwarding, the relay never sees the prefix, so its
// own idea of the path is the unprefixed one — and an injected absolute path
// without the prefix is a 404 in the browser. That failure is silent in the worst
// way: the page loads, looks fine, and never connects.
//
// So it is configuration. The default is what a relay served at the root wants.
const bootstrapScript = process.env.EDUWORK_RELAY_BOOTSTRAP_SCRIPT ?? '/eduwork-assets/bootstrap.js'
if (bootstrapScript[0] !== '/') {
  process.stderr.write(`eduwork-relay: EDUWORK_RELAY_BOOTSTRAP_SCRIPT must start with "/": ${bootstrapScript}\n`)
  process.exit(1)
}

function log(line) {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`)
}

log(`eduwork-relay: protocol ${RELAY_VERSION}`)
log(`eduwork-relay: binding ${host}:${String(port)}`)
log(`eduwork-relay: host registry ${storePath}`)
log(`eduwork-relay: bootstrap assets ${webRoot}`)
log(`eduwork-relay: bootstrap url ${bootstrapScript}`)
log(`eduwork-relay: frontend ${frontendRoot}`)

const relay = createRelay({
  host,
  port,
  storePath,
  webRoot,
  frontendRoot,
  bootstrapScript,
  log,
})

relay.listen(() => {
  const { address, port: bound } = relay.server.address() ?? {}
  log(`eduwork-relay: listening on ${String(address)}:${String(bound)} with ${String(relay.hosts.size)} known host(s)`)
  for (const [hostId, record] of relay.hosts) {
    log(`eduwork-relay:   ${hostId} bound ${record.registeredAt}`)
  }
  if (relay.hosts.size === 0) {
    log('eduwork-relay: no host id is bound yet - whichever key claims one first keeps it')
  }
})

// A failed listen (port in use, permission denied) would otherwise leave a
// process alive with no listener, which systemd would report as healthy.
relay.server.on('error', (error) => {
  process.stderr.write(`eduwork-relay: listener failed: ${error.message}\n`)
  process.exit(1)
})

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    log(`eduwork-relay: ${signal}, closing`)
    relay.close().then(() => {
      process.exit(0)
    }, (error) => {
      process.stderr.write(`eduwork-relay: shutdown failed: ${String(error)}\n`)
      process.exit(1)
    })
  })
}
