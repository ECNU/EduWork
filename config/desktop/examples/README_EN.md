# Desktop configuration examples

[简体中文](README.md)

The public edition does not download institution configuration by default. These examples ship with the application; the active file is the `eduwork.jsonc` opened by **Settings → Open configuration file**. Editing a file in `examples/` alone has no effect. JSONC supports comments, and the end of each file contains a commented reference for all options.

Active file, the single backup, and UAT setup: [configuration guide](https://github.com/ECNU/EduWork/blob/main/docs/CONFIGURATION_EN.md).

## Choose an example

- [LiteLLM](litellm.jsonc): sign in with a LiteLLM gateway account and use its models; follow the steps below.
- [Organization](organization.jsonc): institution oidc-llm authorization and model access, requiring an administrator-provided public Client ID; the protocol remains experimental.
- [Media](media.jsonc): configurable image generation and cloud TTS.
- [Updates](updates.jsonc): update channels and static HTTPS manifests.
- [Configuration one directory above](../eduwork.jsonc): fully commented. In an installation, use the file opened by Settings; in the source tree, this file is a template.

Both gateway login methods are included in **EduWork 0.3.6-dev.20260921.1**, without installing another plugin. The LiteLLM protocol baseline is **v1.101.0 / native contract 1**; verify compatibility for other server versions.

## Connect LiteLLM: where to edit and what to enter

1. Ask the gateway administrator for the complete discovery URL, for example `https://gateway.example.org/.well-known/litellm-cli-auth`. It must return JSON. The gateway needs native CLI OAuth enabled and models assigned to your account. See [server preparation](https://github.com/ECNU/EduWork/blob/main/packages/dsh-oidc/docs/gateway-auth/litellm-setup.en.md).
2. Open the active configuration from Settings, then open the adjacent `examples/litellm.jsonc`. Add the object from the example's `organizations` array to the same array in the active file. Fill an empty array or append to existing organizations; do not overwrite media, update, or plugin settings with the entire example.
3. Change the fields below and keep the other example values. LiteLLM **registers its Client ID automatically: do not fill in `clientId`, `client_secret`, or an API Key**. The model API address and catalog are discovered automatically.
4. Save, select Exit from the tray or application menu, and restart EduWork. Closing the window alone may leave it running.
5. Select your configured organization in the account menu. Sign in through the system browser, choose a team if requested, and approve access. Return to EduWork, choose an authorized model, and send a message in a new conversation.

| Example field | What to enter |
| --- | --- |
| `id` | A unique local identifier such as `my-litellm`; keep it stable. This is not a server-issued Client ID. |
| `displayName` | The account menu label, such as “Company model gateway”. |
| `auth.discoveryUrl` | The full URL including `/.well-known/litellm-cli-auth`, not `/ui` or `/v1`. |
| `auth.expectedIssuer` | The exact `issuer` value from discovery, usually `https://gateway.example.org`. |
| `allowInsecureDevelopment` | Keep `false` for HTTPS; set `true` for HTTP testing. It belongs in the organization object beside `auth`. |

For a gateway on local port 4000, use `http://127.0.0.1:4000/.well-known/litellm-cli-auth`, issuer `http://127.0.0.1:4000`, and set the HTTP switch to `true`. `127.0.0.1` means the computer running EduWork; use the administrator-provided reachable address for a remote gateway.

| Platform | Active public-edition configuration |
| --- | --- |
| Windows | `<application directory>/config/eduwork.jsonc` |
| macOS | `~/Library/Application Support/eduwork-electron/config/eduwork.jsonc` |

The `examples/` folder is beside the active file. On macOS, first launch copies examples into the user configuration directory; do not edit files inside `.app`. If models are missing, check account/team permissions. A working web login alone does not mean CLI OAuth is enabled.

## Other settings

The default total model-request concurrency is 3 across the current Host. Main conversations, subagents and auxiliary model requests share it; excess requests queue. Other clients and independent media endpoints are outside this limit. Change it immediately in Settings → General → Total model-request concurrency.

On DSH 0.1.7-rc.2, the default active subagent count is 2. Plugins → Subagent controls this count across all recursive levels under one main agent; the main agent is excluded. New subagents are rejected at capacity. This is separate from request concurrency, with no reserved main-agent request slot.

Use `"features": { "maxConcurrentRequests": 3, "maxActiveSubagents": 2 }` in `eduwork.jsonc` for the two defaults (each 1–64). File changes require a restart. Values already saved in the UI take priority, including values equal to an old default. Legacy `maxParallelSubagents: 2` still maps only to a total request concurrency of 3. DSH 0.1.5 does not use `maxActiveSubagents`.

Signed configuration updates may deliver these defaults through `features`, preserving local edits. An update with the new field must require a client version that supports it and DSH 0.1.7-rc.2; do not target older clients.

The Windows public edition defaults to GitHub updates. Use `provider: "github"` with `repository: "ecnu/EduWork"`, or configure a static HTTPS `manifestURL` to override the default. `provider: "disabled"` disables online updates. GitHub uses anonymous requests for published public releases; the development channel also accepts matching prereleases. Do not supply a Token or use a Release HTML page as a static manifest.

For a configuration-only overlay of a CI archive, see the [build guide](https://github.com/ECNU/EduWork/blob/main/docs/BUILD.md#从-ci-原包装配机构配置). The overlay supports inherited defaults, GitHub, static HTTPS and disabled updates.

## Identity and models

`organizations` may be empty. Users can still configure a personal API Key in the model settings. For identity-only login, configure `oidc` and omit `auth` and `provider`. Model access uses `auth` gateway discovery and Tokens. Legacy `keyBinding` configuration has been removed; standard OIDC alone does not supply a model catalog.

Each organization needs a unique stable `id`. Explicit `provider.id` values must also be unique. The model API URL comes from validated discovery.

Passwords, API Keys, client secrets and login tokens must not be included in examples. The shared Host stores login Tokens through the local protected credential service, isolates them per organization and refreshes them automatically. Personal provider credentials remain independently managed.

Distribution model-capability corrections apply only to recognized managed configurations. They do not overwrite the administrator's file, personal providers or the user's default model choice. Server discovery remains authoritative; the public edition does not carry institution-specific correction rules.

## Branding and extensions

Names and interface logos are configurable. Logo paths are relative to the configuration file, normally under `config/assets/`. Executable icons and application IDs require assembly. Updates preserve the user's configuration, assets and data.

Institution-specific examples and adapters are maintained by [EduWork@ECNU](https://github.com/ecnu/EduWork-ECNU). Configuring an institution's URL does not install its plugins into the public edition.
