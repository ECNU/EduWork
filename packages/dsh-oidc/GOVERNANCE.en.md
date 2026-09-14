# Governance

[简体中文](GOVERNANCE.md) | **English**

## Project ownership

`dsh-oidc` is initiated and hosted by [@freedomkk-qfeng](https://github.com/freedomkk-qfeng). The project remains institution-neutral: an institution's names, trademarks, service addresses, and Client IDs belong only in authorized deployment configuration and must not become protocol defaults.

## Roles

- **Maintainers** merge ordinary changes, triage issues, and manage compatibility.
- **Security maintainers** review authentication, authorization, credential, build, and release changes and handle private reports.
- **Release managers** control tags, npm publishing, release evidence, provenance when available, and rollback.

The current roster is in [`MAINTAINERS.en.md`](MAINTAINERS.en.md). One maintainer currently holds all three roles and there is no backup. Release/security-recovery backups, role separation, and a second human reviewer are future governance goals. Current releases must accurately record independent technical review, CI/regression evidence, known limitations, and the maintainer's decision.

## Decision process

- Ordinary implementation decisions use pull-request review.
- Public contract, trust-boundary, dependency strategy, or governance changes require an Architecture Decision Record in `docs/decisions/`.
- Backward-incompatible changes require migration documentation and the versioning process in `docs/compatibility.en.md`.
- Maintainers seek rough consensus; unresolved security and interoperability concerns block release until addressed or explicitly accepted in a documented decision.

## Review and merge

- The current maintainer approves ordinary documentation, test, and UI changes through a reviewable pull-request record.
- OIDC, Key Binding, Profile validation, secrets, native boundaries, workflows, dependencies, and releases require independent technical review plus CI and focused regression evidence. The maintainer explicitly accepts findings and exceptions in the pull request or release record.
- There is no second human maintainer today, so the project must not claim two-person approval. Add independent human approval for security-sensitive changes after the maintainer roster expands.
- CI must be enabled on the public remote. Required human review and branch protection should be enabled when repository permissions and the maintainer roster support them; a direct merge during the initial single-maintainer phase must retain check results and decision rationale.

## Releases

- During the initial phase, the current maintainer also acts as release manager. Tags and npm packages are created only after `docs/release-checklist.en.md` is completed and its evidence and exceptions are recorded.
- npm Trusted Publishing/OIDC with provenance is the preferred target process. Until a Trusted Publisher is configured, the first stable release may use the npm CLI and maintainer-confirmed browser 2FA to publish the verified frozen tarball. That path must not claim provenance or write a long-lived token into the repository, logs, or deliverables.
- After Trusted Publishing is configured, releases should move to protected tags and the approved workflow, and provenance is recorded only when an npm attestation actually exists.
- A release record includes checksums, compatibility matrix, changelog, known limitations, and rollback guidance.
- A compromised or unsafe release is deprecated promptly; secrets are rotated and users are notified through the security policy.

## Branding and neutrality

The project may document ECNU as a reference implementation while keeping the protocol institution-neutral. Merging another organization's example does not imply endorsement. Trademarks and logos require their owners' permission and are not granted by the MIT code license.
