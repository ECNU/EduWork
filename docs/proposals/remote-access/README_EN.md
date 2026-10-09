# Open Remote Access Protocol and Web Client Proposal

[简体中文](README.md) | **English**

Status: this proposal is a **draft under review and is not implemented**. The protocol name, frames,
fields, configuration keys, scope vocabulary and commands below are **design intent**; they do not
represent shipped functionality or configuration that can be used as-is. Do not change production
configuration based on an unreleased proposal. Items marked **verified** come from the READMEs and
type declarations of the installed packages on this machine and can be checked line by line at the
paths given; items marked **inferred** or **to verify** have not been confirmed at source level.

Ownership: public edition (EduWork). Institution-specific services and deployment details are separate;
see [Institution edition boundary](#institution-edition-boundary).
Related: issue [#116](https://github.com/ECNU/EduWork/issues/116), roadmap [#95](https://github.com/ECNU/EduWork/issues/95).

## Goal

Let a user view and continue the sessions, tasks and workspace artifacts of a running EduWork from
another device through a browser. The public client and protocol bind to no school or server
implementation; institutions or developers may implement the access service themselves.

Three questions the design must answer (from #116):

1. Which DSH connection-layer capabilities to reuse, avoiding a duplicate kernel implementation;
2. What the local host, the web client and the relay/access service are each responsible for;
3. How device pairing, authentication, revocation, operation authorization, state synchronization
   and disconnect recovery are designed.

## One-sentence conclusion

**DSH 0.2.0-rc.2 has already built the entire browser-to-Host path.**
This proposal does not invent a protocol stack. It adds **a remotely carried implementation of the
existing Connection carrier layer**, and supplies the three things that layer deliberately does not
do: **device identity, individually revocable authorization, and transport security beyond loopback.**

The three verified facts behind this conclusion appear under
[Relationship to existing implementations](#relationship-to-existing-implementations).

## Scope

In scope:

| Capability | Description |
| --- | --- |
| Versioned protocol `eduwork-remote/v1` | Handshake, capability negotiation, scope declaration, idempotency and recovery semantics |
| Remote carrier | A third Connection carrier on the host side with its own admission, bypassing the browser cookie |
| Device pairing and identity | Asymmetric keys on the device, human confirmation on the host, challenge-response authentication |
| Revocable device authorization | Per-device registration and revocation; deleting the record disconnects and voids that device's session |
| Authorization scope fence | Deny-by-default endpoint allowlist; remote authority strictly weaker than the local operator |
| Relay access contract | Relay responsibilities, a minimal access description, and a self-hosted reference implementation |
| Generic web client | Reuse the existing SPA; add pairing and mobile browser adaptation |

Out of scope:

| Item | Destination |
| --- | --- |
| School SSO, institution service discovery, campus network traversal | Institution edition; see [Institution edition boundary](#institution-edition-boundary) |
| End-to-end encryption algorithm selection and key rotation policy | Separate proposal; see [Open questions](#open-questions) |
| Hosting and operating a public relay | Not public-edition scope; the public edition ships only a minimal self-hosted reference |
| Desktop pet, calendar and other roadmap directions | Their own issues |
| A second desktop shell or a second RPC protocol | Explicitly not done; see [What this proposal does not do](#what-this-proposal-does-not-do) |

## Relationship to existing implementations

### Official foundations (verified)

| Package (`@deepseek-ai/`) | Verified capability | Relationship to this proposal |
| --- | --- | --- |
| `dsh-client-connection` | **Carrier-neutral** RPC and exact Fetch route registries; connection generation and reconnect state machine; browser trust fence; `OperatorPeer` | **Reused directly.** README: "The Host half **always** provides the carrier-neutral RPC and exact `GET`/`HEAD`/`POST` route registries. When a Web carrier is present it **also** owns the sole `/api` route, Fetch bridge, browser authentication, and Host/Origin checks; **a shell-owned carrier dispatches the shared Fetch handler directly.**" |
| `dsh-api-gateway` | `ctx.typertGateway` (Host) / `ctx.remote` (Client); `/api/remote.mux`; uplink backpressure and cancellation; `stream-protocol` frame format and parsers | **Reused directly.** README: "`./stream-protocol` exports the shared Remote stream frame format and parsers for **native desktop callers**. They use the same authenticated WebSocket endpoint as the browser client." |
| `dsh-api-remotes` | Capabilities and forwarded events explicitly selected at assembly time | **Reused directly.** This is the ready-made shape of the "server access contract" #116 asks for |
| `dsh-host-webserver` | `register` / `registerUpgrade` / `registerFallback` route registry | **Reused directly.** The remote carrier registers its routes as a host plugin |
| `dsh-credentials` | Credential record storage (`<scope>/<id>`) | **Adapted.** The device registry may reuse its storage, but **not** the cookie signing secret |
| `dsh-web-frontend` | Built SPA (`dist/`) | **Reuse candidate**; see [Client boundary](#client-boundary) |
| `dsh-sdk-protocol` + `dsh-sdk-jsonrpc-server` | An existing "pure protocol library + thin presentation adapter plugin" layering | **Pattern reference only**, not a protocol base; reasons below |

### Why the SDK protocol is not the base (verified)

`dsh-sdk-protocol` is the only existing outward-facing protocol in this repository, but it **cannot**
carry remote access:

- The transport is **stdio**, not the network;
- Known limitation: "**No protocol version negotiation** — the handshake carries only
  `serverInfo.version` (`0.0.1`, not validated by the client)";
- Known limitation: "**No cancellation or session-close methods** — a client abandons a turn by
  closing the runtime process";
- "**No per-prompt result** — `MessageId` only identifies inbox admission";
- It has no workspace, artifact, approval or settings surface.

**Its layering is worth copying**, though: a pure protocol library (no plugin, no configuration, no
registration) plus one thin presentation adapter plugin, sharing one set of named types; the protocol
structures are **reproduced rather than imported** by the Python SDK, so changing a method or payload
requires updating the counterpart side in the same change.

### The Peer contract deliberately records neither identity nor permission (verified; the basis of this proposal)

`dsh-typert-protocol/lib/types/types.d.ts`:

```
L294  /** Opaque identity of one Peer: a party admitted to this Host by the connection
L295   *  layer. "Peer" is a connection-layer word; … */
L300  /** One Peer's session on this Host. Connection owns it: `ctx` is the Cordis …
L302   *  Peer. Who the Peer is and what it may do are not recorded here. */
L326  /** Peer the call speaks for; an in-process carrier speaks for the operator. */
L327  readonly peer: PeerScope
```

Together these say: **"Peer" is a connection-layer word**, and the Peer contract expresses **only**
which party a call speaks for. It records neither what that Peer is nor what it may do.

A "remote device Peer" is therefore **permitted by the contract** to be implemented in the periphery:
`OperatorPeer` is the only existing implementation, but the contract itself assumes neither a single
Peer nor that a Peer must be the local operator. Permission (what it may do) falls, by the same
comment's division, under the **transport fence plus the assembly manifest**, not under Peer.

> **Note**: `@deepseek-ai/dsh-authorization` is **not** Peer/RBAC authorization. It is a flow registry
> for acquiring credentials that must be handed over by a human (OAuth-style login, one-time codes).
> Its own known limitation reads "**No revocation** — signing out is
> `ctx.credentials.deleteRecord(key)`, which forgets the local record without notifying the issuer."
> **Do not build device authorization on it.** What is worth borrowing is its pattern: "the seam owns
> the conversation, never the protocol" and "**interaction travels with the request, not the
> registry**" — the party that starts the authorization is the party that can talk to the human, so a
> question reaches exactly the interface that asked it. Device pairing needs that shape.

### The desktop shell already uses a shell-owned carrier (its adapter layer verified)

`dsh-electron/src/native-web-host.mjs` shows the EduWork desktop shell **running the official Host as a
real loopback HTTP server** (asserting it must be `http://127.0.0.1:<port>`, with no credentials and a
non-empty port, otherwise it stops the Host and throws `Host reported an invalid loopback address`),
then:

1. `authenticateWebHost(ready.url)` obtains the cookie;
2. documents are served over the privileged custom scheme `dsh-app://app/...`;
3. `forwardWebRequest(request, origin, cookie)` forwards remaining requests to the loopback origin,
   **injecting the cookie and `sec-fetch-site: same-origin`**;
4. `socketHeaders()` admits only WebSocket upgrades from the owner `webContents` with
   `origin === 'dsh-app://app'`, rewriting them to origin + cookie;
5. `boot()` returns `{ injections, streamBaseUrl: this.#ready.origin }`.

> **Evidence boundary**: `native-web-host.mjs` is readable on `main`; but the `./web-document.mjs` and
> `./eduwork-native-host-process.mjs` it imports are **not** in the `dsh-electron/src` listing, and
> `dsh-electron/scripts/native-desktop-source.mjs` rewrites only four files (`main.ts`,
> `preload-app.ts`, `microphone-permissions.ts`, `fatal-recovery.ts`) and **does not generate** those
> two modules. Combined with `dsh-electron/README.md` ("the Electron main process, windows,
> `dsh-app://` and the **streaming Host transport** derive from that commit"), the **inference** is
> that `dsh-app://` and the streaming Host transport are **DSH official desktop capabilities** rather
> than EduWork inventions. Marked **inferred**; confirm once in an environment that can run the build.

**Significance**: the remote carrier has an **in-repo precedent** — the same idea (a shell or carrier
holds the credential and forwards on the caller's behalf), with a second device's browser as the
carried subject.

### Community solution comparison

The four community projects listed in #116 plus the official connection layer, compared along the six
axes this proposal cares about. The official connection-layer column is verified in this pass; the
community column **uses the description in #116 as its source** (original: "the above projects are for
selection and architecture reference; EduWork adaptation verification is not complete") and states its
independent verification status.

| Solution | Layering and transport | Authentication and pairing | Patches the kernel | Disconnect recovery | Fit for EduWork | Independent verification |
| --- | --- | --- | --- | --- | --- | --- |
| **DSH official connection layer** | Carrier-neutral RPC + exact Fetch routes; `/api/remote.mux`; `stream-protocol` frames with native-caller parsers | Process token → authority-bound signed cookie; **single operator Peer**; **no logout** | No | Generation state machine: ready frame, jittered backoff 500 ms→10 s, 3000 ms warning / 15000 ms hard timeout | **The reuse base of this proposal** | **Verified** (in-package README and `.d.ts` on this machine's 0.2.0-rc.2) |
| `liguobao/ds-harness-remote` | Host / Client / Relay layering; ships protocol documentation and a minimal single-account self-hosted server | See its protocol documentation | No (DSH-native remote plugin) | Claims disconnect recovery | **Closest to this proposal's target shape**; key reference for layering and protocol documentation | Not independently verified (see below) |
| `zhu1090093659/dsh-web` (`dsh-remote-web-ui`) | QR pairing + mobile UI + cross-device collaboration | QR pairing | Not stated | Not stated | Reference for the **pairing flow and mobile interaction** | Not independently verified |
| `siberiah2o/dsh-plugin-remote` | Login authentication and HTTP/WebSocket reverse proxy for DSH Web | Login authentication plus proxy-layer access control | No (plugin form) | Not stated | Reference for **gateway access and access control** | Not independently verified |
| `ChongYep/DSH-Remote` | Tailscale plus a token gateway to the local DSH | Token gateway plus device authorization | **Yes** (#116: "the existing implementation includes kernel patches, so maintenance cost must be assessed") | Not stated | Reference for network access and device authorization; **kernel-patch maintenance cost must be assessed** | Not independently verified |

**Approach: reuse the design, implement it ourselves.**

The reasoning matches the calendar proposal's approach:

- No existing implementation satisfies this proposal's four hard requirements — a **versioned
  protocol**, **individually revocable device authorization**, **no expansion of remote authority**,
  and **no duplicate execution after reconnect** — while the most complete candidate's strengths
  (layering and pairing) are exactly the parts that can be "referenced for information structure and
  interaction while the code is written here".
- Adopting one directly would import its licence, version line, dependency lock and the long-term
  duty of tracking upstream. None of the four reuse mechanisms already in this repository (reference
  the design / vendor the source / fork into an independent npm package / runtime patch; see
  `docs/PACKAGES.md` and the admission-condition table in the calendar proposal) can land a built-in
  source extension under `dsh-plugins/` **without publishing a new npm package or changing the
  dependency lock**.
- If a specific module of a candidate should be cited, name it during review and we will open a
  separate proposal under that candidate's admission conditions.

#### Repository-level verification completed (2026-10-09)

The first two entries in the table above were verified at repository level via the GitHub REST API
(unauthenticated):

| Repository | Stars | Forks | Language | **Licence** | Archived | Last commit |
| --- | --- | --- | --- | --- | --- | --- |
| `liguobao/ds-harness-remote` | 283 | 29 | TypeScript | ⚠️ **none detected** | No | `6bc9c969` (2026-10-09) |
| `zhu1090093659/dsh-web` | 8,536 | 561 | TypeScript | Apache-2.0 | No | `11c22ab8` (2026-10-09) |
| `siberiah2o/dsh-plugin-remote` | — | — | — | — | — | API rate-limited during verification; **not completed** |
| `ChongYep/DSH-Remote` | — | — | — | — | — | API rate-limited during verification; **not completed** |

Two findings with practical effect on selection:

1. **`liguobao/ds-harness-remote` has no detected licence.** The repository is active (a commit on
   the day of verification, not archived), but **no identifiable licence file means its code cannot
   be reused** — only its design can be referenced. This is consistent with this proposal's
   "reuse the design, implement it ourselves" approach; if review wants to cite its code directly,
   **the licence question must be settled first**.
2. **`zhu1090093659/dsh-web` is far larger than a remote-UI plugin** (8,536 stars, roughly 1.1 GB).
   Adopting it directly would pull a dependency tree much larger than this feature into the release
   manifest, conflicting with the runtime-slimming direction (#119).

> **Verification statement**: the community column above has **not** completed per-repository
> source-level verification. Only the repository metadata listed above was verified; the
> architectural judgements (layering, authentication, disconnect recovery, kernel patches) still
> **use the description in #116 as their source** and are not source-confirmed. **The architecture
> conclusions of this proposal do not depend on that column**: they rest on the verified official
> connection-layer capabilities and the verified Peer contract. The remaining verification will be
> added during review, and **if it contradicts this document, the verification results prevail**.

## Three-layer responsibilities

```
┌──────────────────── Local host (Host) ────────────────────┐
│  Existing: session / agent / tools / workspace / credentials │
│  Existing: carrier-neutral RPC + Fetch route registries      │
│            Gateway /api/remote.mux + stream-protocol frames  │
│            API Remotes assembly manifest (which capabilities  │
│            are open to clients)                              │
│  New: remote-access host plugin                              │
│    · remote carrier (a third carrier) with its own admission │
│    · device registry (public key + scopes + state)           │
│    · pairing service (the pairing device waits for an answer)│
│    · scope fence (deny by default, endpoint allowlist)       │
│    · audit records (who, when, what — visible on the host)   │
└──────────────────────────────────────────────────────────────┘
                          │ eduwork-remote/v1
                          ▼
┌────── Relay / access service (optional, replaceable, self-hostable) ──────┐
│  Only: reachability (NAT traversal / reverse tunnel / port forwarding),    │
│        TLS termination, pairing rendezvous, presence                      │
│  Never: session content, credentials, cleartext payloads                   │
│  Implemented by institutions or developers; the public repo ships a        │
│  minimal self-hosted reference                                             │
└───────────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────── Web client (generic, bound to no school) ────────────┐
│  Reuse the existing SPA and the ctx.remote contract               │
│  Add: pairing UX, device credentials (non-extractable WebCrypto   │
│       private key), mobile browser adaptation, recovery UI        │
└───────────────────────────────────────────────────────────────────┘
```

One hard rule about the split: **the relay is optional.** With no relay (same LAN, an existing VPN,
port forwarding) the feature must remain fully usable. A relay outage therefore **does not affect the
basic usability of the host or the client** — this is the core answer to the "maintenance cost"
question.

## Protocol draft `eduwork-remote/v1`

### Handshake

```
client → Host
{ "type": "hello",
  "protocol": "eduwork-remote/v1",
  "deviceId": "<stable id of a paired device>",
  "client": { "name": "Example device", "platform": "browser|android|ios|desktop",
              "appVersion": "0.1.0" },
  "capabilities": ["stream.v1", "events.v1", "journal.v1"] }

Host → client (success)
{ "type": "welcome",
  "protocol": "eduwork-remote/v1",
  "host": { "home": "<used to abbreviate paths>", "appVersion": "0.4.2",
            "dshVersion": "0.2.0-rc.2" },
  "session": { "id": "<this remote session id>", "expiresAt": "<absolute time>" },
  "scopes": ["session:list", "session:read", "session:prompt"],
  "resume": { "supported": true, "cursorTtlMs": 600000 } }

Host → client (failure)
{ "type": "reject",
  "code": "unauthorized" | "revoked" | "version-unsupported" | "scope-empty",
  "message": "…" }
```

### Version and capability rules

- Each side declares `protocol`. **A differing major version is rejected** (`version-unsupported`)
  with **no automatic downgrade**. This matches the repository's existing stance — the gateway-auth
  proposal reads: "Unknown versions, conflicting flags or missing key capabilities must fail, and
  must not silently degrade after an authorization failure."
- `capabilities` is intersected; a client **must not** send frames for a capability the Host has not declared.
- **The data plane reuses the `dsh-api-gateway/stream-protocol` frame format**; no second format:

  ```
  Client→Host: open{streamId,endpoint,payload} | item{streamId,value?} | end{streamId} | cancel{streamId}
  Host→Client: item{streamId,value?} | error{streamId,error{code,message,details}} | end{streamId}
  ```

  v1 only wraps a handshake and scope declaration **around** them. **Do not add a version field to
  those frames** — version belongs to the handshake, and keeping the frames byte-identical to the
  browser client is what allows sharing the parsers.

### Idempotency and recovery (against the "no duplicate execution after reconnect" acceptance item)

- **One-way calls with side effects** (in v1, `session:prompt` and the like) must carry a
  client-generated `requestId`. The Host deduplicates by `(deviceId, requestId)` within a TTL:
  a repeated arrival returns **the same result** and does not produce a second user message.
- **Streams** reuse the `ctx.remote.$stream()` family: `RemoteJournalStream` provides
  follow-before-page, paging, catch-up after reconnect and gap repair, and **discards complete
  duplicates** while rejecting gaps and inverted ranges.
- Upstream fact (verified): "**One-way notifications are not replayed** … state requiring reliable
  recovery must be provided by the owner through a query, a cursor or an initial baseline."
  State synchronization must therefore be **a query surface or cursor on the Host side**, not
  replay of notifications. This is a design requirement, not an optional optimization.
- Two further upstream limits rule out replay: (a) "uplink items are **not replayed across carrier
  generations**; a domain needing uplink recovery carries its own acknowledgement cursor in the
  reopened request"; (b) `websocketHeartbeatIntervalMs` is both the Ping period and the Pong deadline,
  and deployments whose network can stall longer than that interval **must raise it**.

### Authorization scope vocabulary v1 (deny by default)

| Scope | Meaning |
| --- | --- |
| `session:list` / `session:read` | List and read sessions |
| `session:prompt` | Deliver a user message to a session (side effect; requires an idempotency key) |
| `session:cancel` | Cancel a running turn |
| `workspace:list` / `workspace:read` | List and read registered workspace files |
| `artifact:read` / `artifact:download` | Read and download Studio artifacts |
| `settings:read` | Read settings (excluding credentials) |
| `approval:respond` | Answer approval prompts. **Separate scope, not granted by default** |

**Not granted in v1**: any credential read or write, plugin install or uninstall, terminal, and
`workspace:write`.

Reasoning: #116 requires that "**remote operations continue local authority and must not expand
authorization**". Deny by default plus explicit grants is the only form that can be verified in an
implementation. `approval:respond` is listed separately because letting a remote device click
"allow" on the host's behalf is equivalent to indirect privilege escalation.

### Device pairing and identity

1. The local EduWork opens a "Remote access" panel and generates a **one-time, short-lived** pairing
   code plus the requested scope list;
2. The other device opens the access address and enters or scans the pairing code;
3. That device generates an asymmetric key pair **locally** (WebCrypto, private key non-extractable)
   and sends the **public key** plus device name and requested scopes to the Host;
4. **The Host side must be confirmed by a human on the local machine**, with the interface showing the
   device name and the scopes about to be granted;
5. Later connections authenticate by **challenge-response signature**, **not a long-lived bearer token**.

### Revocation

Deleting the device registration record completes revocation: the Host immediately closes that
device's active connections and voids its scope session.

**Why the device credential must be a second system independent of the cookie** (verified): the
existing connection layer has "**no logout operation**" — clearing the browser cookie ends one browser
session, and revoking every session requires "deleting the owner credential record and restarting
`dsh`". Using the cookie for remote authentication would **fail** the acceptance item "the connection
fails after authorization is revoked". In addition the cookie **deliberately omits `Secure`** (because
the shipped server uses loopback HTTP), and upstream already warns that "exposing the same authority
over plaintext networking can expose the bearer cookie in transit".

### Transport security boundary

- The local side keeps binding `127.0.0.1` **only**; `dsh web --host 0.0.0.0` **remains unsupported**
  and this proposal **does not relax** the loopback fence.
- The remote carrier is a **third in-process carrier**; externally it is reachable only through the
  relay or a tunnel the user builds;
- TLS is terminated by the relay, or provided by the user's own tunnel; the public edition does not
  manage public TLS certificates;
- `trustedHosts` is **not used** for remote access (verified: entries must be canonical bare
  authorities, there is **no wildcard semantics**, and non-canonical spellings fail plugin load).

## Session and file access boundary

- A remote client reaches **only** sessions returned by `session:list` and files returned by
  `workspace:list`; arbitrary path reads are not offered, so the feature cannot become a general
  local file-read surface.
- Workspace file reads follow the existing `dsh-fs` and `dsh-fs-sandbox` boundaries; **no side channel
  is opened**.
- Artifact downloads reuse the Gateway attachment and exact Fetch route machinery (including range and
  streaming responses); no separate download channel is built.
- Audit records stay on the host and are visible in the local interface; they are **not written into
  session logs**, keeping device information out of model context.

## Client boundary

- **Reuse candidate**: `dsh-web-frontend/dist`. Reason (verified): `ctx.remote` is explicitly designed
  as a **React-independent** contract, and upstream states that "Web, or a **future TUI**, can reuse
  its Client face as long as it provides the same contract".
- If reuse is blocked (for example by coupling between `dist` and the desktop shell's custom scheme),
  the fallback is a slim client depending only on the `ctx.remote` contract and the `stream-protocol`
  parsers. **The trade-off is left to review**; see [Open questions](#open-questions).
- Mobile browser adaptation: the target baseline is mainstream mobile browsers. Desktop-shell and
  `file://` / `dsh-app://` behaviour does **not** apply to the remote client and requires separate
  acceptance.

## Deployment

Four levels, **increasing in complexity with no loss of capability**:

| Level | Approach | New service required | New port | Typical link |
| --- | --- | --- | --- | --- |
| **L0 Same LAN** | Direct on one local network | None | One internal port | LAN |
| **L1 Existing VPN** ⭐ | Both the host and the remote device join a VPN the user **already has** | **None** | **None** (reuses the existing tunnel) | Determined by the user's VPN |
| **L2 Self-hosted reverse proxy** | **Append** one route on the user's existing reverse proxy pointing at the host's `127.0.0.1` | One lightweight process bound to loopback | None (reuses the existing 443) | Public internet, limited by cross-border/uplink bandwidth |
| **L3 Signalling and data separated** | L2 carries signalling only; the data path punches through directly or falls back to L1 | Same as L2 | None | Direct |

**L1 is the recommended first choice**: it deploys no new service, opens no new port, and
introduces no new compliance surface. It only requires that both ends of a VPN the user already
has can reach each other. This proposal requires the user to buy nothing.

### A relay should be split into two paths

This follows from real link constraints rather than preference:

| Path | Carries | Link requirement | Can be hosted by |
| --- | --- | --- | --- |
| **Signalling / rendezvous** | Pairing-code exchange, device public-key registration, endpoint discovery, presence | Very low (byte-scale, latency-tolerant) | Any small reverse proxy; sufficient |
| **Data plane** | Session event streams, prompts, artifact bytes | High (bandwidth and low latency) | Direct hole punching, the user's VPN, or the LAN |

**A security benefit comes for free**: when the data plane bypasses the relay, the relay
**cannot physically** see the content — more reliable than a promise not to look.

### Hard constraints on a relay implementation

- **Must be extremely lightweight**: a relay may run on a shared small host with only a few hundred
  MB of memory. It must not require a heavy runtime, must not require building on the relay host,
  and must not introduce container-orchestration dependencies.
- **Must coexist with existing services**: a relay will often share a reverse-proxy host with the
  user's other services. Access must therefore be **append-only** (adding its own route or upstream),
  and it must **not require a full reload of the reverse-proxy configuration** — a full reload drops
  routes that exist only at runtime and were never written to the configuration file. This is a
  verified pitfall on real shared hosts.
- **Deployment location and compliance belong to the deployer**: some jurisdictions require
  registration for publicly facing web services, while private VPN endpoints are exempt. The protocol
  therefore **assumes nothing about the relay's geography** and requires only that "the relay may be
  deployed wherever an institution or developer chooses, carrying the local compliance requirements
  itself".
- **The relay is untrusted**: device identity is verified **end to end** (challenge-response
  signature) rather than taken from the relay's assertion. A compromised relay must not grant
  escalation.

### How "the generic client binds to no school service" is achieved

The client knows only `eduwork-remote/v1` and one access address. It embeds **no** institution domain,
login method or service discovery; every institutional difference lives in the relay and the
institution plugin.

## Maintenance cost

| Item | Assessment |
| --- | --- |
| Kernel patches | **None.** Contrast `ChongYep/DSH-Remote`, which explicitly includes kernel patches |
| Coupling surface to DSH upgrades | The handshake layer and device registration only. Frame format, backoff policy, mux and trust fence are **all reused from upstream**, never copied |
| New dependencies | Target zero runtime dependencies (consistent with existing `dsh-plugins/`, none of which declares a runtime `dependencies`) |
| New npm packages | **None.** A built-in source extension rebuilt at assembly time |
| Relay | An **optional component**; its failure does not affect local usability |
| Licence and version-line burden | "Reuse the design, implement it ourselves" imports no third-party licence or upstream-tracking duty |

## Compatibility boundary

- Adds one independent host plugin and one new remote carrier; **does not modify** the public exports,
  configuration identifiers or data paths of existing plugins.
- **Does not modify** `BrowserAuth` or the loopback fence semantics of `api-request-trust`, and
  **does not modify** the host behaviour of `dsh web`.
- **Adds no** runtime dependency, **changes no** dependency lock, and **adds no** npm package requiring
  separate publication.
- The release manifest gains one plugin registration line, leaving the order and configuration of
  existing plugins unchanged; there is no historical data migration (first introduction).
- The only public interface requiring review is the `eduwork-remote/v1` handshake and scope vocabulary.
- Desktop and institution-edition behaviour are outside the implementation scope of this proposal;
  desktop behaviour requires separate acceptance.

## What this proposal does not do

- No new RPC protocol or frame format; no copy of the Gateway mux or backoff policy;
- No change to `BrowserAuth` or the trust fence; `--host 0.0.0.0` does not become a supported
  deployment posture;
- No school SSO or institution service discovery in the public edition;
- No second desktop shell.

## Development split and acceptance

Phases: **documents first, then skeleton, then protocol, then relay**. Every PR reports the
verification **actually performed** and what remains unverified.

1. **This proposal (documents only)**: `docs/proposals/remote-access/README.md` + `README_EN.md`.
   Run `node scripts/check-source-docs.mjs`. This PR contains no code.
2. **Skeleton plugin**: `dsh-plugins/remote-access/`, registering the "Remote access" settings panel
   and local CRUD for the device registry; pairing is exercised on the same LAN with synthetic data
   and the protocol is untouched. Acceptance: the panel works, the registry survives a restart, and
   `node --test` unit tests pass.
3. **Protocol and handshake**: handshake, version negotiation, capability intersection, scope fence,
   idempotency keys and `RemoteJournalStream` recovery. Acceptance: synthetic contract tests
   (mismatched version fails, missing capability is refused, unauthorized endpoint is rejected).
4. **Relay reference implementation**: a minimal self-hosted server, **not** in the public release
   manifest; or placed in a separate repository if review decides so.
5. **Web client**: pairing UX, device credentials, mobile browser adaptation.

**#116 acceptance concerns → verification method** (each must be reproducible by someone else):

| Acceptance item | How to verify |
| --- | --- |
| Continue the same task across devices | Device A starts a turn → device B lists and reads that session → a message is delivered from B → assert the turn continues in the same session and device A's interface reflects it live |
| Reconnect does not duplicate execution | Cut the network during `session:prompt` → after reconnect resend the same `requestId` → assert **exactly one** user message in the session |
| An unauthorized device cannot access | Run once each with no credential, a wrong credential and a wrong scope → assert rejection (401/403) **before any RPC dispatch**, with **no session or file bytes** crossing |
| The connection fails after revocation | After revocation assert the active connection closes immediately, that device's session is voided, and re-authentication fails |

Module checks follow the existing CI; real login, Office, audio/video and desktop behaviour are
accepted locally according to the change's scope. **Browser tests do not replace desktop or mobile
device acceptance.**

## Institution edition boundary

- The public edition contains no school-specific logic: no institution domain, SSO method, service
  discovery or campus network traversal implementation.
- The institution edition follows `docs/EDITIONS.md` and provides the relay and deployment adapters
  under `edition/plugins/`; the client and protocol stay generic.
- Institution lock bumps depend on a public-edition **release**: assembly in institution mode verifies
  the public commit and source receipt, so institution integration happens after the public change is
  merged and released, and is not part of this proposal.

## Open questions

These need a maintainer decision, and **phase 2 does not start before they are settled**:

- **Choice of trust boundary.** This document takes the purely peripheral route (transport fence plus
  assembly manifest), which needs no upstream change, on the basis of the Peer contract's "Who the
  Peer is and what it may do are not recorded here". If maintainers prefer DSH upstream to provide
  **multi-Peer / device identity** as a first-class capability, say so and we will propose it upstream
  instead.
- **Whether the relay belongs in the public repository**; and if so, under `packages/` (requiring npm
  publication) or as a non-shipping reference implementation under `scripts/`.
- **The end-to-end encryption algorithm, key custody and who owns rotation**; and what metadata the
  relay can see.
- **Whether the remote client reuses `dsh-web-frontend/dist`** or needs a separate slim client.
- **Whether `approval:respond` is open in v1**; and if so, what local second confirmation it needs.
- **The mobile browser target baseline** and the interactions to cover (session list, delivery,
  artifact preview, approvals).
- **Where the device registry is stored**: a `dsh-credentials` record, or a plugin-owned file.
- **Protocol naming**: whether `eduwork-remote/v1` is right, or whether it should be named as a
  DSH-level protocol.

This document does not freeze these discussion items into a released interface. Implementation, merge,
npm publication and desktop release are handled separately.
