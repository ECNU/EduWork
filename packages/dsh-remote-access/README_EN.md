# Remote access

[简体中文](README.md)

`@eduwork/dsh-remote-access` lets you use DeepSeek Harness (DSH) on another computer from a browser on your phone or a second computer: view and start conversations, continue or cancel tasks, approve, answer questions, and view and download results. The connection passes through a self-hosted relay server and is end-to-end encrypted, so the relay cannot read it. Each device connects only after you compare a pairing code and confirm it on the computer, and you can remove it at any time.

The package has two parts:

- **DSH plugin**: runs on the computer being accessed. Its settings page switches remote access on and off and adds and removes devices, and it fits DSH's interface to phone screens.
- **Relay service**: runs on a server with a public address. It forwards ciphertext and serves the page you open on your phone.

## Use

### Deploy the relay

You need Node.js 24.18 or later and a reverse proxy that serves HTTPS for the relay's domain and forwards WebSockets.

```sh
RELAY_ORIGIN=https://remote.example.edu RELAY_ACCESS_KEYS=key-1,key-2 \
  npx -p @eduwork/dsh-remote-access eduwork-remote-relay
```

`RELAY_ORIGIN` is the public address users reach the relay at; `RELAY_ACCESS_KEYS` are the comma-separated access keys you give to computer owners. The relay listens on `127.0.0.1:8787` by default; change it with `HOST` and `PORT`. `/healthz` answers `ok` for monitoring.

### Turn it on on the computer

Install the plugin in DSH and restart it:

```sh
dsh plugin --profile web add @eduwork/dsh-remote-access
```

Open Settings → Remote access, enter the relay server and the access key, and select "Allow remote access". Once it shows "Connected to the relay server", you can add devices. Remote access is off by default.

### Add and remove devices

1. On the computer, choose "Add a device". A QR code and a link appear; the link works once, for 10 minutes.
2. On the phone, scan the code or open the link, enter a device name and choose "Pair".
3. Check that the phone and the computer show the same 6-digit pairing code, then choose "Allow" on the computer.

From then on, opening the relay address on that device connects to the computer, and it reconnects by itself after a drop. On iPhone and iPad, add the page to the Home Screen first, open it from there and paste the pairing link: a pairing made only in Safari is lost after 7 days without use.

Choose "Remove" under "Paired devices" on the computer to disconnect a device at once and keep it from connecting again.

## What remote devices can do

They can choose an existing workspace, view and start conversations, continue and cancel tasks, approve or answer questions, and view and download results; in EduWork they can also use Studio results and the calendar.

A phone shows DSH's own interface, only fitted to the narrow screen: the session list (workspace folders, search, new session and so on) opens full screen from the top-left corner and closes once you pick a session or a panel; conversations show durations, retries, approvals and questions as on the computer.

They cannot open windows or programs or show notifications on the computer, register or remove workspaces, change settings or manage accounts, plugins, credentials, skills or memories, use terminals or run code, or manage remote access itself. The full list is in [src/gate/gate.ts](src/gate/gate.ts); anything not listed is refused.

## Security

- Traffic between the computer and the device is end-to-end encrypted; the relay only forwards ciphertext. The pairing link pins the computer's public key, so the relay cannot impersonate the computer.
- The browser generates the device key as non-extractable; the computer stores only its public key. Every connection is signed with the device key.
- An access key only decides who may use the relay; it cannot be used to connect to someone else's computer. It is kept in DSH's credentials (`EDUWORK_REMOTE_ACCESS_KEY`), not in the plugin's settings.
- The relay serves the page you open on your phone, so whoever runs the relay can change it. Use only relays you trust.

See the [protocol document](docs/PROTOCOL.md) (Chinese) for details.

## Development

From this package directory:

```sh
npm ci
npm run check
node scripts/check-web.ts
```

`check-web.ts` goes through pairing, loading, requests, reconnection and device removal in Chromium and WebKit. It needs Playwright's browsers installed locally and does not run in CI.

[Package maintenance and publishing](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md) · [Changelog](CHANGELOG.md) · [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
