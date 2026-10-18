# Self-hosted relay deployment

**English** | [简体中文](README.md)

This directory is a **deployment sample**, not a runtime dependency of the npm package. The relay forwards ciphertext only; it holds no Host key and needs no credentials. `server.mjs` reads the environment and contains no business logic.

**Trust boundary**: the relay serves `bootstrap.js`, the starting point of device-side encryption, and the operator can replace it. End-to-end encryption protects against parties other than the relay operator; the deployer must be trusted. There is no relay access key yet: anyone who knows the hostId can attempt a connection, but the Host still has to confirm the device.

## Layout

| File | Purpose |
| --- | --- |
| `server.mjs` | Relay entry point; reads `EDUWORK_RELAY_*` |
| `relay.js`, `protocol.js`, `websocket.js` | Copied from the build output `lib/relay/` into `/opt/eduwork-relay/` |
| `web/bootstrap.js` | Device-side script; injected via `EDUWORK_RELAY_BOOTSTRAP_SCRIPT` |
| `eduwork-relay.service` | systemd unit (loopback, dynamic user, state directory) |
| `eduwork-relay.env` | Environment sample; installed at `/etc/eduwork-relay.env` |
| `mirror-web-snapshot.mjs` | Turns the Host's exported web-shell snapshot into the relay's frontend root |
| `frontend/` | Generated at runtime (below); not committed |

## 1. Prepare the relay

```bash
# In the repository
cd packages/dsh-remote-access
node scripts/build.mjs

# On the server
install -d /opt/eduwork-relay/web /opt/eduwork-relay/frontend
install -m 0644 lib/relay/relay.js lib/relay/protocol.js lib/relay/websocket.js /opt/eduwork-relay/
install -m 0755 deploy/server.mjs /opt/eduwork-relay/server.mjs
install -m 0644 deploy/web/bootstrap.js /opt/eduwork-relay/web/bootstrap.js
install -m 0644 deploy/eduwork-relay.service /etc/systemd/system/eduwork-relay.service
install -m 0600 deploy/eduwork-relay.env /etc/eduwork-relay.env
```

- Keep `EDUWORK_RELAY_BIND` at `127.0.0.1`; Caddy terminates TLS.
- `EDUWORK_RELAY_STORE` must live under the unit's `StateDirectory`. It is the trust-on-first-use hostId→public-key binding; losing it lets someone else claim the hostId.
- `EDUWORK_RELAY_FRONTEND_ROOT` points at the mirror from step 3.
- `EDUWORK_RELAY_BOOTSTRAP_SCRIPT` is the **URL a browser can fetch**, not the relay's internal path, because the reverse proxy strips the prefix.

## 2. Caddy

```caddyfile
<relay-host> {
  handle_path /eduwork* {
    reverse_proxy 127.0.0.1:8792
  }
}
```

`handle_path` strips `/eduwork`, so the relay sees `/host`, `/peer`, `/`, `/plugins/...`, and `/eduwork-assets/...`. The device page URL is:

```
https://<relay-host>/eduwork/?h=<hostId>
```

## 3. Mirror the Host's web shell

The remote page runs the **index rendered by the Host itself**, not a static dist on the relay. The Host plugin exposes `POST /remote-access-admin/<token>/export-web` (the token is the `admin page` line in the Host log and changes per boot); the snapshot lands in `$DSH_HOME/remote-access/web-snapshot/`.

```bash
# From a machine that can reach the Host admin page
curl -X POST 'http://127.0.0.1:<host-port>/remote-access-admin/<token>/export-web'

# Arrange it as the relay frontend root
node deploy/mirror-web-snapshot.mjs \
  "$DSH_HOME/remote-access/web-snapshot" \
  /opt/eduwork-relay/frontend

# Upload (example)
rsync -a --delete /opt/eduwork-relay/frontend/ <relay>:/opt/eduwork-relay/frontend/
```

- The snapshot's `assets/plugins/combo/<sha256>.js` answers the browser's `/plugins/??...`; the relay replays it by `sha256(path+query)`. Do not rename these files.
- Shell assets go to `frontend/assets/`, client bundles to `frontend/plugins/`, and the index to `frontend/index.html`.
- The relay injects the bootstrap into `</head>`; the index's `<base href="./">` keeps relative assets correct under `/eduwork/`.
- **Re-export and re-mirror after the Host's plugins or UI change.** Old combos may stay; the index must be updated.

## 4. Start and update

```bash
systemctl daemon-reload
systemctl enable --now eduwork-relay
systemctl restart eduwork-relay
journalctl -u eduwork-relay -n 20 --no-pager
```

Configure the Host plugin with `relay.url` (`wss://<relay-host>/eduwork`) and `hostId`; the Host registers on startup. After Host UI/plugin changes: re-export, re-mirror, reload the browser. The bootstrap and index are `no-cache`, but phone browsers may still keep an old copy; clearing site data (which changes the device identity) may be necessary.

## 5. Troubleshooting

- The page keeps reconnecting: check that the Host is online (relay log `host ... left`) and the phone device's `pending/trusted` state and the single-device slot (one device per Host at a time).
- White page while the Host is online: check that `/eduwork/` returns the **bootstrap-injected index** and that `plugins/` and `assets/` return 200.
- Empty workspace list: check the `workspace/follow` baseline and the device slot; `operation-refused` in the browser console or Host log names the endpoint.
- App switching on iOS suspends the WebSocket; the current version needs a manual reload. Automatic reconnect is a follow-up.

## 6. Security checklist

- [ ] The relay listens on loopback only; TLS ends at the reverse proxy.
- [ ] The `hosts.json` directory persists and is readable only by the service user.
- [ ] The relay operator is trusted (the bootstrap can be replaced).
- [ ] The hostId is not publicised; there is no relay access key yet, so knowing it only allows a connection attempt that still requires Host confirmation.
- [ ] Real hostIds, device ids, workspace paths, or domains are not pasted into logs, screenshots, or issues.
