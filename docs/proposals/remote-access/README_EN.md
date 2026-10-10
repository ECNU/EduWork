# Open Remote Access Protocol and Web Client Proposal

[简体中文](README.md) | **English**

Status: this proposal is a **draft under review and is not implemented**. The protocol name, frames,
fields, configuration keys, operation-surface split and commands below are **design intent**; they do not
represent shipped functionality or configuration that can be used as-is. Do not change production
configuration based on an unreleased proposal. Items marked **verified** come from the READMEs and
type declarations of the installed packages on this machine and can be checked line by line at the
paths given; items marked **inferred** or **to verify** have not been confirmed at source level.

Ownership: public edition (EduWork). Institution-specific services and deployment details are separate;
see [Institution edition boundary](#institution-edition-boundary).
Related: issue [#116](https://github.com/ECNU/EduWork/issues/116), roadmap [#95](https://github.com/ECNU/EduWork/issues/95).

## Confirmed direction from review

The maintainer confirmed the phase-1 shape in the
[reply on #116](https://github.com/ECNU/EduWork/issues/116) (2026-10-09). The five points below are
**confirmed constraints**, not open questions; this proposal has been revised to match them:

1. **The relay connects and forwards; business content is end-to-end encrypted.** The deployer is
   trusted, but **terminating HTTPS at the relay must not be equated with client-to-Host end-to-end
   encryption**.
2. **Pair first, then connect.** First-time trust is established through a short-lived, one-time
   invitation, **confirmed and stored by the local machine**; after pairing the device identity is
   retained, and reconnecting proves that identity and re-establishes an encrypted session
   **without scanning again**. **Per-device revocation is supported, and it must invalidate existing
   connections.**
3. **After pairing, the device acts as the owner operating the Agent.** Phase 1 **needs no separate
   read-only/operable role system**, but remote operations still obey the Agent's, session's and
   workspace's existing permissions and **do not automatically become full access**. Whether
   **host-management interfaces** such as pairing management and credential management are exposed
   must be **clearly distinguished** from operating the Agent.
4. **Plugin and Server must both be independently usable with public source.** They bind to no
   EduWork brand, school account or designated public relay; the Server **may live in its own
   repository**, and the protocol and deployment must be documented. ECNU's preconfigured relay,
   school identity and authentication come after the public baseline is complete.
5. **Abuse prevention is separate from device control.** A self-hosted Server may require an access
   Key issued by the deployer, but that Key **only means "allowed to use this relay" and cannot
   substitute for device pairing**; the one-time pairing invitation and the long-lived device
   credential **must not be conflated into a single token**. Encryption **reuses existing protocols
   and libraries** where possible.

One boundary was confirmed alongside these: **prefer zero kernel patches, but do not bend around the
security boundary just to keep the patch count at zero** — if the official interfaces do have a gap,
**list that gap separately** rather than pushing full multi-Peer capability upstream now.

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
| Operation-surface fence | Deny-by-default endpoint allowlist; remote authority strictly weaker than the local operator; the host management surface is closed by default |
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
axes this proposal cares about. The official connection-layer column is verified in this pass, and
**all four community projects have now completed source-level verification**, each against a pinned
commit, with file-and-line evidence for every conclusion. The original #116 author's description of
these projects (original: "the above projects are for selection and architecture reference; EduWork
adaptation verification is not complete") has been superseded by the verification results; **where the
two disagree, the verification conclusions below prevail**.

| Solution | Layering and transport | Authentication and pairing | Patches the kernel | Disconnect recovery | Fit for EduWork | Independent verification |
| --- | --- | --- | --- | --- | --- | --- |
| **DSH official connection layer** | Carrier-neutral RPC + exact Fetch routes; `/api/remote.mux`; `stream-protocol` frames with native-caller parsers | Process token → authority-bound signed cookie; **single operator Peer**; **no logout** | No | Generation state machine: ready frame, jittered backoff 500 ms→10 s, 3000 ms warning / 15000 ms hard timeout | **The reuse base of this proposal** | **Verified** (in-package README and `.d.ts` on this machine's 0.2.0-rc.2) |
| `liguobao/ds-harness-remote` | Three layers (Host / Client / Relay); the relay only checks the envelope and counter and then **forwards the ciphertext verbatim**, storing no ciphertext; the self-hosted server is about 422 lines configured by environment variables | **The local machine generates the X25519 key pair** (the private key never leaves it; `0o600` + atomic write); but **the peer identity is returned by the Server**, and a first connection **pins it automatically with no local human confirmation** | No (official extension points only), but it depends on several **not-fully-public interface shapes** | Yes | **The end-to-end encryption (standard Noise IK) and the IdentityStore pattern are directly borrowable**; **local pairing confirmation is entirely absent and must be implemented here**; `werift` is dead weight in a self-hosted relay-only deployment | **Source-level verification done** (pin `b2beef0c`, see below) |
| `zhu1090093659/dsh-web` (`dsh-remote-web-ui`) | Standalone DSH plugin; public internet via a Cloudflare tunnel/relay; **fetches the official Web GUI from the local loopback at runtime and injects a script**, shipping no front-end build output | QR pairing: 128-bit token, 10-minute TTL, **pairing repeatable within the window**; after pairing it issues a **long-lived cookie (`Max-Age` 365 days)** plus the host file `remote-web-ui-devices.json` (`0o600`, atomic write) | No (injected through the official `dsh.client.inject` slots) | 10 s heartbeat on mobile + refresh when the service worker reopens | Four things worth borrowing — the pairing state machine, the one-time grant pattern, the device-table persistence, and **zero-fork reuse of the official GUI**; but there is **no business encryption at all** and **revocation does not disconnect**, and both must be implemented here | **Source-level verification done** (pin `fc2f525c`, see below) |
| `siberiah2o/dsh-plugin-remote` | Three layers: plugin host half → **a separate gateway subprocess** (listening on `0.0.0.0:4080` itself) → browser half; an HTTP + WebSocket reverse proxy | **Its own accounts** (scrypt + HMAC cookie), multi-account, 7-day sessions, revocation by incrementing `sessionEpoch`; **no device concept and no pairing** | No (`dsh.bundle.patch` + `dsh.client`), but it admits `/api` has no middleware seam | Transport keep-alive plus process self-healing; **no business-level idempotency or replay protection** | **No E2E**: TLS is optional and cleartext by default; the gateway terminates TLS and **can decrypt and rewrite bodies** | **Source-level verification done** (pin `19ffcc29`, see below) |
| `ChongYep/DSH-Remote` | No proxy layer; it **modifies DSH itself**; `tailscale serve` terminates TLS and loops back to loopback, leaving DSH on `127.0.0.1` | **A single deployment-level Bearer token**, replaced whenever the script restarts; **no device concept, no pairing, no per-device revocation** | **Yes, 11 DSH source files**, with the baseline pinned to `5badb15009`; **and it rewrites upstream's security default that rejects `--host 0.0.0.0`** | Shell-level reachability probing plus a retry button; **no idempotency or deduplication** | Public mode: WireGuard + real-certificate TLS as **two layers**, explicitly rejecting a relay that would decrypt; LAN mode: cleartext HTTP | **Source-level verification done** (pin `edf350e1`, see below) |

**Approach: prefer reuse, and do not presume a from-scratch implementation; where direct reuse is
impossible, fall back to "reuse the design, implement it ourselves".**

Maintainer review comment: "**evaluate the first two first; for now do not presume a from-scratch
implementation**". On that basis the earlier blanket "implement everything ourselves" is relaxed into a
case-by-case decision:

| Disposition | Applies when | Current candidates |
| --- | --- | --- |
| **Reuse the source directly** | The licence clearly permits it, the dependencies are acceptable, no kernel patch is introduced, and the security semantics meet the hard requirements | **Nothing qualifies after this round of verification**: each candidate has a hard defect (see the next two sections), so no source is reused directly for now |
| **Adapt, then reuse** | The upstream interaction direction is right, but the security boundary does not hold | `dsh-remote-web-ui`'s pairing (must become one-time) and revocation (must actively disconnect) |
| **Reuse the design, implement it ourselves** | The licence is unclear, the dependencies are too heavy, or the security semantics fundamentally do not hold | `ds-harness-remote`'s **Noise IK wrapper, IdentityStore pattern and minimal relay forwarding**; `dsh-remote-web-ui`'s pairing state machine, device-table persistence and zero-fork reuse of the official GUI |

Constraints that still hold:

- No off-the-shelf implementation fully satisfies this proposal's four hard requirements — a
  **versioned protocol**, **individually revocable device authorization**, **no expansion of remote
  authority**, and **no duplicate execution after reconnect**; the verified `dsh-remote-web-ui`
  clearly falls short on the latter two.
- Adopting one directly would import its licence, version line, dependency lock and the long-term
  duty of tracking upstream. None of the four reuse mechanisms already in this repository (reference
  the design / vendor the source / fork into an independent npm package / runtime patch; see
  `docs/PACKAGES.md`) can land a built-in source extension under `dsh-plugins/` **without publishing a
  new npm package or changing the dependency lock**.
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

1. **`liguobao/ds-harness-remote` has a split licence status.** The repository **genuinely has no
   LICENSE file at its root** (GitHub therefore detects none, and `/license` returns 404), but a
   `packages/plugin/LICENSE` (**MIT**) and an `apps/vscode/LICENSE` do exist inside it, and the root
   `package.json`'s `files` field **explicitly includes** `"packages/plugin/LICENSE"`.
   In other words: **the published npm tarball carries MIT text, the GitHub page carries none**.
   Strictly speaking, **the npm package is MIT while the legal status of the GitHub repository itself
   is unclear**. If review wants to cite its source directly, we suggest asking the author to add a
   LICENSE **at the repository root** so the two agree; until that is done it is handled as "reference
   the design, do not copy the code".
2. **`zhu1090093659/dsh-web` is far larger than a remote-UI plugin** (8,536 stars, roughly 1.1 GB).
   Adopting it directly would pull a dependency tree much larger than this feature into the release
   manifest, conflicting with the runtime-slimming direction (#119).

#### `dsh-remote-web-ui` source-level verification conclusions (pin `fc2f525c`)

The maintainer called out three points in review, and **all three hold once checked one by one**:

1. **There is no business-content encryption at all.** Nothing in `src/` calls `createCipheriv` /
   `crypto.subtle` / nacl / AES. Its README describes the relay as one that **forwards request bytes
   verbatim**, and openly acknowledges that "the relayed traffic passes infrastructure operated by the
   package author on Cloudflare's edge, so **the author's worker can observe it**".
   That is, **TLS ends at the relay and the relay sees application-layer content in cleartext** — it
   does not meet this proposal's end-to-end encryption hard requirement.
   One further detail: the WebSocket device credential rides the **query string**, so the origin access
   log, the relay and the Cloudflare edge all see a URL that authenticates as that device.
2. **Revocation is per-request and does not cut established long-lived connections.** Its README reads:
   "**Revocation is per-request**: a paired device whose request is already in flight when 停止 lands
   completes that request; the next one 403s." Gating is **decided at the entrance only** (one place at
   the HTTP entrance, one at the WS upgrade), and there is no "revocation closes the socket" path
   anywhere in the repository — an admitted WebSocket / EventSource survives until the peer closes it.
3. **The revocation boundary does not cover direct calls to the official `/api`.** Its code notes
   "NOTHING emits api/gate in the official runtime" and prints the warning "stop() does not revoke an
   already-redeemed browser credential". In other words revocation binds only the plugin's own
   `/remote` channel and the pairing cookie; **the harness browser credential the device redeemed
   earlier is unaffected** (it expires naturally after 30 days). Treating it as a global kick-offline
   leaves an entrance that nobody governs.

**What is worth borrowing** (the quality is good; implementing along these lines is worthwhile):

- The pairing state machine is plain TS with an injected clock and randomness, so **its security
  semantics are unit-testable**;
- The landing-page grant gets real one-time behaviour out of **delete-before-validate** — a one-time
  pairing invitation can be written the same way;
- The device table is persisted with `{ mode: 0o600 }` plus an atomic rename, and a revocation whose
  write fails deletes the store;
- **It ships no official front-end build output**; instead it fetches the official index from the local
  loopback at runtime and injects a script, in its own words:
  "The QR link is the official Web GUI itself ... so **the remote surface can never drift from the
  official one**." — this is the **zero-fork** route, more stable than this proposal's earlier idea of
  "reusing `dsh-web-frontend/dist`": it cannot fork when the official front end is upgraded. **Adopted
  as the first choice for the client boundary** (see [Client boundary](#client-boundary)).

#### `ds-harness-remote` source-level verification conclusions (pin `b2beef0c`)

**It is the only one of the four candidates that genuinely implements end-to-end encryption**, and that
layer is worth adopting:

- **Standard Noise IK**: `Noise_IK_25519_ChaChaPoly_SHA256`, wrapping a **maintained third-party
  implementation** (`@lukeburns/clatterjs`), with **no handshake state machine written here**; a suite
  name mismatch throws.
- **Static public-key pinning**: the remote static public key is locked at construction time and
  **compared in constant time** after every read and write; a mismatch destroys the session.
- **Prologue binding context**: `DSH-REMOTE\0v=1\0connection=…\0host=…\0client=…`, preventing
  cross-connection or cross-device transplant.
- **The relay genuinely cannot see content**: the relay only checks that `counter` increases and then
  **forwards the ciphertext verbatim**; the forwarded payload fields are only
  `connectionId / targetDeviceId / counter / ciphertext`. What the relay can see is the account, the
  deviceId, the role, the display name, the **public identity key**, presence, connection time, frame
  sizes and direction timing; it **cannot see** prompts, sessions, tool input and output, workspace
  paths or private keys.

**But its root of trust sits on the Server side — exactly what #116 wants changed:**

- The private key really is generated locally and never uploaded, but **the peer identity is returned
  by the Server**: `handleConnectIncoming` first queries the Server for the peer descriptor and then
  writes the local pinned trust from it.
- **The first connection writes the pin directly, with no local human confirmation at all.** Its
  documentation states this flatly: "there is no additional device code, confirmation event or local
  human-confirmation UI". So "local trust" is really **automatic trust in the Server's assertion** — a
  Server that returns a forged descriptor on the first connection can MITM.
- **The work to turn this into local pairing authorization is small-to-moderate (roughly 150–300 lines
  plus one confirmation interface), but it has one genuine difficulty** — its `connectionId` **is
  generated by the Server** and enters the Noise prologue. Making authorization fully independent of
  the Server requires reworking that layer as well (generating it locally and passing it out of band);
  otherwise "automatic trust" merely becomes "click confirm in the interface" and **the security
  property is unchanged**.
- Conclusion: **its encryption layer is worth borrowing; its authorization layer cannot be copied.**

**Other facts to note:**

- **It does not patch the kernel**, but its integration **depends on several not-fully-public interface
  shapes**: `ctx.loader.entries()`, the settings two-generation `register` / `configure` split, and
  `webServer` and `typertGateway` obtained through type assertions. These are the main breakages when
  following DSH upgrades; this proposal should adopt a more conservative injection style.
- The default `serverUrl` value `https://dsh.r2049.cn` is a **configurable default, not hard-coded**;
  but **changing the URL switches the device identity directory** (isolated by a hash of the server
  origin), which amounts to needing to pair again.
- Its relay reference implementation is small (about 422 lines, environment-variable configuration, no
  ciphertext stored), but the self-hosted shape is **relay-only** (`webrtcEnabled: false`, no TURN
  endpoint), so the WebRTC direct path is unusable in a self-deployment.
- `werift` (pinned to an exact version) is the Host-side WebRTC implementation, lazily loaded; in a
  relay-only self-deployment it is **dead weight**, and it is the main source of the 1.56 MB bundle.
  **This proposal does not pull it in.**

#### `dsh-plugin-remote` and `DSH-Remote` source-level verification conclusions (pin `19ffcc29` / `edf350e1`)

**Both projects have only a "single shared credential" and neither has a device concept — which is
exactly the gap #116 wants filled.**

| | `siberiah2o/dsh-plugin-remote` | `ChongYep/DSH-Remote` |
| --- | --- | --- |
| Layering | Three layers: plugin host half → **a separate gateway subprocess** (listening on `0.0.0.0:4080` itself) → browser half; an HTTP + WebSocket reverse proxy | No proxy layer; it **modifies DSH itself**; on the public internet `tailscale serve` terminates TLS and loops back to loopback |
| Authentication | **Its own accounts** (scrypt + HMAC cookie), multi-account, 7-day sessions, revocation by incrementing `sessionEpoch` | **A single deployment-level Bearer token**, replaced with a new token whenever the script restarts |
| Device concept / pairing | **None** | **None** |
| Kernel patches | **None** (`dsh.bundle.patch` + `dsh.client`) | **Yes, 11 DSH source files**, with the baseline pinned to `5badb15009` |
| Business-level idempotency / replay protection | **None** (transport keep-alive plus process self-healing only) | **None** (shell-level reachability probing plus a retry button only) |
| End-to-end encryption | **None.** TLS is optional and needs a PEM you supply; cleartext by default. The gateway terminates TLS and **can decrypt and rewrite bodies** | Public mode: WireGuard + real-certificate TLS as **two layers**; LAN mode: cleartext HTTP |
| Licence | **No LICENSE** at the root (the README and `package.json` claim MIT) | Root **MIT** ✓ |

**Parts worth borrowing**

- `dsh-plugin-remote`: the **RFC6455 server** in `gateway/websocket.mjs` (its own, pulling in no
  dependency), the **scrypt + HMAC + `sessionEpoch` revocation + rate limiting** in `gateway/server.mjs`,
  and the **subprocess supervision** in `lib/index.js` (health polling / backoff / orphan reaping).
- `DSH-Remote`: the added `packages/client/connection/src/web-token.ts` — **three ways to carry the same
  token** (`Authorization` header / WebSocket subprotocol / `?token=` exchanged for a cookie) plus
  `timingSafeEqual` — is a ready-made reference for "validate at the DSH admission point".
- The least-effort route at the deployment layer: **`tailscale serve` + loopback** (opens no public
  port, renews real certificates automatically).

**Why they cannot replace this proposal**

- `dsh-plugin-remote` itself admits `/api` has **no middleware seam** to occupy (`lib/index.js`), so it
  can only put a layer in front; and its gateway **can decrypt and rewrite bodies**, which shows that it
  is merely an application-layer proxy and that **the remote browser still does not obtain the DSH
  credential**.
- Neither has **device identity**, so "pair first, then connect" and "per-device revocation" **must be
  built here**.
- `DSH-Remote`'s 11 patches are **all on DSH internal paths and pinned to a single baseline**, so an
  upgrade conflicts immediately; it also **rewrites upstream's security default that rejects
  `--host 0.0.0.0`** — precisely the reason for "prefer zero kernel patches".

**⚠️ A pitfall that directly affects this proposal's client route**

`dsh-plugin-remote` injects a script **in place into the reverse proxy's HTML response**. But the DSH web
profile **enables gzip by default** — in the package installed on this machine,
`@deepseek-ai/dsh-web-app/cordis.patch.yml` lines 175–177:

```yaml
compression: gzip
compressionLevel: 1
compressionThresholdBytes: 1024
```

**Rewriting in place corrupts a compressed body.** This proposal's client route is therefore
"**fetch the official index from the local loopback in full, decompress it, inject on our own server
side, and then serve it ourselves**", and **not** rewriting the response on the reverse-proxy path. This
is recorded under [Client boundary](#client-boundary).

> **Verification statement**: in the community column of the table above, **all four rows have completed
> source-level verification**, each against a pinned commit (`fc2f525c` / `b2beef0c` / `19ffcc29` /
> `edf350e1`), with file-and-line evidence for every conclusion. None of the four projects was
> **actually run**; the conclusions come from source and documentation and are **not end-to-end
> measurements**; **if later measurements disagree, the measurements prevail**.

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
│    · device registry (public key + surfaces + state)         │
│    · pairing service (the pairing device waits for an answer)│
│    · operation-surface fence (deny by default, allowlist)    │
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

The handshake has **two layers**: first a Noise IK encrypted channel is established between the device
and the Host, and **inside that channel** this application's protocol is negotiated. The
application-layer `hello` / `welcome` **travel only inside the encrypted channel**, and the relay never
sees them.

#### Layer 1: the encrypted channel

- **Suite `Noise_IK_25519_ChaChaPoly_SHA256`**, **wrapping a maintained mature implementation rather
  than writing a handshake state machine here** (the approach `ds-harness-remote` takes; verified: it
  wraps a third-party Noise library and validates the suite name).
- **Static public-key pinning**: each end locks the peer's static public key and does a
  **constant-time comparison** after every read and write; a mismatch destroys the session.
- **The `prologue` binds context**, containing at least the protocol version, the `connectionId` and
  both `deviceId`s, preventing cross-connection or cross-device transplant.
- **The session key is re-negotiated on every connection**; no state from the previous connection is
  reused.

> **The key difference from `ds-harness-remote`**: its `connectionId` **is generated by the Server** and
> enters the prologue. This proposal requires the `connectionId` to be **generated by the Host and
> passed out of band (in the pairing invitation)** — otherwise authorization still rests on the
> Server's assertion, and "the local machine decides authorization" is empty.
> This is the **fundamental divide** between this proposal and that one; see
> [Device pairing and identity](#device-pairing-and-identity).

#### Layer 2: application-layer negotiation

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
  "surfaces": { "agent": ["session:list", "session:read", "session:prompt"],
                "host": [] },
  "resume": { "supported": true, "cursorTtlMs": 600000 } }

Host → client (failure)
{ "type": "reject",
  "code": "unauthorized" | "revoked" | "version-unsupported" | "surface-empty",
  "message": "…" }
```

`surfaces.host` defaults to an **empty array** (the host management surface is closed by default); see
[Operation-surface split v1](#operation-surface-split-v1-deny-by-default).

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

  v1 only wraps a handshake and operation-surface declaration **around** them. **Do not add a version field to
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

### Operation-surface split v1 (deny by default)

**Phase 1 introduces no read-only/operable role system** (confirmed by the maintainer). After a
successful pairing the device **acts as the owner operating the Agent**; but "acts as the owner"
**does not** mean "can do everything" — remote operations **continue the existing permissions of
that Agent, session and workspace** and **do not automatically become full access**. Splitting the
operation surface into the two classes below is how that requirement becomes verifiable in code.

| Class | Contents | v1 default |
| --- | --- | --- |
| **Agent operation surface** | List/read sessions, deliver user messages (side effect; needs an idempotency key), cancel turns, list/read registered workspace files, read and download Studio artifacts, read settings (excluding credentials) | Available after pairing, **but still bounded by the existing Agent/session/workspace permissions** |
| **Host management surface** | Pairing and device management, credential read/write, plugin install/uninstall, terminal, `workspace:write`, settings writes | **Closed by default**; whether phase 1 opens any of it needs a separate decision |

**Why the host management surface must be listed separately** (confirmed by the maintainer): pairing
management and credential management are **host-management interfaces**, and they are a different
thing from "operating the Agent" — the former governs **who may connect at all**, the latter governs
**what a connected device may do**. Folding both into one authorization means "can chat" silently
implies "can change who may connect".

`approval:respond` (answering approval prompts) is likewise listed on its own: letting a remote
device click "allow" on the host's behalf is equivalent to indirect privilege escalation, so it is
**separate and not granted by default**.

Reasoning: #116 requires that "**remote operations continue local authority and must not expand
authorization**". Deny by default plus explicit grants is the only form that can be verified in an
implementation.

### Device pairing and identity

**Pair first, then connect** (confirmed by the maintainer). The four credentials below **must stay
independent and must not be conflated into a single token**:

| Credential | Purpose | Lifetime | Can it substitute for pairing |
| --- | --- | --- | --- |
| **Relay access Key** | Means "allowed to use this relay"; issued by the relay deployer | Managed by the deployer | ❌ **No.** It only addresses abuse; it does not mean the device is trusted |
| **One-time pairing invitation** | The ticket for establishing first-time device trust | **Short-lived; invalidated on first use** | It *is* the pairing entry point |
| **Long-lived device credential** | Proves "still the same device" after pairing | Long-lived; **per-device revocable** | It is the *result* of pairing |
| **Session key** | Business encryption key for one connection | One connection | Re-negotiated on every reconnect |

Flow:

1. The local EduWork opens a "Remote access" panel and generates a **one-time, short-lived**
   pairing invitation;
2. The other device opens the access address and enters or scans that invitation;
3. That device generates an asymmetric key pair **locally** (WebCrypto, private key non-extractable)
   and sends the **public key** plus device name to the Host;
4. **The Host side must be confirmed by a human on the local machine**, with the interface showing the
   device name and the operation surface about to be granted — **device authorization is decided by
   the machine running the Agent**, not relayed by the server;
5. Pairing issues a **long-lived device credential**; reconnecting afterwards **needs no scanning**:
   identity is proven by **challenge-response signature** and the **session key is re-negotiated**;
   **no long-lived bearer token** is used.

**"One-time" is deliberate**: if an invitation can be reused within its window, then **anyone who
obtains it can become a new device**. Invalidating it on first use narrows the consequence of a leak
to "once, and only by beating the real device to it".

### Revocation

Revoking a device means **its currently live connections die immediately**, not merely that its next
request is refused. Two actions must take effect together:

1. **Refuse new requests**: the device's long-lived credential is voided at once, and later
   challenge-response attempts never pass;
2. **Cut established connections**: the Host actively closes every active connection for that device,
   voids the corresponding session keys, and has the relay disconnect in step.

> The maintainer singled this out in review: the revocation boundary "**must not only be verified as
> new requests being rejected**". An implementation doing only (1) **fails** the acceptance item
> "the connection fails after authorization is revoked" — an established long-lived connection can
> keep receiving events and keep delivering messages.

**Why the device credential must be a second system independent of the cookie** (verified): the
existing connection layer has "**no logout operation**" — clearing the browser cookie ends one browser
session, and revoking every session requires "deleting the owner credential record and restarting
`dsh`". Using the cookie for remote authentication would **fail** the acceptance item "the connection
fails after authorization is revoked". In addition the cookie **deliberately omits `Secure`** (because
the shipped server uses loopback HTTP), and upstream already warns that "exposing the same authority
over plaintext networking can expose the bearer cookie in transit".

### Transport security boundary

**The relay only connects and forwards; business content is end-to-end encrypted** (confirmed by the
maintainer as a hard requirement).

- **End-to-end encryption is a layer independent of TLS.** When TLS terminates at the relay, the relay
  holds plaintext business traffic — **"HTTPS as far as the relay" is not end-to-end encryption**, and
  neither substitutes for the other.
- **The only encryption endpoints are the device and the Host.** Even a compromised relay, or one
  operated by someone else, sees **connection metadata only** (who connected to whom, when, how many
  bytes, for how long) — never prompts, replies, file contents or artifact bytes. This is an
  **architectural guarantee**, not a promise not to look.
- **Candidate handshake: Noise IK** (the approach `ds-harness-remote` already uses; see
  [Community solution comparison](#community-solution-comparison)), or another reviewed mature
  implementation with the same properties. **Reuse existing protocols and libraries; do not invent
  cryptography.**
- This must ship together with: **static key generation, custody and pinning**, **key rotation**,
  **independent keys per device**, and **destruction of the relevant key material when a device is
  revoked**.
- The local side keeps binding `127.0.0.1` **only**; `dsh web --host 0.0.0.0` **remains unsupported**
  and this proposal **does not relax** the loopback fence.
- The remote carrier is a **third in-process carrier**; externally it is reachable only through the
  relay or a tunnel the user builds;
- The public edition does not manage public TLS certificates;
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

- **First choice: reuse the official Web GUI with zero fork.** The verified `dsh-remote-web-ui` shows a
  route more stable than packaging the build output — **fetch the official index document from the
  local loopback at runtime and inject a bootstrap script**; the remote surface is therefore **always
  the official one**, and it does not fork when the official front end is upgraded. In its own words:
  "The QR link is the official Web GUI itself ... so **the remote surface can never drift from the
  official one**." This beats this proposal's earlier idea of "reusing `dsh-web-frontend/dist` by
  packaging it": packaging drifts in version as the official front end is upgraded.
- **The implementation must bypass gzip** (verified in the package installed on this machine): the
  official web profile **enables gzip by default** — `@deepseek-ai/dsh-web-app/cordis.patch.yml` lines
  175–177 are `compression: gzip` / `compressionLevel: 1` / `compressionThresholdBytes: 1024`.
  The verified `dsh-plugin-remote` injects **in place on the reverse-proxy path**, and that route is
  broken by a compressed body. This proposal therefore does the following: **fetch the official index in
  full, decompress it, inject on our own server side, and then serve it ourselves**, **without rewriting
  the response on the reverse-proxy path**.
- **The basis for reusability** (verified): `ctx.remote` is explicitly designed as a
  **React-independent** contract, and upstream also states that "Web, or a **future TUI**, can reuse its
  Client face as long as it provides the same contract".
- **Fallback**: if runtime fetching is not feasible (for example the official index has no injection
  point in the target version), fall back to building a slim client depending only on the `ctx.remote`
  contract and the `stream-protocol` parsers. **The final trade-off is left to review**; see
  [Open questions](#open-questions).
- Mobile browser adaptation: the target baseline is mainstream mobile browsers; desktop-shell and
  `file://` / `dsh-app://` behaviour does **not** apply to the remote client and requires separate
  acceptance. The verified adaptation trigger is a useful reference: portrait orientation +
  `pointer: coarse` + viewport width < 1100px.
- **Known fragility (accepted by taking this route)**:
  - Its adapter layer locates elements with the official CSS Modules' **semantic suffix selectors**, so
    an official rename of a semantic class name breaks it, and **every official GUI upgrade needs a
    visual regression pass**;
  - Injection rests on the premise that "the official index can be fetched and decompressed in full" —
    if the official side later switches to streaming compression, or moves the bootstrap point out of
    the HTML document, injection stops working. In that case, fall back to the standalone slim client
    (above).

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
  signature) rather than taken from the relay's assertion. Business content is end-to-end encrypted, so
  the relay **sees connection metadata only**. A compromised relay must lead to neither escalation of
  authority nor disclosure of content.
- **No binding to a brand, an account or a public relay** (confirmed by the maintainer): anyone may
  self-host a relay; it binds to no EduWork brand and no school account, and no single public relay is
  designated; the protocol and deployment must be documented. **The relay Server may live in its own
  repository**, outside this repository's release manifest.
- **The access Key is for abuse prevention only** (confirmed by the maintainer): a self-hosted relay may
  require an access Key issued by the deployer in order to keep out unauthorized access, but that Key
  **only means "allowed to use this relay" and cannot substitute for device pairing**. It, the one-time
  pairing invitation and the long-lived device credential are **three different things** (see
  [Device pairing and identity](#device-pairing-and-identity)).

### How "the generic client binds to no school service" is achieved

The client knows only `eduwork-remote/v1` and one access address. It embeds **no** institution domain,
login method or service discovery; every institutional difference lives in the relay and the
institution plugin.

This is also a hard requirement `CONTRIBUTING.md` places on the public edition. Item by item:

| Requirement | How this proposal satisfies it |
| --- | --- |
| **No dependency on institution credentials** | The generic plugin reads and requires no institution identity or token; device credentials are created and held by the user on their own machine |
| **No dependency on a private network** | The relay is an **optional component**; same-LAN, a user's own VPN and port forwarding must all work **without a relay** |
| **No dependency on an adjacent source repository** | Everything lives in this repository's `dsh-plugins/`, referencing neither EduWork-ECNU nor any external repository |

User-owned infrastructure (VPN, reverse proxy, server) is a **deployment choice on the user's side**,
not a dependency of the public product: public code paths **must not probe, assume or require** the
existence of any particular external service.

## Maintenance cost

| Item | Assessment |
| --- | --- |
| Kernel patches | **Prefer zero, but it is not a hard constraint** (confirmed by the maintainer). The comparison table shows `ChongYep/DSH-Remote` explicitly includes kernel patches; this proposal aims to work through official plugin interfaces and connection-layer extension points, and **if an interface gap does exist, that gap is listed and discussed separately**, rather than bending around the security boundary to make the patch count zero |
| Separate repository | The relay Server **may live in its own repository**, outside this repository's release manifest; plugin and Server are both independently usable with public source |
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
- **Adds no** runtime dependency and **changes no** dependency lock. **Whether a separately published
  npm package is added depends on the plugin-layout conclusion** (see [Open questions](#open-questions)):
  under `packages/` it adds an independent npm package and carries its version, peer range and
  provenance publication flow; under `dsh-plugins/` it is rebuilt at assembly time as a built-in source
  extension and adds no npm package.
- If it goes under `dsh-plugins/`: the release manifest gains one plugin registration line, leaving the
  order and configuration of existing plugins unchanged; neither layout involves historical data
  migration (first introduction).
- The only public interface requiring review is the `eduwork-remote/v1` handshake and operation-surface
  split.
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
3. **Pairing and authorization**: one-time invitation (**delete-before-validate**), local confirmation
   interface, long-lived device credential, challenge-response, and **actively disconnecting
   established connections on revocation**.
   Acceptance: unit tests cover the invitation being non-replayable; after revocation the **active
   connection is closed**, not merely new requests refused.
4. **End-to-end encryption**: handshake selection, static key generation/custody/pinning, session key
   negotiation and rotation, destruction of the relevant key material after revocation.
   Acceptance: synthetic contract tests + **a relay-side assertion that no business plaintext is
   visible**.
5. **Protocol and recovery**: version negotiation, capability intersection, operation-surface fence,
   idempotency keys and `RemoteJournalStream` recovery.
   Acceptance: synthetic contract tests (mismatched version fails, missing capability is refused,
   unauthorized endpoint is rejected).
6. **Relay reference implementation**: a minimal self-hosted server, **not** in the public release
   manifest; may live in a separate repository; **the access Key is strictly separated from device
   pairing**.
7. **Web client**: pairing UX, device credentials, mobile browser adaptation.

**#116 acceptance concerns → verification method** (each must be reproducible by someone else):

| Acceptance item | How to verify |
| --- | --- |
| Continue the same task across devices | Device A starts a turn → device B lists and reads that session → a message is delivered from B → assert the turn continues in the same session and device A's interface reflects it live |
| Reconnect does not duplicate execution | Cut the network while delivery is in progress → after reconnect resend the same `requestId` → assert **exactly one** user message in the session |
| An unauthorized device cannot access | Run once each with no credential, a wrong credential and an unpaired device → assert rejection (401/403) **before any RPC dispatch**, with **no session or file bytes** crossing |
| The connection fails after revocation | Revoke the device → assert the **established long-lived connection is closed immediately** (WebSocket and stream subscriptions stop receiving events), that device's session is voided, and re-authentication fails. **Asserting only that "new requests are rejected" does not pass** |
| The invitation cannot be replayed | Pair a second time with the same pairing invitation → assert the second attempt fails, and that the failure happens in **validation**, not merely in an interface prompt |
| The relay cannot see content | Capture the forwarded bytes on the relay side → assert they are ciphertext and connection metadata only, **containing no prompts, replies or file contents** |
| Remote access does not expand authorization | The remote end attempts the host management surface (credential read/write, plugin install/uninstall, terminal, `workspace:write`) → assert rejection; remote operations remain bounded by the existing Agent/session/workspace permissions |

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

**The trust boundary has been decided by the maintainer** (see
[Confirmed direction from review](#confirmed-direction-from-review)); the remaining items below do not
enter phase 2 before the document is final.

**Confirmed; no longer up for debate:**

- ~~Choice of trust boundary~~ → **confirmed**: an independent DSH plugin + web client + a self-hostable
  relay Server, reusing the official connection layer and plugin interfaces; where an interface gap
  genuinely exists it is listed and discussed separately, without bending around the security boundary
  to keep the change at "zero".
- ~~Whether the relay belongs in the public repository~~ → **confirmed**: the relay Server **may live in
  its own repository**.

**Still to be settled:**

- **Whether the plugin source lives under `packages/` or under `dsh-plugins/`.** The maintainer requires
  that "the plugin and the Server must both be **independently usable**, with public source", and
  `docs/PACKAGES.md` describes `packages/` as "**a plugin can be used by other DSH applications on its
  own, without installing the EduWork desktop**" — matching that requirement word for word, whereas
  `dsh-plugins/` is a **built-in source extension rebuilt at assembly time** and is not published
  separately. The recent precedent `#113` (calendar) put its new plugin under `dsh-plugins/`.
  The trade-off: `packages/` better satisfies "independently usable", but adds an npm package that must
  be published separately and carries the maintenance of its version, peer range and provenance
  publication flow; `dsh-plugins/` costs less, but **cannot be installed into other DSH applications
  through npm**. **This document is written for `dsh-plugins/` for now (following the `#113` precedent);
  review should decide.**
- **Who owns static key custody and rotation**, and **the rekey policy for long-lived connections** —
  the algorithm is settled as **Noise IK** (see [Handshake](#handshake)), but the key lifecycle is still
  open. For reference, `ds-harness-remote` likewise lists "long-lived connection rekey and an
  independent cryptographic security review" as unfinished roadmap items.
- **How the `connectionId` is generated and passed**: settled as "generated by the Host and passed out
  of band in the pairing invitation", but the exact encoding and validation remain to be finalised.
- ~~Evaluation conclusions for the two priority candidates~~ → **completed**: the two source-level
  verification sections are in [Community solution comparison](#community-solution-comparison).
  Conclusion: **neither can have its source reused directly** (one lacks a root LICENSE and its
  authorization layer depends on the Server; the other has no encryption and its revocation is
  incomplete), but each has modules worth borrowing.
- **A feasibility test of zero-fork reuse of the official GUI**: the first choice has become "fetch the
  official index from the local loopback at runtime + inject a script" (see
  [Client boundary](#client-boundary)), but **whether the injection point exists in the target DSH
  version needs to be tested**; if it does not, fall back to building a standalone slim client depending
  only on the `ctx.remote` contract.
- **Whether the host management surface is open in v1** (pairing management, credential management and
  so on), and if so what local second confirmation it needs.
- **Whether `approval:respond` is open in v1**; and if so, what local second confirmation it needs.
- **The mobile browser target baseline** and the interactions to cover (session list, delivery,
  artifact preview, approvals).
- **Where the device registry is stored**: a `dsh-credentials` record, or a plugin-owned file.
- **Protocol naming**: whether `eduwork-remote/v1` is right, or whether it should be named as a
  DSH-level protocol.

This document does not freeze these discussion items into a released interface. Implementation, merge,
npm publication and desktop release are handled separately.
