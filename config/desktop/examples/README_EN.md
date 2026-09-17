# Desktop configuration examples

[简体中文](README.md)

The default total model-request concurrency is 3. Main conversations, subagents and auxiliary model requests share this limit; excess requests queue. Change it immediately in Settings → General → Total model-request concurrency. Top-level `features.maxConcurrentRequests` sets the distribution default (1–64); file changes require a restart, and a saved user preference takes priority. Legacy `maxParallelSubagents: 2` maps to a total of 3.

## Choose an example

- [Organization](organization.jsonc): oidc-llm Token authorization and model catalog, only for builds containing this branch’s feature; not in existing Releases.
- [LiteLLM](litellm.jsonc): native OAuth discovery and model access, only for builds containing this branch's feature; not in existing Releases. See the [gateway guide](../../../packages/dsh-oidc/docs/gateway-auth/README_EN.md).
- [Media](media.jsonc): configurable image generation and cloud TTS.
- [Updates](updates.jsonc): update channels and static HTTPS manifests.
- [Default configuration](../eduwork.jsonc): the initial public-edition configuration.

The installed configuration is `config/eduwork.jsonc`; examples are in `config/examples/`. Fill in deployment values such as the public Client ID, then choose Exit from the tray and restart. Closing the window alone normally keeps the process running.

The Windows public edition defaults to GitHub updates. Use `provider: "github"` with `repository: "ecnu/EduWork"`, or configure a static HTTPS `manifestURL` to override the default. `provider: "disabled"` disables online updates. GitHub uses anonymous requests for published public releases; the development channel also accepts matching prereleases. Do not supply a Token or use a Release HTML page as a static manifest.

For a configuration-only overlay of a CI archive, see the [build guide](../../../docs/BUILD.md#从-ci-原包装配机构配置). The overlay supports inherited defaults, GitHub, static HTTPS and disabled updates.

## Identity and models

`organizations` may be empty. Users can still configure a personal API Key in the model settings. For identity-only login, configure `oidc` and omit `auth` and `provider`. Model access uses `auth` gateway discovery and Tokens. Legacy `keyBinding` configuration has been removed; standard OIDC alone does not supply a model catalog.

Each organization needs a unique stable `id`. Model organizations also require distinct `provider.id` values. The model API URL comes from validated discovery.

Passwords, API Keys, client secrets and login tokens must not be included in examples. The shared Host stores login Tokens through the local protected credential service, isolates them per organization and refreshes them automatically. Personal provider credentials remain independently managed.

Distribution model-capability corrections apply only to recognized managed configurations. They do not overwrite the administrator's file, personal providers or the user's default model choice. Server discovery remains authoritative; the public edition does not carry institution-specific correction rules.

## Branding and extensions

Names and interface logos are configurable. Logo paths are relative to the configuration file, normally under `config/assets/`. Executable icons and application IDs require assembly. Updates preserve the user's configuration, assets and data.

Institution-specific examples and adapters are maintained by [EduWork@ECNU](https://github.com/ecnu/EduWork-ECNU). Configuring an institution's URL does not install its plugins into the public edition.
