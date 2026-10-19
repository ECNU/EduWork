# Remote Access Proposal: Operate a Local DSH Agent from Another Device's Browser

**English** | [简体中文](README.md)

Status: Draft. A prototype is implemented and has passed package tests and real-device verification, but it is not released. This document fixes the public interface's boundaries and acceptance conditions; it does not describe a released feature or a configuration that can be copied into production. npm publication, product dependency locks, desktop Releases, and institutional deployment are approved separately.

Related: [Issue #116](https://github.com/ECNU/EduWork/issues/116); prototype branch `feat/remote-access-skeleton`; package [`packages/dsh-remote-access`](../../../packages/dsh-remote-access/README_EN.md); relay deployment [`deploy`](../../../packages/dsh-remote-access/deploy/README.md).

## Goals

Let a browser on another device (typically a phone) view and continue the workspaces, sessions, and tasks of a local EduWork/DSH Agent across networks, while keeping the Host's data plane private:

1. The remote browser loads the **Host's own Web UI**, can list and open the Host's workspaces, read session history, send prompts, and receive streamed events.
2. The Host and the device communicate end to end; the relay only forwards ciphertext and never holds the Host's launch credential.
3. A device is paired and confirmed before it connects. Revocation is per device and also closes that device's live connection.
4. A remote device gets only explicitly listed operations; Host administration (pairing, credentials, plugin install/uninstall, terminal, invitations) is unreachable by default.
5. An independent plugin package plus a self-hostable relay; no binding to a school, an institutional domain, or a public service.

The maintainer's 2026-10-16 direction is a constraint on this proposal: URL-first (any browser can open it; a QR code is only convenience); a paired remote terminal can approve/reject and answer Agent questions; the independent plugin lives in `packages/` and may be published as its own npm package; the server may live in a separate repository; "zero new dependencies" is not a hard constraint, and official UI/connection layers and mature community dependencies are preferred; prototype first, then converge the protocol.

**Non-goals**: changing the DSH kernel's `/api` authorization model; multi-user/multi-tenant operation; a public SaaS relay, billing, or enterprise directory integration; exposing the Host's whole filesystem to the remote device; shipping npm or a desktop Release in this proposal.

## Components and trust boundary

| Component | Location | Trust |
| --- | --- | --- |
| Host plugin | `packages/dsh-remote-access`, inside the DSH Host process | Trusted; holds the Host identity and the device registry |
| Relay | Separate process/service, self-hostable | **Untrusted**: sees only ciphertext and routing metadata; it can replace the bootstrap it serves, so the deployer must still be trusted |
| Device bootstrap | Classic script served by the relay | Device-side crypto and transport; the device key lives in browser IndexedDB |
| Remote browser | Modern browser (WebCrypto, IndexedDB, WebSocket) | Device identity, confirmed on the Host |
| Host admin page | Host loopback web server | Loopback only; per-boot token |

The relay can see the hostId, connection times, and frame sizes/timing; it cannot see session content. It can replace the bootstrap, which end-to-end encryption cannot prevent; the deployer must be trusted and the documentation must say so. A device enters `trusted` only after Host confirmation; pending/revoked devices are refused at the gate before any endpoint lookup. Each device has its own credential; revocation invalidates it and closes the live channel.

## Protocol and data plane

- Relay paths: Host `wss://<relay>/eduwork/host`; device `wss://<relay>/eduwork/peer?h=<hostId>`. The first registration binds the hostId to a public key; a different key is refused. A same-key reconnect replaces the old connection. One device per Host at a time.
- Handshake: P-256 ECDSA identity plus ECDH, deriving direction-specific AES-GCM keys. Frames carry version, direction, and a strictly increasing sequence; unauthenticated or out-of-order frames are dropped.
- Application layer: `client-request`/`server-response` envelopes; logical-stream frames `open/item/end/cancel/error`; unary calls and streams share one sealed channel.
- Streams: `$events` (Gateway forwarded events, the connection-generation source), `workspace/follow` (workspace state), `session/control` (approvals and questions), `session/follow` (session history/state).
- Gate: `ENDPOINT_OPERATIONS` maps Host RPC endpoints to `surface:operation`; `OPERATION_TABLE` in `gate.js` is the only authorization table. Agent surface: session list/read/create/prompt/cancel, workspace list/read, artifact read/download, settings read, read-only model/job catalogs. Host surface: a code-level allowlist admits only `directory:list` and `workspace:create`; credentials, pairing, plugins, terminal, and invitations remain refused. Unknown endpoints are refused as `unknown-operation`; names are never guessed.
- Calls with side effects carry a client-generated `requestId`; the Host deduplicates successful results by `(deviceId, requestId, endpoint, payload)` and joins concurrent copies, while failures are not cached. The cache is bounded and does not survive a restart; clients handle an unknown outcome according to the operation's semantics.

## Reusing the Web UI

The remote side runs the official UI rather than a second client:

1. The Host takes its own rendered `/` with an in-process kernel cookie (the `__ModuleLoader__` facade, the boot graph, and the index injection rows) plus the `/plugins/...` combos the page names, and exports a snapshot.
2. Deployment mirrors the snapshot to the relay; the relay serves it at `/eduwork/` and injects the device bootstrap into `</head>`.
3. The bootstrap installs `__DSH_TRANSPORT__.rpc.call` and implements the Gateway's `/api/remote.mux`: mux JSON frames travel over the same sealed channel; `streamBaseUrl` points at the page's directory.
4. The remote page has a different origin from the Host: `<base href="./">` keeps assets relative; the relay replays `/plugins` combos by `sha256(path+query)`; the Host origin never appears in the page.
5. For a non-loopback browser `isLoopback` is false, so Host-only settings writes degrade to an in-process acknowledgement (the preview notice no longer blocks).

**Upstream coupling**: the index injection rows, the boot graph, the `/plugins` combo format, `__DSH_CONNECTION_RECOVERY__`, and the meaning of `isLoopback`. These are Host contracts of DSH `0.2.0-rc.2`; an upstream semantic change breaks the remote side and needs joint review.

## Local composition and directory selection

Choosing a workspace remotely needs a Host directory listing. The official remote/unattended composition provides a browse backend and a browse client; the prototype disables the desktop-native picker in the profile and enables the browse pair. The consequence is that the **local machine also gets the in-app dialog**, a known compatibility impact. Follow-up: make it conditional per client (native locally, browse remotely), or provide a remote-specific entry.

`directory:list`/`workspace:create` are classified as the **narrow Host surface** and granted to a confirmed device by default; this is the only new Host authorization in this proposal and needs explicit maintainer approval.

## Compatibility

- DSH: Host plugin API `0.2.0-rc.2`; relies on `settings`, `connection`, `typertGateway.wireStream`, and `webServer.collectIndexInjections` as official seams.
- Browsers: WebCrypto P-256/ECDH/AES-GCM, IndexedDB, WebSocket; verified on iPhone Safari and Chromium.
- Host: Electron desktop and web host; relay: Node, no extra native dependency.
- Data: the device identity lives in browser IndexedDB; the Host identity in `ctx.credentials`; the device registry in a settings row; session/workspace formats are not migrated.
- Package: `@eduwork/dsh-remote-access`, `0.1.0-dev`, its own npm version; registered in `scripts/packages/catalog.mjs`.
- Composition: the profile's directory picker changes from native to browse; a revertible configuration change that affects local UX.
- Public examples use synthetic workspaces, placeholder domains, and synthetic device ids; real sessions, paths, keys, or machine configuration are never committed.

## Acceptance criteria

1. An unpaired device is refused; the error does not reveal whether an endpoint exists.
2. A paired device can `session/list`, `session/page`, and `session/prompt`, receives streamed events, and can use the control stream.
3. A reconnect does not repeat a side-effecting operation when the Host's cache still holds the same request; after eviction or a Host restart, the client handles the unknown outcome.
4. Revoking a device immediately closes its live connection and refuses subsequent handshakes.
5. A remote browser loads the Host-rendered UI from the **relay**; the workspace list and session history render correctly; it works on a mobile network.
6. The relay sees only ciphertext; the device cannot reach credentials, pairing, plugins, terminal, or invitation administration.
7. The system recovers after a relay restart or Host reconnect; a same-key new connection replaces the old one.

Every PR reports the verification actually performed and the unverified scope. Package tests, protocol-level device acceptance, and real-device acceptance are recorded separately; contract tests do not replace real-network or desktop behaviour.

## Open questions

1. Order of proposal and Draft PR (proposal first, or proposal inside the PR).
2. Whether the device bootstrap becomes public source in the package (reproducible deployment), and the documentation's wording about deployer trust.
3. Whether the narrow Host surface is acceptable; whether the local native directory dialog must be resolved in this PR.
4. Whether the invite flow and the relay access key are v1 blockers.
5. Whether end-to-end approval/question acceptance is required for v1.
6. Timing of npm publication/dependency locks/Release (separate from this proposal).

## Evolution

- v1: real invite flow, relay access key, approval/question acceptance, conditional native desktop picker, iOS background reconnect.
- Later: multi-device concurrency policy, relay observability, and the integrity/replaceability discussion around the bootstrap.
