# Self-hosted relay deployment

[简体中文](DEPLOYMENT.md) · [Plugin usage and pairing](../README_EN.md)

The desktop plugin and relay ship in the same npm package, `@eduwork/dsh-remote-access`. The server runs `eduwork-remote-relay`; it does not need the EduWork desktop app, model services or a database. The accessed computer runs DSH/EduWork and the plugin, while other devices open the relay's HTTPS URL in a browser.

## Quick deployment with Docker

For servers, use the [Docker deployment guide](docker/README_EN.md): a Dockerfile, Compose setup and sanitized `relay.env.example` install pinned version `0.1.2` from npm. Configure the public URL and authentication, then run `docker compose up -d --build`. Root paths, path prefixes, key / OIDC authentication and iframe integration are supported. Your reverse proxy provides HTTPS; the container health check follows the configured prefix automatically.

The direct Node.js and systemd alternatives below use the same relay configuration.

## 1. Start the service

Use Node.js **24.22.1 or a later supported version**, npm, and an HTTPS reverse proxy supporting WebSockets. These examples pin `0.1.2`; change the version explicitly when upgrading.

Generate an access key, retain it and give it to the users registering computers:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Linux/macOS foreground run:

```sh
export RELAY_URL='https://remote.example.edu/'
export RELAY_ACCESS_KEYS='replace-with-the-generated-key'
npx --yes --package=@eduwork/dsh-remote-access@0.1.2 eduwork-remote-relay
```

Windows PowerShell:

```powershell
$env:RELAY_URL = 'https://remote.example.edu/'
$env:RELAY_ACCESS_KEYS = 'replace-with-the-generated-key'
npx --yes --package=@eduwork/dsh-remote-access@0.1.2 eduwork-remote-relay
```

The default listener is `127.0.0.1:8787`. `RELAY_URL` is the **external address users visit**, not the listening address. The proxy terminates TLS. Exiting the foreground command stops the service; see section 3 for persistent operation. Local-only debugging can use `http://localhost:8787/`; phones should use HTTPS with a valid certificate for Service Worker and cryptographic APIs.

## 2. HTTPS and a path prefix

A dedicated domain uses `RELAY_URL=https://remote.example.edu/`. To share a domain under a path:

```dotenv
RELAY_URL=https://example.edu/eduwork-remote/
RELAY_ACCESS_KEYS=replace-with-a-random-key
RELAY_CLIENT_IP_HEADER=x-real-ip
HOST=127.0.0.1
PORT=8787
```

`RELAY_URL` determines the prefix; **there is no separate PREFIX environment variable**. Enter the same complete URL on the computer. Preserve `/eduwork-remote/` in proxy requests: pages, Service Worker, health checks and WebSockets share that prefix.

For Nginx, put `map` in the `http` block and the locations in an existing HTTPS `server` block with certificates configured. For a root-path deployment, replace the two locations with one `location /`, keeping the same proxy settings.

```nginx
# Inside http
map $http_upgrade $eduwork_connection_upgrade {
    default upgrade;
    ''      close;
}

# Inside the existing HTTPS server
location = /eduwork-remote {
    return 301 /eduwork-remote/;
}
location /eduwork-remote/ {
    # No trailing / after 8787: preserve the path prefix.
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $eduwork_connection_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}
```

When using `RELAY_CLIENT_IP_HEADER`, let the trusted proxy overwrite that header and keep the relay port reachable only by that proxy. An existing site-wide Service Worker must leave this path alone.

