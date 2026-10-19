# Changelog

[简体中文](CHANGELOG.md) | **English**

Notable changes to this package. The project uses semantic versioning; for pre-1.0 compatibility, see the version section of the [protocol document](docs/protocol.md).

## 0.1.0-dev — unreleased

This package is **not published to npm** and is not part of a public release. This section records what it currently contains and where it stands; it is not release-note copy. Release notes are written after the maintainers confirm them.

**Implemented**

- Device registry, per-device credentials, per-device revocation, and live-connection management. The Host identity is persisted in `ctx.credentials` instead of being regenerated on every boot. The local admin page (loopback, per-boot token) lists/confirms/revokes/removes devices.
- End-to-end channel: P-256 ECDSA plus ECDH handshake, direction-specific AES-GCM frames, strictly increasing sequences; unauthenticated/out-of-order frames are dropped. Both the Host and the device serialize their inbound and outbound paths.
- Self-hosted relay: `/host` registration and hostId binding, `/peer` device attach, same-key reconnect replacing the old connection, one device per Host, static web shell and `/plugins` combo serving, bootstrap injection; the relay forwards ciphertext only. Registration uses the `eduwork-relay/2` proof of possession (a signature over nonce+hostId+publicKey); a failed verification cannot replace an existing Host.
- Session isolation and idempotency: asynchronous responses, stream events, and send queues are bound to the originating session, and a late frame from a disconnected device is dropped. The Host deduplicates successful side effects by `(deviceId, requestId, endpoint, payload)` and joins concurrent requests with the same key.
- DSH 0.2.1 integration: the official owner `Peer` (`browserPeer`/`operator`) is passed to `wireStream.open` and the shared fetch handler; response envelopes are decoded strictly from the public contract instead of reading a private client bundle path.
- Newly confirmed devices get `session:create` by default, but it accepts only a registered workspace's `workspaceId` and refuses a raw `cwd`; the remote UI can create its first session, and a raw socket reset before the WebSocket upgrade no longer terminates the relay process.
- Logical streams: `$events`, `workspace/follow`, `session/control`, and `session/follow` share the sealed channel with unary calls; the workspace list, session history, and streamed events work.
- Gate wired: `OPERATION_TABLE` in `gate.js` is the only authorization table; `channel/operations.js` maps Host endpoints. The Agent surface admits session/workspace/artifact/settings reads plus prompt/cancel/create; the Host surface has a code-level allowlist for `directory:list` and `workspace:create` only.
- Web-shell reuse: the Host exports its rendered index, injection rows, and `/plugins` combos with an in-process cookie; the relay mirrors them; the remote browser runs the Host's own UI.
- In-app directory browsing composition (`dsh-host-directory-picker-browse` + `dsh-client-ui-directory-picker-browse`) for remote workspace selection; the local machine also gets the same dialog (a known limitation).
- 321 package tests; protocol-level device acceptance and desktop-browser plus real-phone (Wi-Fi) acceptance pass.

**Unfinished / known limitations**

- The real one-time invite flow is not wired; the current flow is pending+confirm.
- No relay access key: knowing the hostId only allows a connection attempt and still requires Host confirmation.
- Approval/question end-to-end acceptance is missing (the control stream is admitted).
- The local native directory dialog is not restored; the composition change affects local UX.
- iOS backgrounding suspends the WebSocket; the current version needs a manual reload. Automatic reconnect is a follow-up.
- One device per Host at a time.
- The relay can replace the bootstrap it serves; deployer trust is a precondition.
- For a non-loopback browser the preview notice's acknowledgement stays in process memory and reappears after a refresh.

**Release notes**

`0.1.0-dev` is not a release. npm publication, product dependency locks, desktop Releases, and institutional deployment are approved separately; version numbers and release notes are confirmed by the maintainers.
