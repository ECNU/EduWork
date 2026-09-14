# Security policy

[简体中文](SECURITY.md) | **English**

## Supported versions

The supported release line is `0.1.x`; security fixes are applied to its latest release. Alpha versions before `0.1.0` remain available for migration and historical reproduction but do not receive routine fixes.

## Reporting a vulnerability

Do **not** open a public issue for a suspected vulnerability, leaked secret, private endpoint, identity mix-up, credential exposure, or authorization bypass.

Submit reports privately through GitHub [Private Vulnerability Reporting](https://github.com/ecnu/EduWork/security/advisories/new). Do not disclose vulnerability details, real credentials, or personal data in a public issue, discussion, pull request, or log attachment. If the private reporting entry is unavailable, open only a detail-free public issue asking maintainers to check the security-reporting configuration.

Include, where safe:

- affected version/commit and DSH version;
- deployment topology (Web/native, single-user/shared, Credential Provider);
- reproduction steps or proof of concept;
- impact and whether secrets or personal data were accessed;
- logs with tokens, cookies, API keys, subjects, and internal hosts redacted;
- suggested mitigation or embargo constraints.

Maintainers aim to acknowledge a complete report within three business days, provide an initial assessment within seven business days, and coordinate disclosure after a fix is available. These are response targets, not a legal or service-level commitment.

## In scope

- OIDC state/nonce/PKCE/token validation and callback handling;
- identity confusion between ID Token, UserInfo, bootstrap, profiles, or native backend;
- Key Binding authorization, Provider binding, idempotency, or API-key exposure;
- credential storage/resolution and cross-user or cross-profile isolation;
- profile validation bypass or remote code/style execution;
- client loader, branding, XSS, open redirect, SSRF, or unsafe URL handling;
- dependency/build/release supply-chain compromise.

## Out of scope

- vulnerabilities solely in an unmodified upstream DSH/pi-ai/Node dependency (report upstream, but notify this project if exploitable here);
- an operator intentionally publishing secrets in a profile despite documented prohibitions;
- unsupported shared multi-user deployment using a global/file-backed Credential Provider;
- social engineering, physical attacks, or denial-of-service requiring unrealistic traffic, unless a low-cost amplification exists.

## Handling secrets

Never attach real tokens, keys, cookies, user records, production profiles, or raw session exports to an issue. If a repository secret is discovered, revoke/rotate it first; deleting Git history alone is not remediation.
