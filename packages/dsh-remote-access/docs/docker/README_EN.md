# Deploy the relay with Docker

[简体中文](README.md) · [Full deployment guide](../DEPLOYMENT_EN.md)

Use Docker Engine and Compose v2 to build a local image from the published `@eduwork/dsh-remote-access@0.1.2` npm package. The server needs neither a Node.js installation nor desktop files or plugin source. Prepare a domain and an HTTPS reverse proxy supporting WebSockets, then follow these steps.

## 1. Prepare files and configuration

Copy the deployment files from [this directory in the repository](https://github.com/ECNU/EduWork/tree/main/packages/dsh-remote-access/docs/docker) into one directory. To download them without cloning the repository, run this in a new, empty directory using a Linux shell:

```sh
base=https://raw.githubusercontent.com/ECNU/EduWork/main/packages/dsh-remote-access/docs/docker
for file in Dockerfile compose.yaml healthcheck.mjs relay.env.example .dockerignore .gitignore; do
  curl -fsSLo "$file" "$base/$file" || exit 1
done
```

With an existing checkout, enter `packages/dsh-remote-access/docs/docker`. Run the following commands from the directory containing the deployment files:

```sh
cp relay.env.example relay.env
chmod 600 relay.env
docker run --rm node:24.22.1-alpine node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Edit `relay.env`, entering your public URL and the generated key:

```dotenv
RELAY_URL=https://example.edu/eduwork-remote/
RELAY_ACCESS_KEYS=replace-with-the-generated-random-key
```

A dedicated domain root also works, such as `https://remote.example.edu/`. Include any path prefix directly in `RELAY_URL`, ending with `/`; both the service and health check use it. The key admits computers to the relay; remote devices still require pairing approval on the computer.

The real `relay.env` is excluded from Git and the image build context. Do not share it as an attachment. The image installs the npm package during its build; startup reads environment configuration without accessing npm.

## 2. Start with one command

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 relay
```

The container runs as a non-root user with a read-only filesystem. Compose publishes **`127.0.0.1:8787` on the server**, for a reverse proxy on the same machine. Inside the container, `HOST=0.0.0.0` accepts Docker's port forwarding; do not change it to the container's loopback address.

Use the [Nginx configuration in the deployment guide](../DEPLOYMENT_EN.md#2-https-and-a-path-prefix) in your HTTPS site: forward to `http://127.0.0.1:8787`, preserving the prefix and WebSocket Upgrade. Configure certificates at the proxy; this Compose setup does not obtain certificates automatically.

If the proxy also runs in Docker, connect it to the relay's Docker network and use `http://relay:8787` as the upstream. A proxy container's `127.0.0.1` does not refer to the host. Adapt the upstream to your network topology.

## 3. Verify and connect a computer

```sh
docker compose exec -T relay node /opt/eduwork-remote/healthcheck.mjs
curl -fsS http://127.0.0.1:8787/eduwork-remote/healthz
curl -fsS https://example.edu/eduwork-remote/healthz
```

The health check should succeed and both HTTP requests should return `ok`; omit `/eduwork-remote` for root deployments. Container health checks only the internal HTTP service. Verify external HTTPS, WebSockets and authentication from the desktop client as well.

With remote access plugin `0.1.2` installed, open Settings → Remote access, select your own relay, enter the same external URL and key, and choose "Test connection". It checks reachability and identity acceptance separately, even before remote access is enabled. Enable "Allow remote access", select "Add a device", scan or open the link, then compare codes and approve on the computer. See [pairing](../../README_EN.md#add-and-remove-devices).

## 4. Organization sign-in and embedding

Organizations can configure OIDC in `relay.env`, either alone or alongside keys:

```dotenv
RELAY_ACCESS_KEYS=
RELAY_OIDC_ISSUER=https://sso.example.edu
RELAY_OIDC_CLIENT_IDS=desktop-client-id
RELAY_FRAME_ANCESTORS=self https://portal.example.edu
```

Replace these placeholders with your organization's configuration. The relay checks **RS256 ID Tokens**, not model keys or access tokens. The desktop also needs a compatible `dsh-oidc` and remote plugin configuration `organization: { relay, oidcProfileId }` to offer organization sign-in. Server settings do not create the desktop's organization configuration.

Set `RELAY_FRAME_ANCESTORS` only when iframe embedding is needed; embedding is blocked by default. Prefixes and ordinary iframes do not isolate same-origin privileges, so sharing an origin requires accepting the shared trust boundary. See the [deployment guide](../DEPLOYMENT_EN.md#5-organization-sign-in-and-iframe-optional) for OIDC, proxy headers and iframe details.

## 5. Configuration changes, upgrades and shutdown

After editing `relay.env`, recreate the container to apply the configuration:

```sh
docker compose up -d --force-recreate
```

For upgrades, set `REMOTE_ACCESS_VERSION` to the exact published version you intend to deploy; this example uses the current version. Run subsequent Compose commands in the same shell, or save the variable in a local `.env`, keeping the image tag and build argument consistent.

```sh
export REMOTE_ACCESS_VERSION=0.1.2
docker compose up -d --build
docker compose exec -T relay node -p "require('@eduwork/dsh-remote-access/package.json').version"
```

Images are built locally: `docker compose pull` does not replace rebuilding. To roll back, choose the previous version, restore compatible `relay.env` settings and rebuild. Retain your deployment configuration and previous version number. Do not share keys or tokens in logs.

```sh
docker compose down
```

Stopping or upgrading the relay disconnects current connections; online computers and devices attempt to reconnect. Pairing state lives on the computer and browser, so the relay needs no data volume. Logs rotate automatically; stopping the relay does not delete desktop conversations or pairings.
