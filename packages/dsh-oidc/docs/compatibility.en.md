# Compatibility and release policy

[简体中文](compatibility.md) | **English**

## Runtime requirements

The 0.2.x source targets DSH `0.1.5-rc.1`, Cordis `4.0.2` and pi-ai `0.85.1`. Use Node.js 22 or 24 and the checked-in lockfile for development. Align all DSH packages in the host; a retained peer range does not establish support for every deployment.

The older stable 0.1.0 package targets DSH 0.1.2-rc.1. Check the host before upgrading. See [development](development.en.md) for dependency and integration checks.

## Contract versions

- Enterprise Profile: `dsh-oidc/v1alpha1`
- Key Binding Profile selector: `worker-user-center-v1` or `eduwork-resources-v1`; accepted Bootstrap wire aliases: `worker.user-center.v1`, `worker-user-center/v1`, `eduwork-resources/v1`
- Typert package/namespace: `@eduwork/dsh-oidc` / `oidcAccounts`
- Browser management projection: `dsh-oidc/management/v1alpha1`
- Callback path: `/oauth/callback`
- Provider transform service: `enterpriseTransforms`
- Legacy-compatible Provider settings namespace: `provider-enterprise`

Changing any item above requires compatibility analysis and, where wire-visible, a new contract version.

## Project semver

Before `1.0.0`, minor versions may contain incompatible alpha contract changes, but release notes and migration instructions are required. Patch versions must be backward compatible within the same documented contract version.

After `1.0.0`:

- additive optional profile fields and error codes may be minor releases;
- removing/renaming fields, changing fixed paths, callback path, default credential derivation, or identity rules requires a major release or a separately versioned contract;
- security hardening that rejects previously accepted unsafe input may ship in a minor or patch release with prominent notice.

## Release gates

No public tag/npm publish until all of the following pass:

- `npm ci` from a clean checkout;
- `npm run check` on Windows and Linux;
- CodeQL or equivalent static analysis;
- dependency/license and install-script review;
- secret/production-endpoint scan;
- npm tarball content review;
- plain Web end-to-end acceptance;
- native desktop no-regression acceptance;
- OIDC negative tests and Key Binding authorization tests;
- documentation/version/changelog update;
- independent technical review, CI/focused regression evidence, and a recorded maintainer decision for authentication, credential, build, or release workflow changes; add independent human approval after a second maintainer joins.

See [the public release checklist](release-checklist.en.md) for the operator checklist.
