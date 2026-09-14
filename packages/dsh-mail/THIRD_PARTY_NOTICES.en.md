# Third-party notices

[简体中文](THIRD_PARTY_NOTICES.md) | **English**

`dsh-mail-assistant` is distributed under the MIT License. Its build uses or embeds:

- [ImapFlow](https://github.com/postalsys/imapflow) — MIT License — IMAP client;
- [Nodemailer](https://github.com/nodemailer/nodemailer) — MIT-0 License — SMTP message submission;
- [MailParser](https://github.com/nodemailer/mailparser) — MIT License — MIME parsing;
- [`@deepseek-ai/schemastery`](https://github.com/deepseek-ai/deepseek-harness/tree/main/vendor/schemastery) — MIT License — DSH settings-schema implementation;
- [React](https://github.com/facebook/react) — MIT License — DSH Client settings surface (peer dependency).

The project was informed by the MIT-licensed integration approach in [`STARDUSTLC666/dsh-email`](https://github.com/STARDUSTLC666/dsh-email), but redesigns the permission, credential, read-only IMAP, workspace, untrusted-content, and approval boundaries. No third-party project endorses this plugin.

Exact direct and transitive versions are recorded in `package-lock.json`. Review the lockfile, license-check output, and final npm tarball before every public release.
