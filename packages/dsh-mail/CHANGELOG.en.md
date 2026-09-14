# Changelog

[简体中文](CHANGELOG.md) | **English**

## 0.1.1 - 2026-09-11

- Added exact peer support for official DeepSeek Harness `0.1.5-rc.1` and accepted the Tool/Agent, Session, Permission Presets, Filesystem, Credentials, Settings, and Web Client seams.
- Preserved read-only IMAP, disabled-by-default read/send capabilities, per-send approval under ordinary permissions, Full Access approval exemption only, untrusted mail content, and workspace-fenced attachments.
- Updated Nodemailer to `9.1.0` and Mailparser to `3.9.23` to address upstream security issues in address parsing, domain validation, and content resolution.
- Completed installation, configuration, acceptance, development, and known-limit documentation for `0.1.5-rc.1`.

## 0.1.0 - 2026-09-06

- Updated the compatibility baseline to DeepSeek Harness `0.1.2-rc.1` while preserving the Host export, Profile row id, settings namespace, security scope, credential reference, and attachment-directory contracts.
- Migrated the settings page to the DSH Client `settingsScope` API with atomic mutations, revision fencing, and read-only-state handling.
- Aligned settings schemas with DSH on `@deepseek-ai/schemastery` `3.18.2` and removed the `legacy-peer-deps` install setting that could hide peer conflicts.
- Expanded CI to Windows/Linux on Node.js 22/24. Added a manual release workflow that checks and packs by default and prepares stable-tag and same-commit CI validation for later npm Trusted Publishing/OIDC enablement.
- Aligned public documentation with the stable security status, `settingsScope` architecture, current sole-maintainer governance, and the first-release npm CLI plus browser-2FA process. This release makes no provenance claim; Trusted Publishing remains a later path.
- Included the bilingual contribution, governance, maintainer, support, and code-of-conduct documents in the npm package so README-relative links remain valid after installation.

## 0.1.0-alpha.5 - 2026-09-05

- Move the npm identity to `@eduwork/dsh-mail`; update installation/module paths and Client registration together.
- Keep the Host export name, row id, settings namespace and security scope using `dsh-mail-assistant`, as well as `DSH_MAIL_ASSISTANT_PASSWORD` and `.dsh-mail-assistant/attachments`. The Client ModuleLoader uses the new package name.
- Keep the previous unscoped version installable and document Profile migration.

- Removed build-time transitive packages that were mistakenly listed as production dependencies; the Host runtime remains fully embedded in the published artifact.
- Limited Dependabot automation to minor and patch updates for development dependencies; major updates, the DSH compatibility baseline, and `tsdown` minor updates now require manual review.
- Added a publish-manifest assertion to the Host bundle check so external runtime dependencies cannot be reintroduced silently.

## 0.1.0-alpha.4 - 2026-09-01

- First public npm preview.
- Replaced repository placeholders and unpublished-install text with the public repository and exact npm installation path.
- Added GitHub CI, CodeQL, Dependabot, issue/PR templates, governance, and a public-release checklist.
- Added dependency-license, bilingual-documentation, link, secret, and npm-package-content checks.
- Kept IMAP/SMTP runtime libraries inside the Host bundle so consumers do not install a duplicate runtime dependency tree.
- Revalidated real filesystem paths before local attachment writes to reject symlink or junction workspace escapes.

## 0.1.0-alpha.3 - 2026-08-31

- Updated the reviewed baseline to DeepSeek Harness `0.1.2-alpha.2` and `@deepseek-ai/cordis` `4.0.2`.
- Routed `mail_send` through DSH permission presets: ordinary sessions ask per call; Full Access skips prompts only after sending is independently enabled.
- Added read-only `mail_list_folders` for archive and provider-specific folder discovery.
- Added stable cursor pagination, newest/oldest ordering, and `matched`, `returned`, `hasMore`, and `nextCursor` fields to `mail_find`.
- Added bounded IMAP error normalization without exposing remote diagnostics.

## 0.1.0-alpha.2 - 2026-08-30

- Reworked settings around mailbox account, servers, advanced options, and Agent access.
- Preserved the alpha.1 settings schema and credential reference.

## 0.1.0-alpha.1 - 2026-08-29

- Initial internal preview.
- Added `mail_find`, `mail_read`, `mail_get_attachment`, and `mail_send`.
- Established read-only IMAP, DSH Credential storage, independent read/send controls, workspace attachment boundaries, and untrusted-mail fencing.
