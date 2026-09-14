<img src="assets/eduwork/icon.svg" width="64" height="64" alt="EduWork Logo">

# EduWork

[![DSH 0.1.5-rc.2](https://img.shields.io/badge/DSH-0.1.5--rc.2-5367E8?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2)
[![License: MIT](https://img.shields.io/badge/license-MIT-3DA66B?style=flat-square)](LICENSE)
[![Desktop: Electron](https://img.shields.io/badge/desktop-Electron-47848F?style=flat-square&logo=electron&logoColor=white)](dsh-electron/README_EN.md)
[![Platform: Windows x64](https://img.shields.io/badge/platform-Windows%20x64-0078D4?style=flat-square)](#installation-and-use)

**A desktop AI assistant for learning, research, and everyday work.**

[简体中文](README.md) | **English**

[Get started](#installation-and-use) · [School and enterprise integration](#school-and-enterprise-integration) · [User guide](docs/USER_GUIDE.md) · [Contribute](CONTRIBUTING.md)

EduWork is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It works with your local files to read sources, search for information, analyze data, and write code, then turn the results into documents, spreadsheets, presentations, or media.

Individuals can connect their own model APIs. Schools and businesses can configure their identity and model services. Each client runs independently on its user's computer, with no separate EduWork server to deploy.

## What you can do

Explore the workspace, Studio, and skill center in the examples below.

### Work with your files

Choose a local folder as your workspace and describe the task. EduWork can read and edit files, run scripts, and coordinate subagents for complex work. Continue working with conversations, source materials, and generated files around the same workspace.

> Read the research materials in this folder. Organize the findings by topic, cite the sources, and flag questions that still need verification.
>
> Compare these spreadsheets, identify differences, and create an analysis report and summary table.
>
> Create a presentation from these course materials, then make a quiz and revision flashcards.

![Workspace conversation: organize course materials into a teaching plan and access output files in the conversation](docs/images/workspace.png)

### Create and manage results in Studio

Studio brings common outputs together in the sidebar. Start there or ask in a conversation: both use the same generation, preview, and download capabilities.

| Output | Use it for |
| --- | --- |
| Reports | Research findings, study guides, and work reports as DOCX documents. |
| Spreadsheets | Extracting, comparing, and analyzing data in XLSX workbooks. |
| Presentations | Turning sources into PPTX presentations with speaker notes. |
| Mind maps | Organizing topics and relationships, with interactive browsing and export. |
| Quizzes and flashcards | Practicing and checking your understanding as you learn. |
| Audio and video | Narration and explanatory videos, with media previews and downloadable subtitles. |

![Studio sidebar: create teaching materials for a lesson plan, shown with an institution configuration](docs/images/studio.png)

The screenshot shows an institution configuration. Studio creation, preview, and download capabilities are part of the public edition; names and branding can be configured.

### Extend the way you work

- **Search and browser**: search the web and literature. Use official DeepSeek search when its key is configured, or browser search without a key otherwise.
- **Skill center**: view and manage skills, adding task guidance for specialized work.
- **Memory and mail assistant**: carry task context forward with local memory and configure a mail account for email tasks.
- **Speech and images**: use local transcription and system speech synthesis, or configure image generation and cloud TTS providers. Conversations and Studio share these capabilities.
- **Models and preferences**: choose your models, switch between blue and red themes, and set a total limit for concurrent model requests.

Image generation and cloud TTS have no service configured by default and require compatible endpoints and credentials. Available local voices depend on the operating system and local resources. See [media service configuration](docs/MEDIA.md).

![Skill center: browse and manage built-in skills, import skills, or create your own](docs/images/skills.png)

## Installation and use

The current desktop target is **Windows x64**, distributed as a **portable Electron package**. Extract it to run. macOS support is being prepared; see the [macOS notes](docs/MACOS.md).

### 1. Get the client

Download a complete desktop package from [GitHub Releases](https://github.com/ecnu/EduWork/releases), extract it into a writable directory, and run `EduWork-Electron.exe`. Keep the accompanying resource files; do not copy just the EXE.

If no desktop package is available in Releases yet, follow the [build guide](docs/BUILD.md) to run from source. GitHub's Source code archives are not desktop packages.

### 2. Connect a model

Open **Settings → Models** and enter your provider's API key, endpoint, and model. School and enterprise users can load an organization configuration as described below, then sign in through the browser to obtain models.

### 3. Start working

Choose a local workspace, add your task materials, and describe the result you want. For documents, spreadsheets, and other outputs, you can also open Studio on the right and choose an output type.

Closing the window minimizes it to the system tray by default. Use the tray menu to exit completely. The Windows public edition defaults to GitHub updates, with public-beta and development channels selectable in Settings; institutions can configure another source. Updates preserve history and user configuration; see the [update guide](docs/UPDATES.md).

## School and enterprise integration

**Enterprise integration is built into the public edition.** Schools and businesses can distribute a configuration file that connects the same EduWork client to their identity platform, model gateway, and media services, without changing the public code or rebuilding the client.

| Configuration | What it enables |
| --- | --- |
| OIDC identity | Sign in with a school or enterprise account in the system browser. Multiple organizations are supported. |
| Model credentials and catalog | With the EduWork resource protocol implemented by the server, obtain a key and configure enterprise models after user authorization and any required confirmation, without copying credentials manually. |
| Image generation and cloud TTS | Enable shared media capabilities by configuring compatible endpoints, models, image sizes, and voices. |
| Name, logo, and update source | Customize interface branding and configure the distributor's update channel. User configuration is retained during updates. |

Enterprise models can coexist with models configured by the user. Standard OIDC handles identity only; obtaining keys and model catalogs requires additional resource APIs on the server.

### Configuration steps

1. Select **Open configuration file** in Settings to edit `config/eduwork.jsonc` in the client directory.
2. The file includes a complete commented example. Fill in `organizations` using the details supplied by your administrator; add `media` if image or speech services are needed. More examples are available in the client's `config/examples/` directory.
3. Save, exit completely through the tray, and restart. Then select your organization and sign in.

Configuration files contain public connection details and credential references. Manage personal API keys in model settings; enterprise credentials are placed in protected local storage by the sign-in flow. Do not put passwords or tokens in the configuration file. The interface logo is configurable; the embedded application icon comes from the distribution.

**Administrator configuration:** [Complete enterprise example](config/desktop/examples/organization.jsonc) · [Media example](config/desktop/examples/media.jsonc).

**Developer integration:** These two documents describe the same identity and resource protocol, with different audiences:

- [Server implementation and integration testing (RFC EW-IDENTITY-1)](packages/dsh-oidc/docs/server-integration-contract.en.md): required endpoints, request and response fields, authentication requirements, curl examples, and acceptance steps. Start here when implementing the server.
- [Client integration modes and model discovery](packages/dsh-oidc/docs/public-resource-protocol.en.md): identity-only versus managed-model integration, static versus discovered model catalogs, and how plugins connect through Host RPCs and account events.

### Extend internal capabilities through plugins

Schools and businesses can use plugins to connect internal systems, bringing organization-specific search, business tools, or account services into EduWork. Plugins provide executable capabilities; skills provide task-specific guidance. Existing identity, model, and media APIs should use configuration where supported.

Organizations can combine plugins, skills, and default configuration into their own edition while reusing EduWork's workbench, Studio, file previews, and desktop capabilities. Shared features continue to be maintained in the public edition, while each organization maintains its extensions.

[EduWork@ECNU](https://github.com/ecnu/EduWork-ECNU) is an example of an institutional extension, showing how East China Normal University connects its internal services to the public edition. Use that repository as a reference for organizing extensions and distribution configuration; see [edition boundaries](docs/EDITIONS.md) for the design.

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
