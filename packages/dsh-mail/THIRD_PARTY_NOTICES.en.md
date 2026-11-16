# Third-party notices

[简体中文](THIRD_PARTY_NOTICES.md) | **English**

`dsh-mail-assistant` uses Mulan PSL v2 for new original contributions and preserves historical MIT grants; see [LICENSING.md](LICENSING.md). Its build uses or embeds:

- [ImapFlow](https://github.com/postalsys/imapflow) — MIT License — IMAP client;
- [Nodemailer](https://github.com/nodemailer/nodemailer) — MIT-0 License — SMTP message submission;
- [MailParser](https://github.com/nodemailer/mailparser) — MIT License — MIME parsing;
- [`@deepseek-ai/schemastery`](https://github.com/deepseek-ai/deepseek-harness/tree/main/vendor/schemastery) — MIT License — DSH settings-schema implementation;
- [React](https://github.com/facebook/react) — MIT License — DSH Client settings surface (peer dependency).

The project was informed by the MIT-licensed integration approach in [`STARDUSTLC666/dsh-email`](https://github.com/STARDUSTLC666/dsh-email), but redesigns the permission, credential, read-only IMAP, workspace, untrusted-content, and approval boundaries. No third-party project endorses this plugin.

Exact direct and transitive versions are recorded in `package-lock.json`. Review the lockfile, license-check output, and final npm tarball before every public release.

Starting with 0.2.3, `lib/bundled-dependencies.json` in the npm package records dependencies actually included in the JS outputs (including nested versions), npm integrity, license identifiers and output SHA-256 hashes. It is generated from build sources and excludes development dependencies absent from the bundle.

The development-only official DSH Host includes LibreOffice Kit 0.2.3 (MPL-2.0), sharp/libvips native packages (Apache-2.0 / LGPL-3.0-or-later), and lru-cache 11.5.3 ([Blue Oak Model License 1.0.0](https://blueoakcouncil.org/license/1.0.0)). They are not bundled in the mail plugin archive; their license files remain with their own packages. Checks accept only the reviewed development-dependency versions.
