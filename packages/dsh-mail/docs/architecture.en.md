# Architecture and extension boundary

[简体中文](architecture.md) | **English**

## Composition

`dsh-mail-assistant` is one Host + Client Bundle:

```text
DSH Web Client
  └─ settings.section: Mail assistant
       ├─ configForms        namespaced non-secret settings
       └─ remote.credentials   write-only app password

DSH Host
  ├─ ctx.settings             live configuration
  ├─ ctx.credentials          resolve app password per operation
  ├─ ctx.tools                five tools, capability guard, execution pipeline
  ├─ ctx.permissionPresets
  │    ├─ ordinary preset     one approval for mail_send
  │    └─ Full Access         no per-call prompt
  ├─ ctx.fs                   workspace resolution and bounded binary reads
  ├─ ctx.notifications        new-mail reminders (optional, notification protocol v1, off by default)
  ├─ ImapFlow                 read-only IMAP (tools connect per operation; reminders may reuse one read-only session)
  └─ Nodemailer               controlled SMTP submission
```

The plugin does not provide a Credential, Settings, Filesystem, Permission Preset, Approval, or Web Shell provider. The DSH Profile owns those services, allowing ordinary Web, local desktop, and other product compositions to reuse the same package.

## Configuration and credentials

Non-secret fields live in the `dsh-mail-assistant` settings namespace. The app password uses the fixed credential reference `DSH_MAIL_ASSISTANT_PASSWORD`. The Host resolves it at the beginning of every tool call and never caches it across operations, so rotation applies to the next call.

The settings page reads and writes non-secret configuration through `configForms.get('dsh-mail-assistant')`, using revision-fenced atomic mutations to avoid overwriting concurrent updates. For the app password it only invokes `credentials.describe/set/unset`: it can observe configured/writable state, but it cannot read the credential value back into the browser.

## Message identity and pagination

The model never constructs an IMAP UID directly. `mail_find` returns an opaque handle that binds folder, UIDVALIDITY, and UID. A later read reopens the same folder and revalidates UIDVALIDITY. If a mailbox is rebuilt or its UID namespace changes, the old handle fails and instructs the caller to search again. Attachment handles additionally bind the message and MIME part and are compared with the current body structure before download.

Handles prevent stale or accidental addressing; they are not bearer authorization and contain no password. Capability settings, the current credential, session workspace, and DSH permission preset remain authoritative.

A `mail_find` continuation cursor binds the complete filter, direction, UIDVALIDITY, and preceding-page UID boundary. Newest-first continuation only moves toward lower UIDs, so messages arriving during pagination do not duplicate earlier pages; oldest-first moves in the opposite direction. Every page reruns server-side search and checks UIDVALIDITY. `mail_list_folders` discovers exact paths; `mail_find` opens one explicit folder. No mailbox synchronization or local mail database exists.

## Connection lifecycle

Each tool call creates one short-lived connection and closes it after the operation:

- no background IDLE or polling (when reminders are on it is a timed `STATUS` plus envelopes, never IDLE);
- no startup or save-time probe;
- no connection pool across calls;
- cancellation closes the protocol connection;
- protocol logging is disabled.

This trades a small amount of latency for simpler credential rotation, cleanup, and failure isolation. Any future pool must still re-resolve credentials per operation and invalidate immediately on settings or credential changes.

## New-mail reminders (optional)

Reminders are a switchable feature of this plugin and are off by default: while off there is no connection and no timer. When on:

- the inbox is probed with `STATUS` at `notifyIntervalSeconds` (30–3600, 120 by default); probing is read-only and does not change the selected mailbox;
- the watermark (`UIDVALIDITY` plus the next `UID`) is kept in memory per account and folder, so switching either never mixes them; a `UIDVALIDITY` change re-baselines instead of reporting renumbered mail as new;
- new mail is fetched as envelopes only. The body excerpt comes from `download()` on the text part and is **cut at the download stage** to 64 KiB, and `notifyExcerptChars` (0–400, 160 by default) decides how much is shown, so a huge message or a message with large attachments is never buffered whole;
- only a `readOnly` mailbox lock is taken: no `\Seen`, no move, no delete, and cancellation or failure releases the stream, the lock, and the connection;
- content is published through the notification protocol (`source: mail`, event `new-mail`): the subject is the title, `preview` is "sender · excerpt", `target` holds only folder and uid. No model summarisation, and no mail HTML reaches the renderer;
- a failed publish is logged once and the watermark still advances, so one UID cannot become a retry storm. Turning the switch off, changing the account, or disposing the plugin closes the session and unregisters the notification source.

Reminders only exist while the app runs: the first probe after startup records the current position, so mail from the closed period is not replayed. Multiple accounts remain future work; the current implementation buckets by the configured account and the UI shows one account at a time.

## Binary boundary

Outbound attachments use `ctx.fs`: resolve from the session `cwd`, verify containment, require a regular file, enforce an aggregate size bound, then use bounded `readBytes`.

The Host artifact embeds the IMAP/SMTP and mail parsing libraries in a separate bundled module, loaded on the first mail tool execution. The startup entry still registers settings, tools, and permission checks. Users do not install a second protocol runtime after npm, source-package, or offline-product installation.

DSH `0.2.1-rc.2` does not expose `writeBytes`. Attachment download therefore requires a local Host filesystem. The plugin resolves the logical destination with `ctx.fs`, creates the directory, resolves real workspace and directory paths, rechecks containment to reject pre-existing symlinks or junctions, and finally performs a random-name `wx` exclusive write. Replace this local adapter when DSH provides an official binary-write seam.

## Extension rules

- OAuth2 requires a separate authentication adapter; tokens never belong in settings.
- Multiple accounts require independent Credential Keys/Refs and an explicit account parameter; YAML must not carry passwords.
- Background polling is only allowed in this plugin in the shape of new-mail reminders: opt-in, read-only, envelopes plus a bounded excerpt, no model call. Any new background job must keep the same boundary and regressions.
- Auto-reply, move, delete, and flag mutation remain separate high-risk product boundaries.
- Background or scheduled sending requires an explicit deployment mode and recipient allowlist. Interactive Full Access cannot silently become background authorization.
