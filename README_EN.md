<p align="center">
  <img src="docs/images/readme-hero-en.svg" width="100%" alt="From source materials to finished work with EduWork — brand illustration">
</p>

<h1 align="center">EduWork</h1>

<p align="center"><strong>Turn your materials into finished work, with AI.</strong><br><sub>Local workspaces · Useful outputs · Your models and institutional services</sub></p>

<div align="center">

[![DSH 0.1.5-rc.2](https://img.shields.io/badge/DSH-0.1.5--rc.2-5367E8?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2) [![License: MIT](https://img.shields.io/badge/license-MIT-3DA66B?style=flat-square)](LICENSE) [![Desktop: Electron](https://img.shields.io/badge/desktop-Electron-47848F?style=flat-square&logo=electron&logoColor=white)](dsh-electron/README_EN.md) [![Platform: Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D4?style=flat-square)](#installation-and-use)

[简体中文](README.md) | **English**

[Get started](#installation-and-use) · [School and enterprise integration](#school-and-enterprise-integration) · [Open integration initiative](#one-integration-more-clients) · [User guide](docs/USER_GUIDE.md)

</div>

EduWork is a desktop AI assistant built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Choose a folder and describe what you want to accomplish: read sources, search for information, analyze data, and create documents, spreadsheets, and presentations in one workspace.

Individuals can connect their own model APIs. Schools and businesses can configure their identity and model services. **Each client runs independently on its user's computer, with no separate EduWork server to deploy.**

![EduWork workspace: turn course materials into a teaching plan and open output files in the conversation](docs/images/workspace.png)

<p align="center"><sub>Keep sources, conversations, and results together, so you can keep building on your work.</sub></p>

## What you can do

<table>
<tr>
<td width="50%" valign="top"><h3>Work with your files</h3><p>Read sources, edit documents, analyze data, and run scripts in a local workspace.</p></td>
<td width="50%" valign="top"><h3>Create useful outputs</h3><p>Use Studio to turn ideas into reports, spreadsheets, presentations, and learning materials.</p></td>
</tr>
<tr>
<td width="50%" valign="top"><h3>Choose your models</h3><p>Connect your own APIs or sign in to an organization. Personal and enterprise models can coexist.</p></td>
<td width="50%" valign="top"><h3>Bring your services</h3><p>Configure identity and model access, then add skills and plugins for specialized work.</p></td>
</tr>
</table>

### Start with a real task

| What you are working on | Try asking EduWork |
| --- | --- |
| Teaching and learning | “Create a presentation from these course materials, then make a quiz and revision flashcards.” |
| Research and discovery | “Read these sources, organize findings by topic, cite the evidence, and flag questions to verify.” |
| Data and everyday work | “Compare these spreadsheets, identify differences, and create an analysis report and summary table.” |

The agent can read and edit files, run scripts, and coordinate subagents for complex tasks. Conversations and outputs stay with your workspace, ready for revisions, new sources, and follow-up work.

### Make the results in Studio

Open Studio on the right and choose an output type, or ask for it in a conversation. Both entry points share generation, previews, and downloads.

**Reports · Spreadsheets · Presentations · Mind maps · Quizzes · Flashcards · Audio · Video**

![Studio sidebar: create teaching materials for a lesson plan, shown with an institution configuration](docs/images/studio.png)

<p align="center"><sub>The screenshot shows an institution configuration. Studio is part of the public edition; interface names and branding are configurable.</sub></p>

Export reports, spreadsheets, and presentations as **DOCX, XLSX, and PPTX** files. Preview interactive learning materials and download media with subtitles. Image generation and cloud TTS require compatible services; local speech depends on the system and local resources. See [media configuration](docs/MEDIA.md).

### Make it work your way

- **Search and browser**: use official DeepSeek search when its key is configured, or browser search without a key otherwise.
- **Skill center**: browse built-in skills, import skills, or write task guidance of your own without rebuilding the client.
- **Memory and mail**: keep task context with local memory; configure an email account to work with the mail assistant.
- **Speech, models, and preferences**: use local transcription and system speech synthesis, choose your models, switch between blue and red themes, and set a total limit for concurrent model requests.

<details>
<summary>Explore the skill center</summary>

![Skill center: browse and manage built-in skills, import skills, or create your own](docs/images/skills.png)

Skills provide task guidance; plugins provide executable capabilities. Supported identity, model, and media services connect through configuration.

</details>

## Installation and use

The current desktop target is **Windows x64**, distributed as a **portable Electron package**. Extract it to run. macOS support is being prepared; see the [macOS notes](docs/MACOS.md).

### 1. Get the client

Download a complete desktop package from [GitHub Releases](https://github.com/ecnu/EduWork/releases), extract it into a writable directory, and run `EduWork-Electron.exe`. Keep the accompanying resource files; do not copy just the EXE.

If no desktop package is available in Releases yet, follow the [build guide](docs/BUILD.md) to run from source. GitHub's Source code archives are not desktop packages.

### 2. Connect a model

Open **Settings → Models** and enter your provider's API key, endpoint, and model. School and enterprise users can load an organization configuration as described below, then sign in through the browser to obtain models.

### 3. Start working

Choose a local workspace, add your task materials, and describe the result you want. For documents, spreadsheets, and other outputs, you can also open Studio on the right and choose an output type.

<details>
<summary>Window behavior and updates</summary>

Closing the window minimizes it to the system tray by default. Use the tray menu to exit completely. The Windows public edition defaults to GitHub updates, with public-beta and development channels selectable in Settings; institutions can configure another source. Updates preserve history and user configuration; see the [update guide](docs/UPDATES.md).

</details>

## School and enterprise integration

**Enterprise integration is built into the public edition.** Schools and businesses can distribute a configuration file that connects the same EduWork client to their identity platform, model gateway, and media services, without changing the public code or rebuilding the client.

| Configuration | What it enables |
| --- | --- |
| OIDC identity | Sign in with a school or enterprise account in the system browser. Multiple organizations are supported. |
| Model credentials and catalog | With the EduWork resource protocol implemented by the server, obtain a key and configure enterprise models after user authorization and any required confirmation, without copying credentials manually. |
| Image generation and cloud TTS | Enable shared media capabilities by configuring compatible endpoints, models, image sizes, and voices. |
| Name, logo, and update source | Customize interface branding and configure the distributor's update channel. User configuration is retained during updates. |

Enterprise models can coexist with models configured by the user. Standard OIDC handles identity only; obtaining keys and model catalogs requires additional resource APIs on the server.

<a id="configuration-steps"></a>

<details>
<summary><strong>Configure your organization in three steps</strong></summary>

1. Select **Open configuration file** in Settings to edit `config/eduwork.jsonc` in the client directory.
2. The file includes a complete commented example. Fill in `organizations` using the details supplied by your administrator; add `media` if image or speech services are needed. More examples are available in the client's `config/examples/` directory.
3. Save, exit completely through the tray, and restart. Then select your organization and sign in.

Configuration files contain public connection details and credential references. Manage personal API keys in model settings; enterprise credentials are placed in protected local storage by the sign-in flow. Do not put passwords or tokens in the configuration file. The interface logo is configurable; the embedded application icon comes from the distribution.

</details>

**Administrator configuration:** [Complete enterprise example](config/desktop/examples/organization.jsonc) · [Media example](config/desktop/examples/media.jsonc).

**Developer integration:** These two documents describe the same identity and resource protocol, with different audiences:

- [Server implementation and integration testing (RFC EW-IDENTITY-1)](packages/dsh-oidc/docs/server-integration-contract.en.md): required endpoints, request and response fields, authentication requirements, curl examples, and acceptance steps. Start here when implementing the server.
- [Client integration modes and model discovery](packages/dsh-oidc/docs/public-resource-protocol.en.md): identity-only versus managed-model integration, static versus discovered model catalogs, and how plugins connect through Host RPCs and account events.

<a id="extend-internal-capabilities-through-plugins"></a>

### Add internal services with plugins

Schools and businesses can use plugins to connect internal systems, bringing organization-specific search, business tools, or account services into EduWork. Plugins provide executable capabilities; skills provide task-specific guidance. Existing identity, model, and media APIs should use configuration where supported.

Organizations can combine plugins, skills, and default configuration into their own edition while reusing EduWork's workbench, Studio, file previews, and desktop capabilities. Shared features continue to be maintained in the public edition, while each organization maintains its extensions.

[EduWork@ECNU](https://github.com/ecnu/EduWork-ECNU) is an example of an institutional extension, showing how East China Normal University connects its internal services to the public edition. Use that repository as a reference for organizing extensions and distribution configuration; see [edition boundaries](docs/EDITIONS.md) for the design.

## One integration, more clients

> **Let institutional accounts and model services work across more AI clients.**

Through the **Open Identity and Model Integration Initiative**, we invite identity platforms, model gateways, and client developers to make sign-in, model credentials, and model catalogs reusable through open protocols.

`dsh-oidc` is our starting implementation: standard OIDC for identity, public resource interfaces for managed models, an independent npm package, and a server specification with OpenAPI and integration examples. Other clients can implement the protocol without adopting EduWork's UI. This is a community proposal; interoperability needs version-specific testing.

**[Read the initiative](packages/dsh-oidc/docs/open-integration.en.md)** · [Implement a server](packages/dsh-oidc/docs/server-integration-contract.en.md) · [Integrate a client](packages/dsh-oidc/README_EN.md) · [Share feedback](https://github.com/ecnu/EduWork/issues)

## Data and privacy

Conversations, workspace references, and memory are managed locally. When using remote models, search, or media services, content needed for a task is sent to the corresponding provider and is subject to that provider's data policies.

When moving between computers, use [history import](docs/数据导入.md) in Settings to merge conversations and materials inside the client directory. Workspace files outside that directory must be copied separately. For troubleshooting, export a diagnostic ZIP and, for a particular conversation, a separate Session log. See the [user guide](docs/USER_GUIDE.md).

## Documentation

| Guide | Contents |
| --- | --- |
| [User guide](docs/USER_GUIDE.md) | Models, search, speech, file operations, and diagnostics. |
| [Configuration examples](config/desktop/examples/README_EN.md) | Enterprise sign-in, branding, media, updates, and concurrency. |
| [Media configuration](docs/MEDIA.md) | Endpoint requirements and setup for image generation and cloud TTS. |
| [Versioning and upgrades](docs/RELEASE.md) · [Update sources](docs/UPDATES.md) | Development and public-beta builds, data migration, and automatic updates. |
| [Configuration and Skills updates](docs/CONTENT_UPDATES_EN.md) | Optional independent model configuration and official Skills updates without downloading the whole client. |
| [Build guide](docs/BUILD.md) · [macOS notes](docs/MACOS.md) | Running from source, desktop packaging, and platform support. |
| [Contribution guide](CONTRIBUTING.md) · [Edition boundaries](docs/EDITIONS.md) | Contributing and the division between the public edition and institutional extensions. |

Detailed documentation defaults to Chinese.

### Public modules

These modules keep their source and documentation in this repository. Each npm package can still be installed, versioned, and published independently, including for use in other DSH applications.

| Module documentation | Capabilities |
| --- | --- |
| [Identity and models (dsh-oidc)](packages/dsh-oidc/README_EN.md) | OIDC sign-in, model credentials, enterprise model catalogs, and server integration protocols. |
| [Local memory (dsh-memory)](packages/dsh-memory/README_EN.md) | Local memory and history retrieval to carry task context forward. |
| [Mail assistant (dsh-mail)](packages/dsh-mail/README_EN.md) | Read mail through IMAP, send through SMTP, and manage the associated permissions. |
| [Studio (dsh-knowledge-studio)](packages/dsh-knowledge-studio/README_EN.md) | Create, preview, and manage reports, spreadsheets, presentations, learning materials, and media. |
| [Artifact and media services (dsh-artifact-services)](packages/dsh-knowledge-studio/packages/artifact-services/README_EN.md) | Office, speech, image, and media generation shared by conversations and Studio. |

See [package development and publication](docs/PACKAGES_EN.md) for module development, checks, and npm releases.

## Acknowledgments and license

Thanks to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its open-source ecosystem for the foundations of EduWork.

EduWork project code uses the [MIT License](LICENSE). Third-party components retain their own licenses; see the [third-party notices](THIRD_PARTY_NOTICES.md).
