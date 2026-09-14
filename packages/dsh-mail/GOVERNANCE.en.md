# Governance

[简体中文](GOVERNANCE.md) | **English**

## Project ownership

`dsh-mail-assistant` is initiated and hosted by [@freedomkk-qfeng](https://github.com/freedomkk-qfeng). It remains provider- and institution-neutral: public code must not embed private servers, accounts, branding, or message samples.

## Roles and decisions

- **Maintainers** merge normal changes, triage issues, and manage DSH and protocol compatibility.
- **Security maintainers** review credentials, read-only IMAP, SMTP sending, attachment paths, and supply-chain changes, and handle private reports.
- **Release managers** control protected tags, npm publishing, provenance, deprecation, and rollback.

The roster is in [Maintainers](MAINTAINERS.en.md). Ordinary decisions use pull requests. Capability boundaries, trust models, dependency strategy, and incompatible changes require a record under `docs/decisions/`. Unresolved credential disclosure, unauthorized sending, message mutation, or workspace escape blocks a release.

## Review and merge

- During the project's initial single-maintainer stage, the current maintainer decides merges and releases and records the decision, CI/regression results, independent technical-review evidence, and remaining risk in the pull request or release record.
- Credential, send-authorization, IMAP mutation, attachment-path, workflow, dependency, and release changes require technical review proportionate to their risk; unresolved security defects still block publication.
- After additional maintainers join, those security-sensitive changes should receive approval from a second human maintainer. This is a future governance goal and does not claim current backup coverage or a second approver.
- The public repository should enable CI, CodeQL, branch protection, and Private Vulnerability Reporting.

## Releases

Release managers create tags and npm releases only after the [public release checklist](docs/release-checklist.en.md). Use OIDC/provenance only after the npm Trusted Publisher repository, workflow, and Environment binding has been verified. Otherwise publish the reviewed frozen artifact with the npm CLI and browser 2FA. No long-lived publish token belongs in the repository or workstation. Unsafe releases are deprecated and users are notified under the [security policy](SECURITY.en.md).

## Product boundary

The project assists with reading and explicit sending; it is not a mail client. Delete, move, archive, flag mutation, background polling, auto-reply, and scheduled sending are separate high-risk boundaries that require their own design and review.
