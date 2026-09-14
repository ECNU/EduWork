# Desktop configuration examples

[简体中文](README.md)

The default total model-request concurrency is 3. Main conversations, subagents and auxiliary model requests share this limit; excess requests queue. Change it immediately in Settings → General → Total model-request concurrency. Top-level `features.maxConcurrentRequests` sets the distribution default (1–64); file changes require a restart, and a saved user preference takes priority. Legacy `maxParallelSubagents: 2` maps to a total of 3.

## Choose an example

- [Organization](organization.jsonc): enterprise identity, model credentials and model catalog.
- [Media](media.jsonc): configurable image generation and cloud TTS.
- [Updates](updates.jsonc): update channels and static HTTPS manifests.
- [Default configuration](../eduwork.jsonc): the initial public-edition configuration.

The installed configuration is `config/eduwork.jsonc`; examples are in `config/examples/`. Fill in deployment values such as the public Client ID, then choose Exit from the tray and restart. Closing the window alone normally keeps the process running.

The Windows public edition defaults to GitHub updates. Use `provider: "github"` with `repository: "ecnu/EduWork"`, or configure a static HTTPS `manifestURL` to override the default. `provider: "disabled"` disables online updates. GitHub uses anonymous requests for published public releases; the development channel also accepts matching prereleases. Do not supply a Token or use a Release HTML page as a static manifest.

For a configuration-only overlay of a CI archive, see the [build guide](../../../docs/BUILD.md#从-ci-原包装配机构配置). The overlay supports inherited defaults, GitHub, static HTTPS and disabled updates.

## Identity and models

`organizations` may be empty. Users can still configure a personal API Key in the model settings. For identity-only login, omit both `keyBinding` and `provider`; standard OIDC alone does not provision model keys or a catalog. Those capabilities require the resource protocol.

Each organization needs a unique stable `id`. Managed-model organizations also require distinct `provider.id` values matching their servers’ bootstrap responses. Changing only the client Provider ID cannot resolve a collision; use distinct server routes or separate client configurations.

Passwords, API Keys, client secrets and login tokens must not be included in examples. Enterprise login stores its credential through the local protected credential service under `EDUWORK_API_KEY`. Personal provider credentials remain independently managed.

Distribution model-capability corrections apply only to recognized managed configurations. They do not overwrite the administrator's file, personal providers or the user's default model choice. Server discovery remains authoritative; the public edition does not carry institution-specific correction rules.

## Branding and extensions

Names and interface logos are configurable. Logo paths are relative to the configuration file, normally under `config/assets/`. Executable icons and application IDs require assembly. Updates preserve the user's configuration, assets and data.

Institution-specific examples and adapters are maintained by [EduWork@ECNU](https://github.com/ecnu/EduWork-ECNU). Configuring an institution's URL does not install its plugins into the public edition.
