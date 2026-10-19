# @eduwork/dsh-remote-access

English | [中文](README.md)

Lets **another device** view and continue the workspaces, sessions, and tasks of a local EduWork/DSH Agent through a browser, across networks.

This package is a **DSH plugin** with a self-hostable **relay** and a **device bootstrap**: the Host and the device communicate end to end, the relay forwards handshake metadata and sealed business frames and never holds the Host's launch credential, and the remote browser loads the **Web UI the Host renders itself** rather than a separate client.

> Status: prototype (`0.1.0-dev`, not published to npm). It has passed 314 package tests, protocol-level device acceptance, and a desktop browser plus a real phone on Wi-Fi. The real invite flow, the relay access key, end-to-end approvals/questions, and iOS background reconnect are not finished. The public interface and acceptance conditions are in the [proposal](../../docs/proposals/remote-access/README_EN.md); npm publication, product dependency locks, and desktop Releases are approved separately.

## What it does

- **URL-first**: a phone opens `https://<relay>/eduwork/?h=<hostId>` and loads the Host's Web UI.
- **Workspaces and sessions**: the remote side sees the Host's own workspace list, opens or continues existing sessions, reads history, sends prompts, and receives streamed events.
- **Host confirmation**: a new device appears as pending on the Host and takes effect only after a person confirms it on the local admin page. Each device has its own identity and can be revoked separately; revocation also closes its live connections.
- **Approvals and questions**: `session/control` and `userQuestions/*` are admitted, so the remote side uses the same control path as the local client (end-to-end acceptance still pending).
- **Directory selection**: the remote side can choose or create a folder through the Host's directory browser to use as a workspace (a narrow Host surface; see below).
- **No public service dependency**: the relay is self-hostable, and the protocol assumes no school, institutional domain, or specific external service.

## Components

| Component | Location | Role |
| --- | --- | --- |
| Host plugin | `src/index.js` | Device registry, Host identity, tunnel, gate, admin page, web-shell snapshot |
| Relay | `src/relay/relay.js` | Self-hosted; `/host` registration, `/peer` attach, static shell and combo serving, bootstrap injection |
| Device bootstrap | `deploy/web/bootstrap.js` | Device key, handshake, sealed channel, Gateway mux adapter, recovery |
| Host admin page | Host loopback web server | List/confirm/revoke/remove devices; per-boot token |
| Deployment sample | `deploy/` | systemd, Caddy, environment, web-shell mirror script |

## Security model

**Trust boundary**: the relay is untrusted. It sees the hostId, connection times, and frame sizes/timing, plus the handshake's deviceId, both public keys, and the source IP; business frames (requests/responses/streams) are sealed. It **can replace the bootstrap it serves**, so the deployer must be trusted. End-to-end encryption protects against parties other than the relay operator, but it cannot hide the handshake metadata.

**Device identity**: the device key lives in browser IndexedDB; the Host identity in `ctx.credentials`; the device registry in a settings row. An unconfirmed device is refused at the gate before any endpoint lookup.

**Operation surface**: `OPERATION_TABLE` in `gate.js` is the only authorization table, and `channel/operations.js` maps Host RPC endpoints to operations. Unknown endpoints are refused as `unknown-operation`; names are never guessed.

| Surface | Admitted | Refused |
| --- | --- | --- |
| Agent | `session:list`/`read`/`create`/`prompt`/`cancel`, `workspace:list`/`read`, `artifact:read`/`download`, `settings:read`, read-only model/job catalogs | Everything else |
| Host (narrow) | `directory:list`, `workspace:create` | Credentials, pairing, plugin install/uninstall, terminal, invitations |

**Revocation** seals the device first and then sweeps; an established long connection is closed, not merely refused on its next request.

**Idempotency**: side-effecting calls carry a client-generated `requestId`, and the Host admits them at most once; the relay does not deduplicate for the Host.

## Install and configure

### 1. Compose the plugin

Add this package to the DSH profile's `dsh.profile.bundles` and configure it in the profile's `cordis.patch.yml`:

```yaml
- {
    "id": "eduwork-remote-access",
    "config":
      {
        enabled: true,
        devices: [],
        relay: { url: "wss://<relay-host>/eduwork", hostId: "<host-id>" }
      }
  }
```

The row id must differ from `remote-access`, which `@deepseek-ai/dsh-api-remote-access` owns in the base bundle since DSH 0.2.1-rc.2. Reusing that id replaces the base plugin instead of adding to it, so its Client half never mounts and the UI plugins stay pending.

The plugin writes `devices` (Host identity and confirmed devices); it normally needs no manual editing. `hostId` is the Host's unique identifier on the relay, and the first registration verifies the Host's signature over the nonce, host id and public key before binding the key.

### 2. Deploy the relay

See [`deploy/README_EN.md`](deploy/README_EN.md): systemd, Caddy, environment, frontend mirror. The remote URL is `https://<relay-host>/eduwork/?h=<hostId>`.

### 3. Confirm the first device

1. The phone opens the URL; the bootstrap creates a device identity and connects to the Host.
2. The Host log prints `admin page http://127.0.0.1:<port>/remote-access-admin/<token>/`; open it locally and confirm the pending device.
3. Reload the same tab on the phone; the device becomes trusted, and the workspace list and session history are available.

> The one-time invite (`pairing.js`) is still module-level; the current flow is pending+confirm. The relay access key is not implemented. Do not paste real hostIds, device ids, or workspace paths into public issues or screenshots.

## Known limitations

- **The real invite flow** is not wired; the current flow is pending+confirm.
- **No relay access key**: knowing the hostId only allows a connection attempt and still requires Host confirmation.
- **Approvals/questions** lack end-to-end acceptance.
- **Local directory dialog**: the profile composition was switched for remote directory selection, so the local machine also gets the in-app dialog; restoring native locally is a follow-up.
- **iOS background** suspends the WebSocket; the current version needs a manual reload. Automatic reconnect is a follow-up.
- **Single device**: one device per Host at a time.
- **The bootstrap can be replaced by the relay operator**; deployer trust is a precondition.
- The preview notice keeps its acknowledgement in process memory for a non-loopback browser and reappears after a refresh.

## Development and testing

```bash
node scripts/build.mjs                  # src -> lib
node --test test/*.test.mjs             # 309 tests
```

The tests cover device registry/credentials/pairing/revocation, the gate, handshake, frame sequence, logical streams, relay registration and forwarding, the tunnel, the web-shell snapshot, and the admin page. Real-device acceptance is recorded in the PR description; synthetic tests do not replace real-network or desktop behaviour.

## Documentation

- [Remote access proposal](../../docs/proposals/remote-access/README_EN.md) — public interface, trust boundary, compatibility, and acceptance.
- [Protocol v2](docs/protocol.md) — the wire protocol between device, relay, and Host.
- [Relay deployment](deploy/README_EN.md) — self-hosting, Caddy, web-shell mirror, and troubleshooting.
- [Changelog](CHANGELOG_EN.md).

## License

MIT
