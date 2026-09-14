# Architecture and extension boundary

[简体中文](architecture.md) | **English**

## Composition

`dsh-mail-assistant` is one Host + Client Bundle:

```text
DSH Web Client
  └─ settings.section: Mail assistant
       ├─ settingsScope        namespaced non-secret settings
       └─ remote.credentials   write-only app password

DSH Host
  ├─ ctx.settings             live configuration
  ├─ ctx.credentials          resolve app password per operation
  ├─ ctx.tools                five tools, capability guard, execution pipeline
  ├─ ctx.permissionPresets
  │    ├─ ordinary preset     one approval for mail_send
  │    └─ Full Access         no per-call prompt
  ├─ ctx.fs                   workspace resolution and bounded binary reads
  ├─ ImapFlow                 read-only IMAP
  └─ Nodemailer               controlled SMTP submission
```

The plugin does not provide a Credential, Settings, Filesystem, Permission Preset, Approval, or Web Shell provider. The DSH Profile owns those services, allowing ordinary Web, local desktop, and other product compositions to reuse the same package.

## Configuration and credentials

Non-secret fields live in the `dsh-mail-assistant` settings namespace. The app password uses the fixed credential reference `DSH_MAIL_ASSISTANT_PASSWORD`. The Host resolves it at the beginning of every tool call and never caches it across operations, so rotation applies to the next call.

The settings page reads and writes non-secret configuration through `settingsScope.bind({ namespace: 'dsh-mail-assistant' })`, using revision-fenced atomic mutations to avoid overwriting concurrent updates. For the app password it only invokes `credentials.describe/set/unset`: it can observe configured/writable state, but it cannot read the credential value back into the browser.

## Message identity and pagination

The model never constructs an IMAP UID directly. `mail_find` returns an opaque handle that binds folder, UIDVALIDITY, and UID. A later read reopens the same folder and revalidates UIDVALIDITY. If a mailbox is rebuilt or its UID namespace changes, the old handle fails and instructs the caller to search again. Attachment handles additionally bind the message and MIME part and are compared with the current body structure before download.

Handles prevent stale or accidental addressing; they are not bearer authorization and contain no password. Capability settings, the current credential, session workspace, and DSH permission preset remain authoritative.

A `mail_find` continuation cursor binds the complete filter, direction, UIDVALIDITY, and preceding-page UID boundary. Newest-first continuation only moves toward lower UIDs, so messages arriving during pagination do not duplicate earlier pages; oldest-first moves in the opposite direction. Every page reruns server-side search and checks UIDVALIDITY. `mail_list_folders` discovers exact paths; `mail_find` opens one explicit folder. No mailbox synchronization or local mail database exists.

## Connection lifecycle

Each tool call creates one short-lived connection and closes it after the operation:

- no background IDLE or polling;
- no startup or save-time probe;
- no connection pool across calls;
- cancellation closes the protocol connection;
- protocol logging is disabled.

This trades a small amount of latency for simpler credential rotation, cleanup, and failure isolation. Any future pool must still re-resolve credentials per operation and invalidate immediately on settings or credential changes.

## Binary boundary

Outbound attachments use `ctx.fs`: resolve from the session `cwd`, verify containment, require a regular file, enforce an aggregate size bound, then use bounded `readBytes`.

The Host artifact embeds the IMAP/SMTP implementation libraries in `lib/index.js`. Users do not install a second protocol runtime after npm, source-package, or offline-product installation, and plugin dependencies cannot collide with a product's private Node runtime during updates.

DSH `0.1.5-rc.1` does not expose `writeBytes`. Attachment download therefore requires a local Host filesystem. The plugin resolves the logical destination with `ctx.fs`, creates the directory, resolves real workspace and directory paths, rechecks containment to reject pre-existing symlinks or junctions, and finally performs a random-name `wx` exclusive write. Replace this local adapter when DSH provides an official binary-write seam.

## Extension rules

- OAuth2 requires a separate authentication adapter; tokens never belong in settings.
- Multiple accounts require independent Credential Keys/Refs and an explicit account parameter; YAML must not carry passwords.
- Polling, auto-reply, move, delete, and flag mutation are separate high-risk product boundaries.
- Background or scheduled sending requires an explicit deployment mode and recipient allowlist. Interactive Full Access cannot silently become background authorization.
