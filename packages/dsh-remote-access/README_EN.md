# Remote access

[简体中文](README.md)

`@eduwork/dsh-remote-access` lets you use DeepSeek Harness (DSH) on another computer from a browser on your phone or a second computer: view and start conversations, continue or cancel tasks, approve, answer questions, and view and download results. The connection passes through a self-hosted relay server and is end-to-end encrypted, so the relay cannot read it. Each device connects only after you compare a pairing code and confirm it on the computer, and you can remove it at any time.

The package has two parts:

- **DSH plugin**: runs on the computer being accessed. Its settings page switches remote access on and off and adds and removes devices, and it fits DSH's interface to phone screens.
- **Relay service**: runs on a server with a public address. It forwards ciphertext and serves the page you open on your phone.

## Use

### Deploy the relay

You need Node.js 24.22.1 or later and a reverse proxy that serves HTTPS for the relay's domain and forwards WebSockets.

```sh
RELAY_URL=https://remote.example.edu RELAY_ACCESS_KEYS=key-1,key-2 \
  npx -p @eduwork/dsh-remote-access eduwork-remote-relay
```

`RELAY_URL` is the public address users reach the relay at; `RELAY_ACCESS_KEYS` are the comma-separated access keys you give to computer owners. The relay listens on `127.0.0.1:8787` by default; change it with `HOST` and `PORT`. `<RELAY_URL>healthz` answers `ok` for monitoring.

The relay can also share a domain with other sites under a path of its own, for example `RELAY_URL=https://example.edu/eduwork-remote/`. The reverse proxy must pass the path on unchanged, keeping that prefix; the relay's pages, Service Worker and connections all stay below it. Enter the same address on the computer. Sharing a domain has security risks (see [Security](#security)): do it only when no site on that domain needs signing in to, and if a Service Worker there covers the whole domain, make it leave this path alone.

A school or company can instead let its members use the relay with their own sign-in, without handing out access keys: set `RELAY_OIDC_ISSUER` to the issuer of the organization's OpenID Connect sign-in (for example `https://sso.example.edu`) and `RELAY_OIDC_CLIENT_IDS` to the desktop application's client IDs in it, separated by commas. Computers register with the ID Token their sign-in issued; the relay checks it against the keys the issuer publishes and keeps only the user's identifier, never the token. Computers switch to a new token before theirs expires; if one expires without being renewed, the relay ends that computer's remote connections. When the organization sign-in has lapsed and needs signing in again, the computer stops connecting to the relay and the settings page asks the user to sign in again. Both ways can be enabled together.

The relay lets each account register at most 5 computers at a time and each computer accept at most 60 device connections a minute; an address with 10 refused registrations in a minute has to wait. Behind a reverse proxy, set `RELAY_CLIENT_IP_HEADER` to the header in which the proxy passes the client's address (for example `x-real-ip`); otherwise all users share the proxy's address.

### Turn it on on the computer

Install the plugin in DSH and restart it:

```sh
dsh plugin --profile web add @eduwork/dsh-remote-access
```

Open Settings → Remote access, enter the relay server and the access key, and select "Allow remote access". Once it shows "Connected", you can add devices. Remote access is off by default.

An organization's distribution can preset its relay and sign-in (plugin setting `organization: { relay, oidcProfileId }`, where `oidcProfileId` names the organization's [dsh-oidc](../dsh-oidc/README_EN.md) profile). The settings page then shows no relay or access key: sign in with the organization's account and select "Allow remote access". Signing out stops remote access.

### Add and remove devices

1. On the computer, choose "Add a device". A QR code and a link appear; the link works once, for 10 minutes.
2. On the phone, scan the code or open the link, enter a device name and choose "Pair".
3. Check that the phone and the computer show the same 6-digit pairing code, then choose "Allow" on the computer.

From then on, opening the relay address on that device connects to the computer, and it reconnects by itself after a drop. On iPhone and iPad, add the page to the Home Screen first, open it from there and paste the pairing link: a pairing made only in Safari is lost after 7 days without use.

Choose "Remove" under "Paired devices" on the computer to disconnect a device at once and keep it from connecting again.

## What remote devices can do

They can choose an existing workspace, view and start conversations, continue and cancel tasks, approve or answer questions, and view and download results; in EduWork they can also use Studio results and the calendar.

A phone shows DSH's own interface, only fitted to the narrow screen: the session list (workspace folders, search, new session and so on) opens full screen from the top-left corner and closes once you pick a session or a panel; settings also fill the screen, with the sections as a row of tabs, and are view only on remote devices; conversations show durations, retries, approvals and questions as on the computer.

They cannot open windows or programs or show notifications on the computer, register or remove workspaces, change settings or manage accounts, plugins, credentials, skills or memories, use terminals or run code, or manage remote access itself. The full list is in [src/gate/gate.ts](src/gate/gate.ts); anything not listed is refused.

## Security

- Traffic between the computer and the device is end-to-end encrypted; the relay only forwards ciphertext. The pairing link pins the computer's public key, so the relay cannot impersonate the computer.
- The browser generates the device key as non-extractable; the computer stores only its public key. Every connection is signed with the device key.
- An access key or an organization sign-in only decides who may use the relay; neither can be used to connect to someone else's computer. The access key is kept in DSH's credentials (`EDUWORK_REMOTE_ACCESS_KEY`), not in the plugin's settings; the ID Token of an organization sign-in goes only to the relay the distribution preset, which the settings page cannot change.
- The relay serves the page you open on your phone, so whoever runs the relay can change it. Use only relays you trust.
- The DSH interface on your phone is provided by the computer it connects to and runs on the relay's domain, and browsers separate data only by domain. So the interface one computer provides can use this browser's pairings with other computers to connect to them. Pair only with your own computers.
- Likewise, when the relay shares a domain with other sites, their scripts can use the pairings here to connect to computers, and the interface of any paired computer can use those sites as the user and read the data they keep in the browser. Give the relay a domain of its own (a subdomain, for example), and never share one with a sign-in service or other sites that you sign in to.

See the [protocol document](docs/PROTOCOL.md) (Chinese) for details.

## Contribution origins

[@JunieXD](https://github.com/JunieXD) implemented this plugin in [#192](https://github.com/ECNU/EduWork/pull/192), building on [@Paraso42](https://github.com/Paraso42)'s remote-access prototype in [#180](https://github.com/ECNU/EduWork/pull/180): mapping DSH host integration points, endpoint allowlists and refusal reasons, the device trust and revocation model, and validation scenarios for reconnection, avoiding duplicate execution, and deployment across networks. @Paraso42 is a co-contributor to remote access; #192 defines the current protocol and implementation.

## Development

From this package directory:

```sh
npm ci
npm run check
node scripts/check-web.ts
```

`check-web.ts` goes through pairing, loading, requests, reconnection and device removal in Chromium and WebKit. It needs Playwright's browsers installed locally and does not run in CI.

[Package maintenance and publishing](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md) · [Changelog](CHANGELOG.md) · [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
