# Changelog

[简体中文](CHANGELOG.md) | **English**

All notable changes are documented here. The format follows Keep a Changelog principles and the project uses Semantic Versioning with pre-1.0 qualifications described in `docs/compatibility.en.md`.

## [0.3.0-dev.2] - 2026-09-21

- Explicitly allow HTTP test services through the single `allowInsecureDevelopment` flag, disabled by default; HTTPS behavior is unchanged.
- Accept the legacy `insecureDevelopmentOrigin` field without requiring a duplicate origin setting.
- Align transport policy across OIDC, OIDC-LLM, LiteLLM and model requests, with documented examples and regression tests.

## [0.2.0] - 2026-09-11

- Target DSH 0.1.5-rc.1 and keep enterprise identity, managed keys and model integration independent of institution services.
- Add desktop OIDC with a temporary loopback callback and host browser integration.
- Use `EDUWORK_API_KEY` as the default credential reference, migrating matching legacy bindings without overwriting an occupied slot.
- Add account-extension transport and UI slots for separately installed institution services.
- Refresh login, account and model-selection state after authentication, with guarded updates during logout.
- Preserve configured reasoning capabilities and model-specific defaults when preparing requests.

## [0.1.0] - 2026-09-06

### Changed

- Updated the exact compatibility baseline to DeepSeek Harness `0.1.2-rc.1` (`a66e4702…`) and stopped claiming current support for the alpha.2 combination that is outside this release acceptance.
- Expanded and locked the DSH peer closure, including the page package that declares `settings.general.item`, so an unlocked host cannot mix alpha.2 and rc.1 packages during npm resolution.
- Audited Credential Provider, Settings, LLM/Pi Provider, WebServer, API Remotes, Typert, and Client page-slot contracts; added the automated `check:dsh` contract check.
- Provider configuration now emits only declared fields and copies them into mutable data accepted by the rc.1 Settings/PiAi schema; reasoning and compat values are constrained to the rc.1 supported sets.
- The Settings section now validates serviceability so schema-shaped values that cannot construct an enterprise Provider are rejected before persistence.
- The Provider wrapper now delegates `imageRequestPricing` and follows rc.1's official attachment-to-read-only execution-path resolution chain.
- Enterprise single brand slots now use an explicit negative priority to shadow rc.1's official brand entries without colliding at default priority 0 and aborting Client initialization.
- Stabilized the npm package version as `@eduwork/dsh-oidc@0.1.0` while retaining `dsh-oidc/v1alpha1`, `oidcAccounts`, credential references, Provider identities, the settings namespace, and user data.
- Expanded CI to a Node.js 22/24 matrix on Windows and Linux and added a manual workflow that checks/packages by default and publishes through npm Trusted Publishing only after explicit authorization.
- Documentation-link and secret scans now explicitly ignore Git-excluded `dist/` acceptance artifacts so local caches cannot change source-check results.
- Release governance now accurately records the initial single-maintainer phase and relies on retained independent technical review, CI/focused regression evidence, and an explicit maintainer decision. Until Trusted Publishing is configured, the first npm publication uses browser 2FA and does not claim provenance.
- The npm package now includes the bilingual code of conduct, contribution, security, support, governance, and maintainer documents so README-relative links do not dangle after installation.
- Test discovery is pinned to the repository's `test/*.test.js`, so Git-ignored local acceptance snapshots cannot change the discovered test set or count.

## [0.1.0-alpha.11] - 2026-09-05

- Move the npm identity to `@eduwork/dsh-oidc`; update installation/module paths and Client registration together.
- Keep `dsh-oidc/v1alpha1`, `oidcAccounts`, credential references, Provider identities and plugin row ids. Host and Client TYPERT package identities change together.
- Keep the previous unscoped version installable and document Profile migration.


## [0.1.0-alpha.10] - 2026-08-31

### Changed

- Updated the compatibility baseline to DeepSeek Harness `0.1.2-alpha.2` (`0a53fb55…`) and `@deepseek-ai/cordis` `4.0.2`.
- Migrated Provider settings integration to alpha.2's official `SettingsProvider.installSection()` API and removed reliance on the retired top-level `installSettingsSection` and `settingsNamespace` exports.
- Completed build, unit, protocol, documentation, secret, and publish-content checks against both the npm and locked source release-pack DSH Runtimes.

## [0.1.0-alpha.9] - 2026-08-31

### Changed

- Removed `catalogPathEnv`, `activeInstitutionEnv`, and all product institution-catalog conversion code. Both Web and native backends now accept only standard Enterprise Profiles; product-owned catalogs must be converted by the product assembly layer first.
- Native `enterpriseAccounts` remains an optional generic host capability interface with no Wails, Electron, or product-data-format dependency.

## [0.1.0-alpha.8] - 2026-08-31

### Added

