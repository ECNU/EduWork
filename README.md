<p align="center">
  <img src="docs/images/readme-hero.svg" width="100%" alt="从资料到成果的 EduWork 工作区品牌插画">
</p>

<h1 align="center">EduWork</h1>

<p align="center"><strong>让 AI 围绕你的资料，把任务做到交付。</strong><br><sub>本机工作区 · 可交付成果 · 学校与企业服务接入</sub></p>

<div align="center">

[![DSH 0.1.5-rc.2](https://img.shields.io/badge/DSH-0.1.5--rc.2-5367E8?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.2) [![License: MIT](https://img.shields.io/badge/license-MIT-3DA66B?style=flat-square)](LICENSE) [![Desktop: Electron](https://img.shields.io/badge/desktop-Electron-47848F?style=flat-square&logo=electron&logoColor=white)](dsh-electron/README.md) [![Platform: Windows x64 / macOS arm64](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-0078D4?style=flat-square)](#安装与使用)

**简体中文** | [English](README_EN.md)

[开始使用](#安装与使用) · [连接 LiteLLM](#连接-litellm) · [学校与企业接入](#学校与企业接入) · [开放接入倡议](#一次接入更多客户端) · [使用指南](docs/USER_GUIDE.md)

</div>

EduWork 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面 AI 工作助手。选择一个文件夹，说清楚你想完成的任务：从阅读资料、搜索信息、分析数据，到生成网页、文档、表格和演示文稿，都可以在同一个工作区完成。

个人用户连接自己的模型 API；学校和企业通过配置接入统一身份与模型服务。**每位用户在自己的电脑上独立运行，无需部署额外的 EduWork 服务端。**

![EduWork 工作区：调研校园资料、生成 HTML 简介，并在右侧预览网页成果](docs/images/workspace.png)

<p align="center"><sub>从调研到网页成果：左侧继续对话，右侧直接预览生成的页面。</sub></p>

## 你可以用它做什么

<table>
<tr>
<td width="50%" valign="top"><h3>围绕文件工作</h3><p>读取资料、编辑文档、分析数据、运行脚本，让 AI 在你的本机工作区完成任务。</p></td>
<td width="50%" valign="top"><h3>把结果做成交付物</h3><p>用 Studio 制作报告、表格、演示文稿与学习材料，预览、下载，再继续修改。</p></td>
</tr>
<tr>
<td width="50%" valign="top"><h3>自由选择模型</h3><p>连接自己的 API，或使用机构账号登录。个人模型与企业模型可以同时使用。</p></td>
<td width="50%" valign="top"><h3>接入你的服务</h3><p>通过配置接入身份与模型，通过技能和插件补充专业方法与内部业务能力。</p></td>
</tr>
</table>

### 从一个具体任务开始

| 你正在做什么 | 可以这样交给 EduWork |
| --- | --- |
| 备课与学习 | “根据课程材料制作演示文稿，再生成配套的测验和复习闪卡。” |
| 研究与调研 | “调研这个主题，保留来源链接，制作一页 HTML 介绍，并标出仍需核实的问题。” |
| 数据与办公 | “比较这几份表格，找出差异，生成分析报告和汇总表。” |

Agent 可以读写文件、运行脚本，并通过子代理协作处理复杂任务。工作区保留会话和成果，方便接着修改、补充资料和继续推进。

### 在 Studio 里，把成果做出来

打开右侧 Studio，选择成果类型即可开始；也可以直接在对话中提出要求。例如，把调研生成的网页留在工作区，再用 Studio 制作测验，答题时查看解析与资料依据。同一份资料可以继续用于报告、演示文稿或复习卡片。

**报告 · 数据表 · 演示文稿 · 思维导图 · 测验 · 闪卡 · 音频 · 视频**

![公版 Studio：成果类型入口与基于工作区资料生成的测验](docs/images/studio.png)

<p align="center"><sub>选一种成果形式开始，生成的内容保存在「最近成果」，随时打开继续使用。</sub></p>

报告、表格和演示文稿可生成 **DOCX、XLSX、PPTX** 文件；学习材料支持交互预览，音视频可预览并下载媒体与字幕。文生图和云端 TTS 需配置兼容服务，本机语音取决于系统及本地资源，详见[媒体服务配置](docs/MEDIA.md)。

<details>
<summary>看看生成的测验如何使用</summary>

![Studio 测验：答题后查看对错、解析与来源依据，并可继续向 AI 提问](docs/images/quiz.png)

在侧栏直接答题，查看解析与来源依据；有疑问时可以继续「问问 AI」。

</details>

### 让工作方式适合你

- **搜索与浏览器**：配置 DeepSeek 搜索 Key 时使用官方搜索，未配置时使用免 Key 的浏览器搜索。
- **技能中心**：浏览和管理内置技能，导入或编写自己的任务指引，无需重新编译客户端。
- **记忆与邮件**：用本地记忆延续工作背景；配置邮件账户后，可通过邮件助手处理相关任务。
- **语音、模型与偏好**：使用本机语音转写、系统语音合成，选择自己的模型，切换蓝色或红色主题，设置模型请求总并发。

<details>
<summary>看看技能中心</summary>

![技能中心：浏览和管理内置技能，导入或创建自己的技能](docs/images/skills.png)

技能提供任务指引，插件提供可执行能力；身份、模型和兼容媒体服务优先通过配置接入。

</details>

## 安装与使用

桌面包支持 **Windows x64** 和 **macOS 15+ Apple Silicon（arm64）**。Windows 使用 Electron 绿色包，解压即可运行；Mac 开发包解压后将 `EduWork.app` 放入“应用程序”。Mac 尚未使用 Apple Developer ID 签名或公证，首次打开可能出现系统安全提示，详见 [macOS 说明](docs/MACOS.md)。

### 1. 获取客户端

从 [GitHub Releases](https://github.com/ecnu/EduWork/releases) 选择对应平台的完整桌面包：

- **Windows x64**：解压到可写目录，运行 `EduWork-Electron.exe`。请保留同目录下的资源文件，不要只复制 EXE。
- **macOS arm64**：解压后将 `EduWork.app` 放入“应用程序”，然后打开；配置和用户数据存放在用户目录。

GitHub 的 Source code 压缩包不是桌面安装包。从源码运行见[构建指南](docs/BUILD.md)。

### 2. 连接模型

| 你已有的服务 | 如何连接 |
| --- | --- |
| 个人模型 API | 打开 **设置 → 模型**，填写服务商的 API Key、接口地址和模型。 |
| LiteLLM 网关账号 | 按下方步骤配置发现地址，通过浏览器登录，无需手动填写模型 Key。 |
| 学校或企业提供的配置 | 按[机构配置方法](#配置方法)合并到生效配置，再选择机构登录。 |

公版默认不自动下载机构配置，安装包自带带注释的 `eduwork.jsonc` 和 `examples/`。机构接入、媒体服务、插件默认值与更新源等应用配置集中在设置中打开的这一份文件，可选配置项列在文件末尾的注释参考中。个人模型、API Key 和界面偏好仍在对应设置界面中管理。

#### 连接 LiteLLM

1. 从 **设置 → 打开配置文件** 打开生效的 `eduwork.jsonc`，参照旁边的 `examples/litellm.jsonc`，把机构条目加入 `organizations` 数组。
2. 填写登录名称、本机唯一 `id`、完整发现地址（例如 `https://gateway.example.org/.well-known/litellm-cli-auth`）以及发现文档里的 `issuer`。LiteLLM 自动注册 Client ID，**不需要填写 `clientId`、`client_secret` 或 API Key**。
3. 保存后完全退出并重启，从账户入口登录 LiteLLM；按网关提示选择团队并授权，再选择模型开始对话。

服务端需启用 LiteLLM 原生 CLI OAuth，并提供有模型权限的账号。HTTP 测试环境还需把机构对象中的 `allowInsecureDevelopment` 改为 `true`，HTTPS 保持默认 `false`。字段填写见[逐项配置说明](config/desktop/examples/README.md#接入-litellm改哪里填什么)，版本要求与部署检查见[LiteLLM 接入指南](packages/dsh-oidc/docs/gateway-auth/litellm-setup.md)。

<details>
<summary>查看 LiteLLM 登录后的模型选择</summary>

![LiteLLM 登录后，模型菜单在「本机 LiteLLM」分组中显示已授权的 deepseek-v4-flash](docs/images/litellm-models.png)

图中 LiteLLM 账号获授权使用 `deepseek-v4-flash`；实际名称和列表由你的网关配置决定。上方 DeepSeek 分组是单独配置的服务商，可与机构模型同时使用。

</details>

### 3. 开始工作

选择一个本机工作区，放入任务资料，直接描述你想得到的结果。需要文档、表格等成果时，也可以打开右侧 Studio，选择对应类型开始。

<details>
<summary>窗口行为与自动更新</summary>

窗口关闭后默认收起到系统托盘；需要完全退出时，使用托盘或应用菜单。公版默认从 GitHub 获取更新，公测与开发渠道可在设置中选择。Windows 使用绿色版更新器；macOS 使用 Sparkle，按提示确认下载和安装后替换应用并重启。机构可配置自己的更新源，更新保留历史数据与用户配置。详见 [Windows 更新说明](docs/UPDATES.md)和 [macOS 更新说明](docs/MACOS_UPDATES.md)。

</details>

## 学校与企业接入

**企业接入是公版的内置能力。** 学校或企业可以向用户分发一份配置，让同一个 EduWork 客户端连接自己的身份平台、模型网关和媒体服务，无需修改公版代码或重新打包。

### 支持企业登录的服务端

| 服务端 / 项目 | 登录与模型接入 | 配置与使用 |
| --- | --- | --- |
| [LiteLLM](https://github.com/BerriAI/litellm) | 使用网关账号登录，按用户及所选团队的授权访问模型。 | [LiteLLM 接入指南](packages/dsh-oidc/docs/gateway-auth/litellm-setup.md) |
| [ChatECNU](https://developer.ecnu.edu.cn/vitepress/llm/model.html) | 通过 oidc-llm 接入机构身份与获授权的模型。 | [EduWork@ECNU 机构发行示例](https://github.com/ECNU/EduWork-ECNU) |

这些登录方式已内置于桌面包，无需另装插件。oidc-llm 仍是实验性协议，需按服务端约定显式启用；标准 LiteLLM 配置无需开启此实验选项。

企业登录后，客户端使用登录 Token 自动读取模型目录并调用模型，使用过程中自动刷新，无需复制或另行创建模型 Key。模型权限与配额仍由服务端管理；企业模型和用户自己配置的模型可以同时使用。

其他标准 OIDC 平台可以接入身份登录；要使用机构模型，服务端还需支持明确的 Token 模型接入协议。机构也可按需配置文生图、云端 TTS、名称、Logo 与更新源。

<a id="配置方法"></a>

<details>
<summary><strong>三步配置你的机构</strong></summary>

1. 在设置中点击 **打开配置文件**，编辑当前生效的 `eduwork.jsonc`。Windows 位于程序目录的 `config/`；macOS 位于 `~/Library/Application Support/eduwork-electron/config/`。
2. 按服务端指南选择旁边 `examples/` 中的示例，将机构条目加入 `organizations`，保留已有配置；需要图像或语音服务时再加入 `media`。只修改示例文件不会生效。
3. 保存后从托盘或应用菜单完全退出并重新启动，再选择机构登录。

配置文件只保存公开接入信息和凭据引用。个人 API Key 在模型设置中管理，登录 Token 保存在本机受保护存储中；不要把密码或令牌写入配置文件。界面 Logo 可配置，程序内嵌图标由发行包提供。

</details>

**管理员配置：** [LiteLLM 配置示例](config/desktop/examples/litellm.jsonc) · [实验性 oidc-llm 配置示例](config/desktop/examples/organization.jsonc) · [媒体配置示例](config/desktop/examples/media.jsonc)。

**开发者接入：**

- [服务端实现与联调](packages/dsh-oidc/docs/server-integration-contract.md)：LiteLLM 原生契约和 oidc-llm 实验契约的接口、认证要求与验收步骤。
- [客户端接入模式与模型发现](packages/dsh-oidc/docs/public-resource-protocol.md)：纯身份与 Token 模型模式、授权目录和模型能力配置，以及插件如何通过共享 Host 接入。

### 通过插件扩展内部能力

学校和企业还可以通过插件接入内部系统，将专属的信息检索、业务工具或账户服务带入 EduWork。插件提供可执行能力，技能提供面向具体任务的操作指引；已有的身份、模型和媒体接口则优先通过配置接入。

机构可以将插件、技能和默认配置组合成自己的发行版，复用 EduWork 的工作台、Studio、文件预览和桌面能力。通用功能持续由公版维护，机构只需维护自己的扩展。

[EduWork@ECNU](https://github.com/ecnu/EduWork-ECNU) 是一个机构扩展示例，展示了华东师范大学如何基于公版接入内部服务。可参考该仓库组织自己的扩展与发行配置，设计说明见[发行边界](docs/EDITIONS.md)。

## 一次接入，更多客户端

> **让机构的账号与模型服务，被更多 AI 客户端复用。**

我们发起**开放身份与模型接入倡议**，邀请身份平台、模型网关和客户端开发者，共同用公开协议连接登录、模型凭据与模型目录，让机构接入新工具时能够复用已有服务。

`dsh-oidc` 是我们的实现起点：保留标准 OIDC 身份登录，模型接入支持 LiteLLM 原生 OAuth 契约和实验性 oidc-llm 契约，共用 Token 会话与模型调用模块。源码、协议文档和配置示例公开，模块以独立 npm 包维护；其他客户端也可以按协议独立实现，无需采用 EduWork 的界面。当前倡议面向社区讨论，跨客户端互通需要按版本实际验证。

**[阅读开放接入倡议](packages/dsh-oidc/docs/open-integration.md)** · [实现服务端](packages/dsh-oidc/docs/server-integration-contract.md) · [接入客户端](packages/dsh-oidc/README.md) · [一起讨论](https://github.com/ecnu/EduWork/issues)

## 数据与隐私

会话、工作区引用和记忆在本机管理。连接远程模型、搜索或媒体服务时，执行任务所需的内容会发送给相应服务商；数据处理规则以所选服务为准。

跨机使用可通过设置中的[历史数据导入](docs/数据导入.md)功能合并会话和客户端目录内的资料；客户端目录之外的工作区文件需要另行复制。故障排查可导出诊断 ZIP，具体会话问题可另外提供 Session log，详见[使用指南](docs/USER_GUIDE.md)。

## 详细文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/USER_GUIDE.md) | 模型、搜索、语音、文件操作与故障诊断。 |
| [配置文件](docs/CONFIGURATION.md) · [配置示例](config/desktop/examples/README.md) | 企业登录、品牌、媒体服务、更新源与并发设置。 |
| [LiteLLM 接入指南](packages/dsh-oidc/docs/gateway-auth/litellm-setup.md) | 服务端准备、客户端配置、登录及故障排查。 |
| [媒体服务配置](docs/MEDIA.md) | 文生图、云端 TTS 的接口要求及配置方法。 |
| [版本与升级](docs/RELEASE.md) · [更新源部署](docs/UPDATES.md) | 开发版与公测版、数据迁移和自动更新。 |
| [配置与 Skills 更新](docs/CONTENT_UPDATES.md) | 管理员按需独立更新模型配置和官方技能，无需重新下载客户端。 |
| [构建指南](docs/BUILD.md) · [macOS 说明](docs/MACOS.md) | 从源码运行、桌面装配与平台适配。 |
| [贡献指南](CONTRIBUTING.md) · [发行边界](docs/EDITIONS.md) | 参与开发及公版与机构扩展的分工。 |

### 公共模块

以下模块的源码和文档统一维护在本仓库，npm 包仍独立安装、版本管理和发布，也可供其他 DSH 应用使用。

| 模块文档 | 功能 |
| --- | --- |
| [身份与模型接入（dsh-oidc）](packages/dsh-oidc/README.md) | OIDC / OAuth 登录、Token 模型授权、企业模型目录与服务端接入协议。 |
| [本地记忆（dsh-memory）](packages/dsh-memory/README.md) | 本地记忆与历史检索，延续任务背景。 |
| [邮件助手（dsh-mail）](packages/dsh-mail/README.md) | 通过 IMAP 读取邮件、SMTP 发送邮件，并管理相关权限。 |
| [Studio（dsh-knowledge-studio）](packages/dsh-knowledge-studio/README.md) | 创作、预览和管理报告、表格、演示文稿、学习材料及音视频成果。 |
| [成果与媒体服务（dsh-artifact-services）](packages/dsh-knowledge-studio/packages/artifact-services/README.md) | 供对话和 Studio 共用的 Office、语音、图像与媒体生成服务。 |

模块开发、检查和 npm 发布见[包维护说明](docs/PACKAGES.md)。

## 致谢与许可

感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 及其开源生态提供的基础能力。

EduWork 项目代码采用 [MIT 许可证](LICENSE)。第三方组件保留各自的许可证，详见[第三方声明](THIRD_PARTY_NOTICES.md)。
