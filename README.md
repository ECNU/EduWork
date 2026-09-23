<p align="center">
  <img src="assets/eduwork/icon-red.svg" width="72" height="72" alt="EduWork 红色标识">
</p>

<h1 align="center">EduWork</h1>

<p align="center"><strong>开放的 AI 知识工作台。</strong><br><sub>企业登录 · 开放协议 · Knowledge Studio</sub></p>

<div align="center">

[![License: MIT](https://img.shields.io/badge/license-MIT-3DA66B?style=flat-square)](LICENSE) [![Platform: Windows x64 / macOS arm64](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-9f2636?style=flat-square)](#安装与使用)

**简体中文** | [English](README_EN.md)

[开放企业接入](#开放企业接入) · [Knowledge Studio](#knowledge-studio) · [开始使用](#安装与使用) · [连接 LiteLLM](#连接-litellm) · [扩展与贡献](#扩展与贡献)

</div>

EduWork 把组织的模型服务与围绕资料的创作、学习放在同一个桌面工作台中。用学校或企业账号连接模型，在对话中探索问题，在 Knowledge Studio 中把资料变成报告、演示文稿、测验与闪卡。

我们关注两件事：**让组织的模型服务能够通过开放协议被不同客户端使用，让知识工作拥有对话之外的交互方式。**

<a id="学校与企业接入"></a>

## 开放企业接入

使用学校或企业账号登录，自动获取有权使用的模型并开始对话，无需为每位用户手动分发模型 API Key。机构模型与个人配置的模型可以同时使用，权限与配额由服务端管理。

### 已原生支持 LiteLLM

EduWork 桌面包已内置 LiteLLM 原生 CLI OAuth 接入。填写完整的服务发现地址后，客户端完成浏览器授权、模型发现和 Token 刷新，无需另装插件。服务端须启用对应的 CLI OAuth 功能并为用户授权模型，版本要求见[接入指南](packages/dsh-oidc/docs/gateway-auth/litellm-setup.md)。

![LiteLLM 登录后，模型菜单在「本机 LiteLLM」分组中显示获授权的 deepseek-v4-flash](docs/images/litellm-models.png)

<p align="center"><sub>登录即可使用网关授权的模型。图中 DeepSeek 是单独配置的服务商，可与 LiteLLM 同时使用。</sub></p>

| 接入方式 | 当前支持 |
| --- | --- |
| **LiteLLM 原生 OAuth** | 使用网关账号登录，按用户及所选团队的授权发现和调用模型。[配置指南](packages/dsh-oidc/docs/gateway-auth/litellm-setup.md) |
| **oidc-llm（实验性）** | 连接机构身份与 Token 模型服务，需显式启用实验选项。[协议说明](packages/dsh-oidc/docs/gateway-auth/experimental-oidc-llm.md) · [ChatECNU 发行示例](https://github.com/ECNU/EduWork-ECNU) |
| **标准 OIDC** | 接入身份登录；模型访问还需要服务端支持相应的授权协议。[接入契约](packages/dsh-oidc/docs/server-integration-contract.md) |

### 一次接入，更多客户端

**组织的账号与模型服务应当独立于某一个客户端。** 我们公开身份与模型接入协议、实现和配置示例。其他客户端可以按协议独立实现，也可以在兼容的 DSH 应用中复用独立发布的 `@eduwork/dsh-oidc` 模块，无需采用 EduWork 的界面。

LiteLLM 原生协议与 oidc-llm 实验协议复用 Access Token 会话和模型调用能力。oidc-llm 尚未定稿，跨客户端互通仍需按版本验证。我们计划支持更多开源 Token 网关，欢迎网关、身份平台与客户端开发者共同参与。

[开放接入倡议](packages/dsh-oidc/docs/open-integration.md) · [服务端接口与联调](packages/dsh-oidc/docs/server-integration-contract.md) · [客户端接入](packages/dsh-oidc/README.md)

## Knowledge Studio

**受 NotebookLM 启发，把资料变成可以阅读、使用和练习的知识成果。** Knowledge Studio 直接使用本机工作区的资料与已配置的模型，与对话共享成果和文件预览能力。

### 从资料到创作

在对话中整理资料、探索问题，生成的文件可以直接预览，也可以作为 Studio 的素材。下面的例子先调研校园信息并生成 HTML 简介，再用这份资料制作测验。

![EduWork 工作区：调研校园资料、生成 HTML 简介，并在右侧预览网页成果](docs/images/workspace.png)

<p align="center"><sub>对话和成果并排呈现：继续讨论，也能打开文件查看结果。</sub></p>

打开右侧 Studio，选择一种成果形式：

| 创作与整理 | 理解与学习 |
| --- | --- |
| 报告、数据表、演示文稿 | 思维导图、测验、闪卡 |
| 导出 DOCX、XLSX、PPTX | 浏览引用、答题、查看解析、继续追问 |

音频和视频概览提供另一种阅读资料的方式。文生图和云端 TTS 需配置兼容服务，本机语音取决于系统与本地资源，详见[媒体服务配置](docs/MEDIA.md)。

![Knowledge Studio：报告、思维导图、测验、闪卡、数据表、演示文稿和音视频入口，以及最近生成的成果](docs/images/studio.png)

<p align="center"><sub>同一份资料可以用于不同成果；生成后从「最近成果」打开。</sub></p>

### 从阅读到学习

测验和闪卡支持直接交互。答题后查看反馈、解析与资料依据，遇到不理解的内容可以继续「问问 AI」。

![Studio 测验：答题后查看对错、解析与来源依据，并可继续向 AI 提问](docs/images/quiz.png)

<p align="center"><sub>从答案回到资料，再带着问题继续学习。</sub></p>

### Studio 本身也是插件

Knowledge Studio 以独立插件提供，通过宿主的侧栏插槽（slot）接入工作台，并提供成果能力注册接口。开发者可以扩展成果类型，也可以通过插件接入其他 Studio 界面。Office、语音和媒体生成服务独立维护，供对话与 Studio 复用。

我们希望这里能容纳更多创作与学习方式。新的 Studio 需要实现相应插件适配；目前提供的是 Knowledge Studio。详见 [Studio 架构与扩展接口](packages/dsh-knowledge-studio/docs/ARCHITECTURE.md)。

## 安装与使用

每位用户在自己的电脑上独立运行，无需部署额外的 EduWork 服务端；模型服务由你选择的服务商或机构提供。

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
2. 填写显示名称、本机唯一 `id`、完整发现地址（例如 `https://gateway.example.org/.well-known/litellm-cli-auth`）以及发现文档里的 `issuer`。LiteLLM 自动注册 Client ID，**不需要填写 `clientId`、`client_secret` 或 API Key**。
3. 保存后完全退出并重启，从账户入口登录 LiteLLM；按网关提示选择团队并授权，再选择模型开始对话。

服务端需启用 LiteLLM 原生 CLI OAuth，并提供有模型权限的账号。HTTP 测试环境还需把机构对象中的 `allowInsecureDevelopment` 改为 `true`，HTTPS 保持默认 `false`。字段填写见[逐项配置说明](config/desktop/examples/README.md#接入-litellm改哪里填什么)，版本要求与部署检查见[LiteLLM 接入指南](packages/dsh-oidc/docs/gateway-auth/litellm-setup.md)。

<a id="配置方法"></a>

<details>
<summary>使用学校或企业提供的配置</summary>

1. 在设置中点击 **打开配置文件**，编辑当前生效的 `eduwork.jsonc`。Windows 位于程序目录的 `config/`；macOS 位于 `~/Library/Application Support/eduwork-electron/config/`。
2. 按服务端指南选择旁边 `examples/` 中的示例，将机构条目加入 `organizations`，保留已有配置；需要图像或语音服务时再加入 `media`。只修改示例文件不会生效。
3. 保存后从托盘或应用菜单完全退出并重新启动，再选择机构登录。

配置文件只保存公开接入信息和凭据引用。个人 API Key 在模型设置中管理，登录 Token 保存在本机受保护存储中；不要把密码或令牌写入配置文件。界面 Logo 可配置，程序内嵌图标由发行包提供。

[LiteLLM 示例](config/desktop/examples/litellm.jsonc) · [实验性 oidc-llm 示例](config/desktop/examples/organization.jsonc) · [媒体示例](config/desktop/examples/media.jsonc)

</details>

### 3. 开始工作

选择一个本机工作区，放入任务资料，直接描述你想得到的结果。需要文档、表格等成果时，也可以打开右侧 Studio，选择对应类型开始。

可以先试试：**“根据这些资料生成一份学习指南，再制作配套测验。”**

<details>
<summary>窗口行为与自动更新</summary>

窗口关闭后默认收起到系统托盘；需要完全退出时，使用托盘或应用菜单。公版默认从 GitHub 获取更新，公测与开发渠道可在设置中选择。Windows 使用绿色版更新器；macOS 使用 Sparkle，按提示确认下载和安装后替换应用并重启。机构可配置自己的更新源，更新保留历史数据与用户配置。详见 [Windows 更新说明](docs/UPDATES.md)和 [macOS 更新说明](docs/MACOS_UPDATES.md)。

</details>

## 扩展与贡献

**技能提供任务指引，插件提供可执行能力与界面扩展。** 在技能中心管理内置技能，或导入、编写自己的技能，让对话和 Studio 使用适合你业务的创作方法。

![技能中心：浏览和管理内置技能，导入或创建自己的技能](docs/images/skills.png)

<p align="center"><sub>从任务指引到插件能力，按需扩展工作台。</sub></p>

欢迎贡献新的网关适配、Studio 成果与界面、技能和插件。已有身份、模型和媒体服务优先通过配置连接；机构也可以组合内部插件、技能和默认配置，维护自己的发行版。[EduWork@ECNU](https://github.com/ECNU/EduWork-ECNU) 是基于公版的机构扩展示例。

[贡献指南](CONTRIBUTING.md) · [讨论与反馈](https://github.com/ECNU/EduWork/issues) · [机构发行边界](docs/EDITIONS.md)

## 详细文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/USER_GUIDE.md) | 模型、搜索、语音、文件操作与故障诊断。 |
| [配置文件](docs/CONFIGURATION.md) · [配置示例](config/desktop/examples/README.md) | 企业登录、品牌、媒体服务、更新源与并发设置。 |
| [LiteLLM 接入指南](packages/dsh-oidc/docs/gateway-auth/litellm-setup.md) | 服务端准备、客户端配置、登录及故障排查。 |
| [Knowledge Studio](packages/dsh-knowledge-studio/README.md) | 成果类型、使用方式与扩展开发。 |
| [媒体服务配置](docs/MEDIA.md) | 文生图、云端 TTS 的接口要求及配置方法。 |
| [版本与升级](docs/RELEASE.md) · [更新源部署](docs/UPDATES.md) | 开发版与公测版、数据迁移和自动更新。 |
| [配置与 Skills 更新](docs/CONTENT_UPDATES.md) | 管理员按需独立更新模型配置和官方技能，无需重新下载客户端。 |
| [构建指南](docs/BUILD.md) · [macOS 说明](docs/MACOS.md) | 从源码运行、桌面装配与平台适配。 |
| [贡献指南](CONTRIBUTING.md) · [发行边界](docs/EDITIONS.md) | 参与开发及公版与机构扩展的分工。 |

<details>
<summary>可独立使用的公共模块</summary>

以下模块的源码和文档统一维护在本仓库，npm 包仍独立安装、版本管理和发布，也可供其他 DSH 应用使用。

| 模块文档 | 功能 |
| --- | --- |
| [身份与模型接入（dsh-oidc）](packages/dsh-oidc/README.md) | OIDC / OAuth 登录、Token 模型授权、企业模型目录与服务端接入协议。 |
| [本地记忆（dsh-memory）](packages/dsh-memory/README.md) | 本地记忆与历史检索，延续任务背景。 |
| [邮件助手（dsh-mail）](packages/dsh-mail/README.md) | 通过 IMAP 读取邮件、SMTP 发送邮件，并管理相关权限。 |
| [Studio（dsh-knowledge-studio）](packages/dsh-knowledge-studio/README.md) | 创作、预览和管理报告、表格、演示文稿、学习材料及音视频成果。 |
| [成果与媒体服务（dsh-artifact-services）](packages/dsh-knowledge-studio/packages/artifact-services/README.md) | 供对话和 Studio 共用的 Office、语音、图像与媒体生成服务。 |

模块开发、检查和 npm 发布见[包维护说明](docs/PACKAGES.md)。

</details>

## 数据与隐私

会话、工作区引用和记忆在本机管理。连接远程模型、搜索或媒体服务时，执行任务所需的内容会发送给相应服务商；数据处理规则以所选服务为准。截图使用演示资料，其中的生成内容不作为事实参考。

跨机使用可通过设置中的[历史数据导入](docs/数据导入.md)功能合并会话和客户端目录内的资料；客户端目录之外的工作区文件需要另行复制。故障排查可导出诊断 ZIP，具体会话问题可另外提供 Session log，详见[使用指南](docs/USER_GUIDE.md)。

## 致谢与许可

EduWork 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建，感谢其提供的 Agent 运行时与插件基础。Knowledge Studio 的资料创作与学习交互受 NotebookLM 启发。

EduWork 项目代码采用 [MIT 许可证](LICENSE)。第三方组件保留各自的许可证，详见[第三方声明](THIRD_PARTY_NOTICES.md)。
