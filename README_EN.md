<p align="center">
  <img src="assets/eduwork/icon-red.svg" width="72" height="72" alt="EduWork red logo">
</p>

<h1 align="center">EduWork</h1>

<p align="center"><strong>An open AI knowledge workbench.</strong><br><sub>Enterprise sign-in · Open protocols · Knowledge Studio</sub></p>

<div align="center">

[![License: MIT](https://img.shields.io/badge/license-MIT-3DA66B?style=flat-square)](LICENSE) [![Platform: Windows x64 / macOS arm64](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-9f2636?style=flat-square)](#installation-and-use)

[简体中文](README.md) | **English**

[Open enterprise integration](#open-enterprise-integration) · [Knowledge Studio](#knowledge-studio) · [Get started](#installation-and-use) · [Connect LiteLLM](#connect-litellm) · [Extend and contribute](#extend-and-contribute)

</div>

EduWork brings organizational model access and source-based creation and learning into one desktop workbench. Sign in with a school or enterprise account, explore questions in conversation, and turn your materials into reports, presentations, quizzes, and flashcards in Knowledge Studio.

We focus on two things: **making organizational model services available to different clients through open protocols, and giving knowledge work ways to interact beyond chat.**

<a id="school-and-enterprise-integration"></a>

## Open enterprise integration

Sign in with a school or enterprise account, discover the models you are authorized to use, and start a conversation. There is no need to distribute model API keys to individual users. Organization models and personally configured models can coexist; permissions and quotas remain managed by the server.

### Native LiteLLM support

The EduWork desktop package includes LiteLLM native CLI OAuth support. Configure the full discovery URL, and the client handles browser authorization, model discovery, and Token refresh without an additional plugin installation. The gateway must enable the corresponding CLI OAuth feature and grant users model access. See the [setup guide](packages/dsh-oidc/docs/gateway-auth/litellm-setup.en.md) for version requirements.

![After LiteLLM sign-in, the model menu shows the authorized deepseek-v4-flash under the local LiteLLM group](docs/images/litellm-models.png)

<p align="center"><sub>Sign in to use models authorized by the gateway. DeepSeek is a separately configured provider in this example and can coexist with LiteLLM.</sub></p>

| Integration | Current support |
| --- | --- |
| **LiteLLM native OAuth** | Sign in to the gateway, then discover and call models authorized for the user and selected team. [Setup guide](packages/dsh-oidc/docs/gateway-auth/litellm-setup.en.md) |
| **oidc-llm (experimental)** | Connect institution identity and Token-based model access with explicit experimental opt-in. [Protocol notes](packages/dsh-oidc/docs/gateway-auth/experimental-oidc-llm.en.md) · [ChatECNU edition example](https://github.com/ECNU/EduWork-ECNU) |
| **Standard OIDC** | Identity sign-in; model access additionally requires a supported authorization contract on the server. [Integration contract](packages/dsh-oidc/docs/server-integration-contract.en.md) |

### One integration, more clients

**An organization's accounts and model services should be independent of any one client.** We publish the identity and model-access protocols, implementation, and configuration examples. Other clients can implement the protocols independently, or reuse the separately published `@eduwork/dsh-oidc` module in compatible DSH applications, without adopting EduWork's UI.

The native LiteLLM and experimental oidc-llm protocols share Access Token session and model invocation capabilities. oidc-llm is not yet finalized, and cross-client interoperability requires version-specific validation. We plan to support more open-source Token gateways and welcome gateway, identity platform, and client developers to participate.

[Open integration initiative](packages/dsh-oidc/docs/open-integration.en.md) · [Server interfaces and integration testing](packages/dsh-oidc/docs/server-integration-contract.en.md) · [Client integration](packages/dsh-oidc/README_EN.md)

## Knowledge Studio

**Inspired by NotebookLM, turn source materials into knowledge you can read, use, and practice.** Knowledge Studio uses the files in your local workspace and your configured models, sharing artifacts and file previews with conversations.

### From sources to creation

Organize materials and explore questions in a conversation. Preview the files you create and use them as sources in Studio. The example below starts with campus research and an HTML introduction, then turns that material into a quiz.

![EduWork workspace: research campus information, generate an HTML introduction, and preview the page on the right](docs/images/workspace.png)

<p align="center"><sub>Conversation and output side by side: keep discussing while inspecting the resulting file.</sub></p>

Open Studio on the right and choose an output:

| Create and organize | Understand and learn |
| --- | --- |
| Reports, spreadsheets, presentations | Mind maps, quizzes, flashcards |
| Export DOCX, XLSX, PPTX | Explore citations, answer questions, review explanations, ask follow-ups |

Audio and video overviews offer another way to explore sources. Image generation and cloud TTS require compatible services; local speech depends on the system and local resources. See [media configuration](docs/MEDIA.md).

![Knowledge Studio: reports, mind maps, quizzes, flashcards, spreadsheets, presentations, audio and video, with recent results](docs/images/studio.png)

<p align="center"><sub>Use the same sources for different outputs, then open them from Recent results.</sub></p>

### From reading to learning

Quizzes and flashcards are interactive. Answer questions, review feedback and source evidence, and use Ask AI to follow up on anything you do not understand.

![Studio quiz: check answers, explanations, and source evidence, then ask AI a follow-up question](docs/images/quiz.png)

<p align="center"><sub>Return to the source behind an answer, then continue learning with new questions.</sub></p>

### Studio is a plugin, too

Knowledge Studio is an independent plugin. It connects to the workbench through the host's sidebar slots and provides a capability registration interface. Developers can extend output types or integrate other Studio interfaces through plugins. Office, speech, and media generation services are maintained separately for reuse by conversations and Studio.

We want this space to support more ways to create and learn. Additional Studios need a plugin adapter; Knowledge Studio is the implementation available today. See the [Studio architecture and extension interfaces](packages/dsh-knowledge-studio/docs/ARCHITECTURE.md).

## Installation and use

Each client runs independently on its user's computer, without a separate EduWork server. Model services come from your chosen provider or organization.

Desktop packages support **Windows x64** and **macOS 15+ on Apple Silicon (arm64)**. Extract the portable Windows package to run it; on Mac, extract the development package and move `EduWork.app` to Applications. Mac packages do not yet have Apple Developer ID signing or notarization, so the first launch may show a system security prompt. See the [macOS notes](docs/MACOS.md).

### 1. Get the client

Download the complete desktop package for your platform from [GitHub Releases](https://github.com/ecnu/EduWork/releases):

- **Windows x64:** extract into a writable directory and run `EduWork-Electron.exe`. Keep the accompanying resource files; do not copy just the EXE.
- **macOS arm64:** extract and move `EduWork.app` to Applications, then open it. Configuration and user data live in the user directory.

GitHub's Source code archives are not desktop packages. See the [build guide](docs/BUILD.md) to run from source.

### 2. Connect a model

| What you have | How to connect |
| --- | --- |
| Personal model API | Open **Settings → Models** and enter your provider's API key, endpoint, and model. |
| LiteLLM gateway account | Configure discovery as described below and sign in through the browser, without manually entering a model key. |
| School or company configuration | Merge it into the active file using the [organization steps](#configuration-steps), then sign in. |

The public edition does not download institution configuration by default. It ships a commented `eduwork.jsonc` and an `examples/` folder. Application configuration such as institution connections, media services, plugin defaults, and update sources lives in the single file opened from Settings; optional fields are documented in a commented reference at its end. Personal models, API keys, and interface preferences remain managed in their respective settings screens.

#### Connect LiteLLM

1. Open the active `eduwork.jsonc` through **Settings → Open configuration file**. Use the adjacent `examples/litellm.jsonc` to add an organization to the `organizations` array.
2. Set its display name, unique local `id`, complete discovery URL (such as `https://gateway.example.org/.well-known/litellm-cli-auth`), and the `issuer` from discovery. LiteLLM registers its Client ID automatically: **do not enter `clientId`, `client_secret`, or an API Key**.
3. Save, completely exit, and restart. Sign in to LiteLLM from the account menu, choose a team if requested, approve access, and select a model to chat.

The gateway must enable native CLI OAuth and grant the account model permissions. For HTTP testing, set `allowInsecureDevelopment` to `true` in the organization object; keep its default `false` for HTTPS. See the [field-by-field steps](config/desktop/examples/README_EN.md#connect-litellm-where-to-edit-and-what-to-enter), and the [LiteLLM setup guide](packages/dsh-oidc/docs/gateway-auth/litellm-setup.en.md) for version requirements and deployment checks.

<a id="configuration-steps"></a>

<details>
<summary>Use a school or enterprise configuration</summary>

1. Select **Open configuration file** in Settings. The active `eduwork.jsonc` is under the application directory's `config/` on Windows, or `~/Library/Application Support/eduwork-electron/config/` on macOS.
2. Follow the server guide and the adjacent `examples/` folder. Add organization entries to `organizations`, preserving existing settings; add `media` if needed. Editing the example alone has no effect.
3. Save, exit completely through the tray or application menu, and restart. Then select your organization and sign in.

Configuration files contain public connection details and credential references. Manage personal API keys in model settings; login Tokens are kept in protected local storage. Do not put passwords or tokens in the configuration file. The interface logo is configurable; the embedded application icon comes from the distribution.

[LiteLLM example](config/desktop/examples/litellm.jsonc) · [Experimental oidc-llm example](config/desktop/examples/organization.jsonc) · [Media example](config/desktop/examples/media.jsonc)

</details>

### 3. Start working

Choose a local workspace, add your task materials, and describe the result you want. For documents, spreadsheets, and other outputs, you can also open Studio on the right and choose an output type.

Try: **“Create a study guide from these sources, then make a companion quiz.”**

<details>
<summary>Window behavior and updates</summary>

Closing the window minimizes it to the system tray by default. Use the tray or application menu to exit completely. The public edition defaults to GitHub updates, with public-beta and development channels selectable in Settings. Windows uses its portable updater; macOS uses Sparkle to download, replace the application, and restart after user confirmation. Institutions can configure another source. Updates preserve history and user configuration. See the [Windows update guide](docs/UPDATES.md) and [macOS update guide](docs/MACOS_UPDATES_EN.md).

</details>

<a id="extend-internal-capabilities-through-plugins"></a>

## Extend and contribute

**Skills provide task guidance; plugins provide executable capabilities and interface extensions.** Manage built-in skills, import others, or write your own so that conversations and Studio can follow methods suited to your work.

![Skill center: browse and manage built-in skills, import skills, or create your own](docs/images/skills.png)

<p align="center"><sub>From task guidance to plugin capabilities, extend the workbench as needed.</sub></p>

Contributions are welcome for gateway adapters, Studio outputs and interfaces, skills, and plugins. Connect supported identity, model, and media services through configuration. Institutions can also combine internal plugins, skills, and defaults into their own edition. [EduWork@ECNU](https://github.com/ECNU/EduWork-ECNU) is an institutional extension built on the public edition.

[Contribution guide](CONTRIBUTING.md) · [Discussion and feedback](https://github.com/ECNU/EduWork/issues) · [Edition boundaries](docs/EDITIONS.md)

## Documentation

| Guide | Contents |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Models, search, speech, file operations, and diagnostics. |
| [Configuration file](docs/CONFIGURATION_EN.md) · [Configuration examples](config/desktop/examples/README_EN.md) | Enterprise sign-in, branding, media, updates, and concurrency. |
| [LiteLLM setup guide](packages/dsh-oidc/docs/gateway-auth/litellm-setup.en.md) | Server preparation, client configuration, sign-in, and troubleshooting. |
| [Knowledge Studio](packages/dsh-knowledge-studio/README_EN.md) | Output types, usage, and extension development. |
| [Media configuration](docs/MEDIA.md) | Endpoint requirements and setup for image generation and cloud TTS. |
| [Versioning and upgrades](docs/RELEASE.md) · [Update sources](docs/UPDATES.md) | Development and public-beta builds, data migration, and automatic updates. |
| [Configuration and Skills updates](docs/CONTENT_UPDATES_EN.md) | Optional independent model configuration and official Skills updates without downloading the whole client. |
| [Build guide](docs/BUILD.md) · [macOS notes](docs/MACOS.md) | Running from source, desktop packaging, and platform support. |
| [Contribution guide](CONTRIBUTING.md) · [Edition boundaries](docs/EDITIONS.md) | Contributing and the division between the public edition and institutional extensions. |

Detailed documentation defaults to Chinese.

<details>
<summary>Public modules for independent use</summary>

These modules keep their source and documentation in this repository. Each npm package can still be installed, versioned, and published independently, including for use in other DSH applications.

| Module documentation | Capabilities |
| --- | --- |
| [Identity and models (dsh-oidc)](packages/dsh-oidc/README_EN.md) | OIDC / OAuth sign-in, Token model authorization, enterprise model catalogs, and server integration protocols. |
| [Local memory (dsh-memory)](packages/dsh-memory/README_EN.md) | Local memory and history retrieval to carry task context forward. |
| [Mail assistant (dsh-mail)](packages/dsh-mail/README_EN.md) | Read mail through IMAP, send through SMTP, and manage the associated permissions. |
| [Studio (dsh-knowledge-studio)](packages/dsh-knowledge-studio/README_EN.md) | Create, preview, and manage reports, spreadsheets, presentations, learning materials, and media. |
| [Artifact and media services (dsh-artifact-services)](packages/dsh-knowledge-studio/packages/artifact-services/README_EN.md) | Office, speech, image, and media generation shared by conversations and Studio. |

See [package development and publication](docs/PACKAGES_EN.md) for module development, checks, and npm releases.

</details>

## Data and privacy

Conversations, workspace references, and memory are managed locally. When using remote models, search, or media services, content needed for a task is sent to the corresponding provider and is subject to that provider's data policies. Screenshots use demonstration material; their generated content is not a factual reference.

When moving between computers, use [history import](docs/数据导入.md) in Settings to merge conversations and materials inside the client directory. Workspace files outside that directory must be copied separately. For troubleshooting, export a diagnostic ZIP and, for a particular conversation, a separate Session log. See the [user guide](docs/USER_GUIDE.md).

## Acknowledgments and license

EduWork is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Thanks to the project for its Agent runtime and plugin foundations. Knowledge Studio's source-based creation and learning interactions are inspired by NotebookLM.

EduWork project code uses the [MIT License](LICENSE). Third-party components retain their own licenses; see the [third-party notices](THIRD_PARTY_NOTICES.md).
