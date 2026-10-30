# @eduwork/dsh-mail-pet

[简体中文](README.md)

`@eduwork/dsh-mail-pet` reminds you once when a new message arrives, through EduWork's plugin notification protocol, and opens a read-only preview of that message when you click the reminder. The pet, system notifications and the tray share one notification state; this package never drives a display channel directly.

It is an independent, optional module: while disabled it does not poll and does not register a notification source.

## Requirements

1. The shell supports plugin notification protocol v1 (`@eduwork/dsh-desktop-pet` 0.1.1 and later, `eduworkNotificationProtocol: 1`).
2. `@eduwork/dsh-mail` is installed and enabled, with the IMAP host, account and password configured.
3. "Allow the assistant to read mail" is on in the mail assistant settings. This package reuses that setting and the same credential reference instead of duplicating the form.

Without the notification service the package still loads, it just has no reminder channel. When the protocol version is not 1 it fails loudly instead of falling back to a private path.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Poll on the configured interval once on; off stops polling and unregisters the source |
| `intervalSeconds` | `180` | 5–3600 seconds; failures back off by powers of two, up to 4× |
| `folder` | `INBOX` | Mailbox folder; must use the same IMAP account as the mail assistant |
| `maxPerFlush` | `5` | Notices per poll; the rest stay in the mailbox for the next poll |

Every field is volatile: changes from the generic plugin settings form apply without a restart.

## Layout

```
lib/index.js     registers the mail source, poll scheduling, watermark storage, publish and click validation
lib/client.js    read-only preview, bundled from src/client.js by scripts/build.mjs
lib/watcher.js   read-only IMAP: STATUS probe plus a bounded UID range fetch
lib/message.js   read-only IMAP: one message body (charset decoding, HTML to text, attachment names)
lib/text.js      pure helpers: title/preview cleaning and the click-payload budget
lib/config.js    configuration fields and the credential reference
```

Deliberate choices:

- **Read-only**: only `STATUS`, a bounded `UID FETCH` and a single `BODY`; never `STORE`, so flags never change.
- **Watermark first**: the watermark is written before publishing, so a failed notice cannot replay the same message on the next poll.
- **Silent reset on UIDVALIDITY change**: a rebuilt mailbox records the new waterline instead of treating the whole folder as new mail.
- **Batches stay honest**: newest messages are described individually and one "N new messages" summary follows, so a backlog is never presented as fresh arrivals.
- **Protocol limits**: titles are clipped to 120 characters and previews to 400, control characters become spaces, and clipping counts code points so emoji never split.

## Click and preview

Notices publish `action: 'open'`. A click is validated by `onAction`, which reads that one message read-only and returns a payload bounded to the 4096-character target budget (subject, sender, date, excerpt, attachment names). The `/client` entry renders it as a read-only panel on `shell.overlay`:

- the panel holds no credentials and exposes no write operation; an excerpt that hit the budget is marked as truncated;
- `Esc`, the backdrop or the close button dismisses it, and focus moves in on open and returns on close;
- a click without a registered handler is reported as a failed navigation by the protocol instead of silently doing nothing.

## Test and build

```
npm ci
npm run check     # build the client bundle, then 19 tests
```

`test/text.test.mjs` covers cleaning, clipping and the payload budget; `test/message.test.mjs` covers MIME decoding, HTML-to-text and attachment names; `test/client.test.mjs` loads the bundle the way the shell does (`window.__ModuleLoader__.load`) and checks the exports, source registration, click payload and disposal.

The client bundle `lib/client.js` is committed. `npm run check` rebuilds it, so changing `src/client.js` without rebuilding fails the check.

## License

The primary license is the Mulan Permissive Software License, Version 2 (`MulanPSL-2.0`); the MIT grant from before the switch is retained in [LICENSE-MIT](LICENSE-MIT). The SPDX expression is `MulanPSL-2.0 AND MIT`; see [LICENSING.en.md](LICENSING.en.md) for the scope.
