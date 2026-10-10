# @chatecnu-work/dsh-remote-access

English | [中文](README.md)

Lets a **second device** see and continue, over the Web, the sessions, tasks and
workspace results a DSH agent is already running on this machine.

This is a **DSH plugin**: device registry, one-time pairing, device credentials,
operation fence and live-connection management. It binds to no school, no
institution domain and no public service — the relay is an optional component,
and a shared LAN, a self-hosted VPN or port forwarding all work without one.

## What it does

| Capability | Detail |
| --- | --- |
| **Per-device identity** | Each device holds its own credential and can be withdrawn on its own, without touching the others |
| **One-time pairing** | A short-lived invitation that is spent on first use; a replay, a late attempt and a typo are indistinguishable |
| **Confirmation on this machine** | A device takes effect only after a human confirms it **here**, never on the remote side's own say-so |
| **Revocation disconnects** | Revocation invalidates the credential **and** tears down the device's established streams — refusing the next request is not revocation |
| **Operation fence** | Deny by default; a remote client **cannot reach** host management (credentials, plugin install, terminal, `workspace:write`) |

## Install

```bash
npm install @chatecnu-work/dsh-remote-access
```

The plugin assembles as an ordinary DSH plugin with `inject: ['settings']`, keeps
its device registry in the `chatecnu-remote-access` settings namespace and
publishes itself to other plugins in the same process through
`ctx.provide('remoteAccess', …)`.

## Quick start

```js
import { DeviceStore, createGatedRelay } from '@chatecnu-work/dsh-remote-access/listener'
import { LiveConnections } from '@chatecnu-work/dsh-remote-access/connections'
import { emptyCredentials, issueCredential, authenticate } from '@chatecnu-work/dsh-remote-access/credentials'
import { createInvitation, redeemInvitation } from '@chatecnu-work/dsh-remote-access/pairing'
import { decide } from '@chatecnu-work/dsh-remote-access/gate'

// 1. Mint a one-time invitation. Only `code` goes to the device; the registry
//    keeps a digest and nothing else.
const { invitations, code } = createInvitation(emptyInvitations(), { now: new Date().toISOString() })

// 2. The device redeems it. Consumption happens before validation, so a replay
//    and a typo leave identical state behind.
const { invitations: remaining } = redeemInvitation(invitations, code, new Date().toISOString())

// 3. Only a digest is stored; the plaintext secret exists exactly once.
const { store, secret } = issueCredential(emptyCredentials(), deviceId, new Date().toISOString())

// 4. Verify the credential on every request (constant-time comparison).
const { ok } = authenticate(store, deviceId, secret, new Date().toISOString())

// 5. Decide whether an operation is allowed (deny by default).
const verdict = decide(device, 'session:prompt')   // { allowed: true, sideEffect: true }

// 6. Revoke: seal the device first, then sweep — a connection mid-handshake
//    loses rather than slipping through.
const live = new LiveConnections()
live.closeAll(deviceId)

// 7. Put the gate in front of the host, which itself listens only on loopback.
const relay = createGatedRelay({
  hostPort: 8901,                       // the host's loopback port
  store: new DeviceStore('.state/devices.json'),
  onRequest: async device => confirmInPerson(device),   // a human decides on this machine
  upstreamToken: () => hostLaunchToken(),
})
relay.listen(8899, '0.0.0.0')
```

## Status

| Part | State |
| --- | --- |
| Device registry, one-time pairing, device credentials, operation fence, live-connection management | **Implemented**, covered by `node --test` |
| Gated relay (`./listener`): admission, pairing entry and waiting page, per-device revocation | **Implemented**, covered by `node --test` |
| Assembly into the product runtime, a standalone Web client, end-to-end encryption | **Planned**, not in this package |

The logic modules perform no I/O: the caller supplies the current time, which is
what lets the pairing and revocation semantics be tested directly. `./listener`
is the only module holding a file or a socket, and it leaves storage location,
listening port and topology to the deployment.

## Documentation

- [Remote access protocol v1](docs/protocol.md) — the contract between device,
  relay and host, covering credential separation, the order of the gate, the
  three actions revocation performs, and the idempotency rules.

## License

MIT