Paths do not isolate same-origin browser storage or privileges. The remote DSH interface comes from the paired computer and shares the relay's origin. The site's applications and paired computers must therefore belong to a trust boundary the operator accepts. A dedicated domain narrows that boundary. Read [Security](../README_EN.md#security) before sharing an origin.

## 3. Persistent service (Linux / systemd)

Have a maintainer install the pinned package; run the service as an ordinary system account:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin eduwork-remote
sudo install -d /opt/eduwork-remote /etc/eduwork-remote
sudo npm install --prefix /opt/eduwork-remote --omit=dev --ignore-scripts --save-exact @eduwork/dsh-remote-access@0.1.2
sudo install -m 600 /dev/null /etc/eduwork-remote/relay.env
```

Skip `useradd` if the account exists. Write the section 2 configuration to `/etc/eduwork-remote/relay.env`, using your URL and generated key. Do not commit the environment file. Save the following as `/etc/systemd/system/eduwork-remote.service`:

```ini
[Unit]
Description=EduWork remote relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=eduwork-remote
Group=eduwork-remote
WorkingDirectory=/opt/eduwork-remote
EnvironmentFile=/etc/eduwork-remote/relay.env
ExecStart=/usr/bin/node /opt/eduwork-remote/node_modules/@eduwork/dsh-remote-access/lib/relay.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Check the Node path using `command -v node` and adjust `ExecStart` as needed. Verify that binary meets the version requirement; do not rely on a version manager loaded only by interactive shells.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now eduwork-remote
sudo systemctl status eduwork-remote
sudo journalctl -u eduwork-remote -n 100 --no-pager
```

After environment changes, run `sudo systemctl restart eduwork-remote`. To upgrade, install a specific new npm version in the same directory and restart. Retain `package.json`, `package-lock.json` and the environment file for rollback. A relay restart disconnects current connections; online computers and devices attempt to reconnect. Pairing identities live on the computer and remote browser; the relay stores no session or pairing database.

## 4. Verify and pair

For a path deployment:

```sh
curl -fsS http://127.0.0.1:8787/eduwork-remote/healthz
curl -fsS https://example.edu/eduwork-remote/healthz
curl -I https://example.edu/eduwork-remote/sw.js
```

The first two return `ok`; the last returns 200 with a JavaScript content type. Health checks establish HTTP reachability only. With plugin `0.1.2`, choose your own relay under desktop Settings → Remote access, enter the same external URL and key, then use “Test connection” to check reachability and identity acceptance separately. Testing also works before remote access is enabled. Enable “Allow remote access” and check for “Connected”; use “Retry” after a connection failure.

Select “Add a device” and follow the [pairing steps](../README_EN.md#add-and-remove-devices) on another device, compare codes and approve on the computer. An access key admits a computer to the relay; it does not replace device pairing.

## 5. Organization sign-in and iframe (optional)

Organization sign-in can replace access keys or coexist with them:

```dotenv
RELAY_OIDC_ISSUER=https://sso.example.edu
RELAY_OIDC_CLIENT_IDS=desktop-client-id
RELAY_FRAME_ANCESTORS=self https://portal.example.edu
```

Omit `RELAY_ACCESS_KEYS` when using organization sign-in alone. The issuer must exactly match the token's `iss`. Client IDs identify desktop applications registered with the issuer; separate multiple IDs with commas. Discovery/JWKS supplies public keys. The relay currently accepts **RS256 ID Tokens** and checks signatures, issuer, audience/authorized party and validity. This is neither a model API key nor an access token used as an ID Token.

The computer needs `@eduwork/dsh-oidc@0.3.1` or a later compatible version, and distribution configuration for `organization: { relay, oidcProfileId }`. Setting an issuer on the server does not configure desktop login. Once configured, the `0.1.2` settings page supports organization sign-in and connection testing, and lets users switch to their own relay; the distribution selects the relay address for organization mode. The relay verifies existing identity, stores no refresh token and does not sign users in; the computer's OIDC plugin handles renewal.

`RELAY_FRAME_ANCESTORS` defaults to `none`, blocking iframe embedding. Use `self` for same-origin parents, or complete origins (scheme, host and optional port, without paths). Quote multiple sources in shell commands: `RELAY_FRAME_ANCESTORS="self https://portal.example.edu"`. The parent's CSP must also permit the relay, and the proxy must not add a conflicting `X-Frame-Options: DENY` or `frame-ancestors 'none'` to this path.

```html
<iframe src="https://example.edu/eduwork-remote/" title="Remote access"></iframe>
```

The current design needs scripts, Service Worker and same-origin identity; an opaque-origin sandbox is incompatible. The ordinary iframe above provides no security isolation. Cross-site iframes may fail to load the computer's interface in Safari/WebKit; use same-site integration or open the relay at the top level. Allowing embedding does not replace local pairing or device revocation.

## Troubleshooting

| Symptom | Check first |
| --- | --- |
| Immediate exit with incomplete-configuration error | Ensure the process receives `RELAY_URL` and either access keys or complete OIDC settings. |
| healthz works but the computer cannot connect | HTTPS certificate, WebSocket Upgrade, matching external URL/prefix and key; for OIDC, issuer/JWKS reachability and ID Token. |
| Path page or sw.js returns 404 | Check for prefix removal by `proxy_pass` or routing to another site's SPA. |
| Phone stays on the loading page | Valid HTTPS, no parent Service Worker interference, computer online and awake, browser site data retained. |
| Top-level page works but iframe does not | Relay frame ancestors, parent CSP, proxy response headers and WebKit cross-site restrictions. |

Access-key deployments do not need an organization login plugin. See the [protocol](PROTOCOL.md) for APIs, frames and encryption.
