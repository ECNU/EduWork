# Compatibility and known limits

[简体中文](compatibility.md) | **English**

`@eduwork/dsh-mail@0.2.0` targets official DeepSeek Harness `0.2.1-rc.2` with peer range `>=0.2.1-rc.2 <0.3.0-0`; older DSH Hosts must keep the earlier plugin. See [migration](EDUWORK-MIGRATION.en.md) for the old unscoped package.

## Reviewed baseline

- DeepSeek Harness `0.2.1-rc.2` (current release baseline);
- Node.js 24.18+;
- dynamic Web Client Bundle;
- local Host filesystem;
- IMAP4rev1/IMAP4rev2 and SMTP Submission with username plus password/app-password authentication.

The DSH Profile provides `settings`, `credentials`, `tools`, `permissionPresets`, `approval`, and `fs`. The settings page also depends on official Remotes, Renderer, and Settings Client packages. Ordinary sending requires an interactive approval path; Full Access does not prompt.

DSH `0.2.1-rc.2` requires plugins to use the Agent explicitly from tool execution context. Mail reads the current session from each execution's `exec.agent`, uses `agent.session` for permission presets and workspace resolution, does not depend on a global Agent, does not create or resume Sessions, and does not use ordinary subprocess handles. The ToolRuntime, Permission Presets, Credentials, Settings, Renderer, and Settings Client seams are accepted.

The official generic-file upload, Workspace Files, and `readByteRange()` can support future large-attachment improvements, but they cannot yet replace the Host binary write needed for IMAP downloads: `ctx.fs` still has no `writeBytes()`. This version therefore retains the local download adapter with workspace containment, real-path revalidation, and exclusive random filenames.

## Protocol scope

- IMAP uses read-only mailbox semantics and UIDVALIDITY to reject stale UIDs.
- SMTP supports implicit TLS and STARTTLS, never plaintext.
- XOAUTH2/OIDC mailbox login is not implemented. Gmail, Microsoft 365, and similar providers work only when tenant policy permits app passwords and SMTP AUTH.
- The plugin does not append a copy to the IMAP Sent folder; server policy decides whether sent mail is retained.
- S/MIME, PGP, calendar invitations, and nested `message/rfc822` are treated as ordinary MIME data without specialized semantics.

## DSH binary-write limitation

The current DSH `0.2.1-rc.2` release baseline exposes `ctx.fs.readBytes` but no `writeBytes`:

- outbound local attachments use the official seam end to end;
- downloads require `ctx.fs.processPath()` and the Host Node process to share one filesystem;
- after creating the destination directory the plugin resolves real paths and rechecks workspace containment;
- E2B, remote containers, and other non-shared Filesystem Providers should disable or expect a clear `mail_get_attachment` failure;
- migrate to the official binary-write API and remove the local adapter when one becomes available.

## Version policy

The plugin follows its own SemVer instead of mirroring the host product: patch for compatibility fixes and dependency maintenance, minor for backward-compatible capability additions, and major only for breaking tool or configuration contracts. During DSH `0.x`, run the full automated suite and target-runtime acceptance for every upgrade, then complete IMAP/SMTP interoperability in an isolated Profile. Compilation alone is insufficient.