- Added a bilingual [server API specification](docs/server-integration-contract.en.md) that documents OIDC + PKCE, Key Binding, and the model gateway as one jointly required institutional delivery in API-reference form.
- Completed open-source cleanup of Chinese-default/English documentation, public repository links, maintainers, and the private security-reporting entry point.

### Changed

- Fixed the Web callback to `http://127.0.0.1:<DSH-port>/oauth/callback`; public `publicBaseURL` and DSH WebServer hosts other than `127.0.0.1` are rejected.
- Added optional Enterprise Profile `keyBinding.credentialRef`, allowing production and test to isolate local DSH credentials while retaining one Provider ID and server protocol. Omission preserves Provider-ID derivation, so existing profiles require no migration.
- Host-provided credential references must now enter the same generic Profile field instead of letting a host and Provider independently determine lookup locations.
- Examples and tests now use reserved documentation addresses, and the public main branch does not inherit internal development history.

### Security

- Native hosts now fail closed when their reported credential reference conflicts with the Enterprise Profile, preventing production/test API-key cross-resolution.

## [0.1.0-alpha.7] - 2026-08-30

### Added

- Development-only network HTTP deployments may explicitly allowlist one exact `insecureDevelopmentOrigin`; HTTPS remains mandatory by default and loopback development behavior is unchanged.

## [0.1.0-alpha.6] - 2026-08-29

### Changed

- Updated the compatibility baseline to DeepSeek Harness `0.1.2-alpha.1` and replaced the removed client runtime peer with the public renderer/session-era packages.
- Enterprise model management now extends the upstream Models page through the official `settings.models.footer` slot; the product no longer needs a fork of the complete model settings page.
- Reviewed pi-ai `0.84.4` through the source release-pack Runtime while retaining a compatible `^0.84.2` peer range.

## [0.1.0-alpha.5] - 2026-08-26

### Changed

- Installation documentation now starts from a reviewed local Git checkout and uses a placeholder GitHub organization until repository ownership is decided.
- Clarified that local-path installation links the checkout into the DSH Profile, does not scan the current workspace, and requires the checkout to remain available.
- Registry installation is documented only as a future path after a reviewed npm publication.

## [0.1.0-alpha.4] - 2026-08-26

### Added

- Direct DSH Bundle installation through `dsh plugin --profile web add dsh-oidc`, backed by a package-owned Web-first `cordis.patch.yml`.
- Complete English and Chinese third-party integration guides covering OIDC registration, Key Binding implementation, Enterprise Profile authoring, Web/native composition, production acceptance, and troubleshooting.

### Changed

- Publishable npm tarballs now include the protocol and deployment documentation needed to operate the plugin without a repository checkout.

## [0.1.0-alpha.3] - 2026-08-25

### Added

- A single capability-aware enterprise provider/model settings component for Web and native DSH compositions, registered through DSH's official `settings.section` extension point.
- Versioned `dsh-oidc/management/v1alpha1` browser projection and optional native add/switch/model-edit/restart operations.
- `models-only` UI mode so desktop products can inherit the shared model settings while retaining separate account, quota, update, and diagnostic surfaces.

### Changed

- Plain Web now presents its trusted Enterprise Profile through the same provider/model UI as Desktop, with mutation actions hidden.
- Authenticated accounts that still need a runtime credential receive an explicit confirm-and-connect action instead of repeating OIDC login.

## [0.1.0-alpha.2] - 2026-08-25

### Changed

- Account surfaces now display the standard OIDC UserInfo `name`, falling back to `sub`, while retaining organization branding as secondary context.
- Native desktop adapters are expected to project the same `userName` identity contract as the Web backend; private management-plane bootstrap data must not replace OIDC identity.

## [0.1.0-alpha.1] - 2026-08-25

### Added

- Standalone `dsh-oidc` package with no ChatECNU private-package dependency.
- OIDC Authorization Code + PKCE Web backend and native account adapter.
- Standard UserInfo identity (`name`, fallback `sub`) with subject binding.
- Fixed `worker-user-center-v1` Key Binding client and OpenAPI contract.
- Declarative Enterprise Profile JSON Schema, branding, Provider/model catalog, and ECNU placeholder example.
- Local DSH/PiAi OpenAI-compatible Provider adapter and `enterpriseTransforms` extension seam.
- Chinese/English account UI fallbacks.
- Security, governance, contribution, compatibility, release, and third-party documentation.

### Security

- Exact callback/public-origin handling, same-origin return path, duplicate callback-parameter rejection.
- Multi-audience `azp`, JWK metadata/uniqueness, required time claims, optional `at_hash`, and UserInfo subject validation.
- HTTPS cross-origin Discovery endpoint support with loopback-only HTTP development exception.
- Bounded profile and network response sizes, strict unknown-key rejection, and SVG data-logo rejection.
