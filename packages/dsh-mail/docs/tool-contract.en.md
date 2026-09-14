# Tool contract

[简体中文](tool-contract.md) | **English**

## `mail_list_folders`

No input. Performs IMAP `LIST` and returns exact `path`, display name, delimiter, special-use marker, subscription state, and selectability. Historical mail may live in Archive, All Mail, or a provider-specific folder; callers use returned paths rather than guessing names.

The result is capped at 200 folders. `truncated=true` means the server reported more. The call does not open a mailbox or change message state.

## `mail_find`

The first call accepts optional `query`, `folder`, `limit` (1–50), `unreadOnly`, `since`, `until`, and `order` (`newest` or `oldest`). `folder` should be an exact path from `mail_list_folders`. Dates use the mail server's calendar-date semantics. `query` searches sender, recipients, CC, and subject on the server; it does not download bodies or build a local index.

Output includes `folder`, `order`, total `matched`, page `returned`, `hasMore`, optional `nextCursor`, and message rows. Each row contains an opaque handle, time, addresses, subject, unread and attachment indicators, and the server-reported size. Every string is untrusted mail data.

When `hasMore=true`, the next call supplies only `cursor=nextCursor` and optionally changes `limit`. Do not repeat or alter original filters. The cursor already binds folder, UIDVALIDITY, direction, boundary, and all filters. A UIDVALIDITY change invalidates the cursor and requires a new first call.

Tasks claiming a complete date range or “all related mail” must continue until `hasMore=false`. Search is per folder; query relevant archive folders separately.

## `mail_read`

Input is a message handle returned by `mail_find`. The tool validates folder, UIDVALIDITY, and UID; checks the whole-message size bound; then parses a plain-text body. HTML becomes plain text only when no text part exists, and remote resources are never loaded.

Output contains headers, `untrustedText`, a truncation flag, and opaque attachment handles. The call never writes flags.

## `mail_get_attachment`

Input is an attachment handle from `mail_read`. The tool revalidates the message and live MIME part and streams with a size cap.

Output contains a random workspace path, sanitized filename, MIME type, and actual size. The destination is fixed below `.dsh-mail-assistant/attachments/`. Before a native write the plugin resolves real paths and rechecks containment, then exclusively creates the file. It neither follows a pre-existing directory link outside the workspace nor overwrites an existing file.

## `mail_send`

Required input: `to[]`, `subject`, and `text`. Optional: `cc[]`, `bcc[]`, `attachments[]`, and `replyTo`. The tool sends plain text only. Addresses reject CR/LF; at most 50 addresses and ten attachments are accepted; attachments must be regular files in the current workspace and stay within the configured aggregate bound.

DSH's native `tools/pre-execute` waterfall decides permission. Ordinary presets request one approval; Full Access proceeds directly. Permission handling occurs before credentials, files, or SMTP access, and the independent sending capability must be enabled in either mode. `replyTo` only reads the original Message-ID to build `In-Reply-To`/`References`; recipients, subject, and body remain explicit.

Result status:

- `sent`: SMTP returned definite success;
- `unknown`: a connection-level failure occurred during DATA and the server may already have accepted the message.

Callers must never automatically retry `unknown`. Tool parameters do not provide a private approval bypass, and mail content is never interpreted as authorization.
