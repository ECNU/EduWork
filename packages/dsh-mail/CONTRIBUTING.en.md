# Contributing

[简体中文](CONTRIBUTING.md) | **English**

This project optimizes for a clear mail security boundary, not tool count.

Run `npm ci` and `npm run check`. Compatibility changes must also run against a clean target DSH runtime. For the current `0.1.5-rc.1` baseline, point `DSH_RUNTIME_ROOT` at that exact runtime and run `npm run accept:dsh-015-rc1`. This automated acceptance does not connect to a mailbox or send mail.

Add mailbox-independent automated tests for new behavior; cover cancellation, timeout, bounds, and error normalization for protocol changes; give every mutation an explicit capability, target boundary, and approval policy; update Chinese and English documentation together; and never commit real addresses, messages, app passwords, logs, or personal data.

The plugin follows its own SemVer: use patch for compatibility fixes and dependency maintenance, minor for backward-compatible capability additions, and major only for breaking tool or configuration contracts. Do not mirror the host product's version mechanically. Use a dedicated test mailbox and isolated Profile for interoperability. Do not mix new product boundaries such as delete, move, auto-reply, or polling into corrective pull requests. Report vulnerabilities privately through [SECURITY.en.md](SECURITY.en.md).
