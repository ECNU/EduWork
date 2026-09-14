# Development and release preparation

[简体中文](development.md) | **English**

The plugin version is `0.2.3`. Its development baseline is DSH `0.1.5-rc.1`, Cordis `4.0.2`, and pi-ai `0.85.1`. Product versions do not determine plugin versions; consult the registry for npm publication status. Source is maintained in EduWork; migration does not overwrite published npm packages.

## Verify a clean checkout

Use Node.js 22 or 24 in `EduWork/packages/dsh-oidc`:

```sh
npm ci
npm run check
```

The manifest declares exact development dependencies for the required DSH test closure, and the lock records public-registry URLs and integrity. Upstream prerelease carets may select a later RC, so pinning only direct peers is insufficient. `check:lock` rejects mixed versions, machine paths and missing integrity; `check:dsh` verifies the actually loaded baseline. Do not substitute junctions into a running desktop for a clean installation, or suppress conflicts with `--force` or `--legacy-peer-deps`.

This is the plugin's development/CI closure, not a full desktop product. Consumers still reuse the host through peerDependencies. The [compatibility matrix](compatibility.en.md) distinguishes historical evidence; a historical peer declaration does not mean every old combination was rerun for each commit.

The complete check covers TypeScript, the dependency lock and official contracts, Host/Client builds and loading, Node tests, schemas/examples, document links, sensitive-data/license scans, and package inspection. Optional `npm run check:browser` uses Playwright Core with a locally installed Edge/Chrome; `DSH_OIDC_BROWSER_CHANNEL` selects the installed channel (default `msedge`). It downloads no browser and does not replace real distribution login acceptance.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/host/profile.js` | Trusted Profile, bounded branding/models and common credential reference |
| `src/host/oidc.js` | PKCE, Token/UserInfo, Key Binding, sessions and credential ownership |
| `src/host/desktop-oidc.js` | Temporary loopback login shared by both desktop shells |
| `src/host/resources.js` | Conservative model-catalog normalization |
| `src/host/provider/` | Official PiAi Provider and explicit image-transform boundary |
| `src/host/index.js`, `typert.*.js` | Host service, official lifecycle and public RPC |
| `src/client/` | Official settings slots, account/login UI and bounded branding |
| `test/` | Synthetic IdP/gateway, HTTP, Host, migration and race regressions |
| `schema/`, `protocol/` | Profile Schema and implemented resource HTTP contracts |

`scripts/build-host.mjs` copies native Host ESM to `lib`; tsdown bundles the Client. Do not edit `lib` by hand. New wire fields require corresponding implementation, Schema/OpenAPI, bilingual documentation and contract tests. Avoid mechanical tests for simple presentation/documentation changes.

## Extensions and publication

The public package owns identity, managed keys, model discovery/inference and their account UI. Quota, heartbeat, campus search and speech business services belong in institution/product plugins. [Account extensions](account-extensions.en.md) are Host transport and slot contracts, not hidden institution-feature switches. Examples contain placeholder domains, public client IDs and no secrets.

Module checks and publication use the [shared EduWork workflow](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES_EN.md). Validate deployment-specific sign-in separately; published npm versions are immutable.

Reasoning-field compatibility and its regression checks are documented in [Reasoning replay compatibility](reasoning-replay.en.md). The guide distinguishes a source fix from the installed npm package.
