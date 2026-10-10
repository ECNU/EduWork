# @eduwork/dsh-remote-access

English | [中文](README.md)

Lets a **second device** see and continue, over the Web, the sessions, tasks and
workspace results a DSH agent is already running on this machine.

This is a **DSH plugin**: device registry, one-time pairing, device credentials,
live-connection management and a relay gate. The operation fence's decision table
lives in `./gate` but is **not wired up yet** — see below. It binds to no school, no
institution domain and no public service — the relay is an optional component,
and a shared LAN, a self-hosted VPN or port forwarding all work without one.

## What it does

| Capability | Detail |
| --- | --- |
| **Per-device identity** | Each device holds its own credential and can be withdrawn on its own, without touching the others |
| **One-time pairing** | A short-lived invitation that is spent on first use; a replay, a late attempt and a typo are indistinguishable |
| **Confirmation on this machine** | A device takes effect only after a human confirms it **here**, never on the remote side's own say-so |
| **Revocation disconnects** | Revocation invalidates the credential **and** tears down the device's established streams — refusing the next request is not revocation |

### Why the operation fence does not count yet

`decide()` in `./gate` lists what a remote client may do — sessions and workspace,
read-only plus a single `prompt` — and refuses the host management surface
(pairing, credentials, plugin install, terminal, `workspace:write`). The table is a
pure function with tests behind it, but **nothing calls it**: `./listener` admits by
path and never looks at an operation.

The more important point is not that it is unwired, but that **wiring it would not
take the authority back**. For the phone to get through the host's own door, the
relay has to hand it the host's launch credential (see "Known trade-offs" below).
The phone therefore holds a **full host browser session**, and no HTTP relay
standing in front of it can subtract from what the host has already granted. A real
fence has to be enforced by the **host**, in its own authorization layer.

So: `decide()` is input for the next stage, not this stage's security boundary. **Do
not read the existence of the `./gate` export as meaning a remote client cannot
reach host management.**

## Install

```bash
npm install @eduwork/dsh-remote-access
```

The plugin assembles as an ordinary DSH plugin with `inject: ['settings']`, keeps
its device registry in the `eduwork-remote-access` settings namespace and
publishes itself to other plugins in the same process through
`ctx.provide('remoteAccess', …)`.

## Quick start

```js
import { DeviceStore, createGatedRelay } from '@eduwork/dsh-remote-access/listener'
import { LiveConnections } from '@eduwork/dsh-remote-access/connections'
import { emptyCredentials, issueCredential, authenticate } from '@eduwork/dsh-remote-access/credentials'
import { createInvitation, redeemInvitation } from '@eduwork/dsh-remote-access/pairing'
import { decide } from '@eduwork/dsh-remote-access/gate'

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

## Known trade-offs

**The phone holds the host's own session credential.** For the phone to get through
the host's door, the relay has to pass on the host's launch credential. This is the
heaviest trade-off of the stage: what the phone receives is not a trimmed-down set of
permissions but a **full host browser session**. That, and not whether `./gate` is
wired, is why the operation fence above does not count.

**The relay does not deduplicate for the host.** A call with a side effect carries a
client-generated `requestId` straight through, and the host's `hasPromptRequest`
decides — it covers both the queued-but-not-yet-run window and the already-in-the-
event-stream one. A second dedup layer here would only be another piece of state that
can disagree with the host.

**`./gate` is input for the next stage.** Its table is complete and tested, and it is
what a host-side fence should use. In this stage it is not a security boundary.

## Status

| Part | State |
| --- | --- |
| Device registry, one-time pairing, device credentials, live-connection management | **Implemented**, covered by `node --test` |
| Gated relay (`./listener`): admission, pairing entry and waiting page, per-device revocation | **Implemented**, covered by `node --test` |
| Operation fence (`./gate`): the decision table itself | **Implemented but unwired** — it has no caller; see above |
| A host-side enforcement fence, assembly into the product runtime, a standalone Web client, end-to-end encryption | **Planned**, not in this package |

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
