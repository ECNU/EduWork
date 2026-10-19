# DSH Knowledge Studio

版本：Studio `0.6.0` / Artifact Services `0.3.0`，要求 Node.js 24.18+ 与 DSH 0.2.1-rc.2。无需 EduWork 桌面桥接或机构账号。

[English](README_EN.md)

为 DeepSeek Harness 的工作区提供资料驱动的创作与学习工具。直接使用现有文件、对话和模型配置；直接读取原始资料，已有本地索引可供成果检索使用。

| Studio | 成果 |
| --- | --- |
| 报告 | 简报、学习指南、自定义报告；DOCX、PDF、Markdown |
| 演示文稿 | 可编辑 PPTX、PDF、HTML |
| 数据表 | XLSX、CSV |
| 思维导图 | 节点浏览、引用和追问；PNG、SVG、Markdown |
| 测验 / 闪卡 | 答题反馈、学习进度；含答案的 Markdown、PDF |
| 音频 / 视频概览 | WAV、MP4、字幕、可选旁白和配乐、视频预览 |

成果使用官方侧栏全屏阅读，保留原会话与输入草稿，引用可追溯到工作区资料。支持的成果类型见上表。

Office 技能复用宿主提供的官方处理流程。Studio 报告、表格和幻灯片的结构检查及 PDF 转换与对话共用官方组件，PDF 从实际保存的 Office 文件生成。宿主依赖和旧格式支持见[Office 工作流](packages/artifact-services/docs/OFFICE_PROCESSING.md)。

从官方侧栏「开始」页打开 Studio。宿主管理标签页、折叠和全屏状态；Studio 界面跟随蓝色/红色与明暗主题，导出文件保留自己的配色。

DSH 0.2 桌面版中，已保存的 Word、表格和演示文稿可点击「打开文件预览」，进入官方文件查看器，与对话中的文件使用同一入口。Studio 保留生成、下载、讲稿、引用和成果管理；测验、闪卡、导图及音视频仍可直接交互。旧宿主保留原有 Office 预览兼容实现。官方表格视图以单元格内容为主，复杂排版和对象请用 Office 或 WPS 查看。

## 两个独立包

| 包 | 版本 | 职责 |
| --- | --- | --- |
| `@eduwork/dsh-knowledge-studio` | `0.6.0` | 工作区资料、成果检索、Studio 界面与成果 |
| `@eduwork/dsh-artifact-services` | `0.3.0` | Office 与预览、TTS/ASR、媒体渲染、对话工具与通用技能 |

Studio 精确依赖共享包，两包版本应配套安装。共享服务也可以供其他应用或插件直接使用，不依赖 Studio 或机构服务。

## 安装

插件管理器会安装配套共享服务。使用宿主已有的模型配置；Office、语音和媒体能力还需要下述运行环境。

在已有 Profile 项目中安装精确版本：

```sh
dsh plugin --profile web add @eduwork/dsh-knowledge-studio@0.6.0
```

从源码构建（在 `EduWork/packages/dsh-knowledge-studio` 执行）：

```sh
npm ci
npm run build
npm run pack:release
```

将 `dist/packages/` 中两个压缩包复制到目标 Profile 项目，再在该项目中一起安装：

```sh
npm install ./eduwork-dsh-artifact-services-0.3.0.tgz ./eduwork-dsh-knowledge-studio-0.6.0.tgz
```

安装本地 tarball 不会自动启用目标 Profile；启用步骤、独立 Web 启动及运行环境配置见 [使用指南](docs/USAGE.md)。加载 Studio bundle 时会注册共享服务；不要另装第二份共享服务或旧 Office 执行插件。

Office 需要另行准备 Python 3.12+ 和共享包的 `python/requirements.txt`，以 `DSH_OFFICE_PYTHON` 指向解释器。PDF、视频使用 Chromium；可注入已准备的运行时，独立渲染首次使用可准备 Remotion 浏览器；Studio 的能力检查本身不会下载组件，离线使用须事先配置。共享媒体运行时固定 Remotion `4.0.520`、mediabunny `1.55.5`、React/React DOM `18.3.1`。Windows System.Speech 和 macOS 系统 say 可使用本机已安装的音色离线配音；其他系统或厂商可通过统一接口注册语音提供方。音频转写通过共享 ASR 服务扩展，本地 whisper.cpp 可执行文件与模型需宿主另行准备，不随 npm 包分发。详见 [扩展接口](docs/ARCHITECTURE.md)。

## 开发与边界

[开发和测试](docs/DEVELOPMENT.md) · [架构](docs/ARCHITECTURE.md) · [迁移](docs/MIGRATION.md) · [版本记录](CHANGELOG.md) · [发布流程](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/docs/RELEASING.md)

索引和检索在本机运行。生成报告或媒体脚本会调用用户配置的模型并发送所需资料；费用和数据处理由该模型服务决定。打开 Studio 不会自动扫描全工作区或启动模型任务。

对话与 Studio 复用同一套 Office、语音、媒体生成和真实文件预览服务。Studio 保留资料引用与学习交互；可编辑 React 视频工程等高级操作由对话工具提供，并非每个对话工具都有 Studio 卡片。

Office 处理支持文档中列出的结构化功能，不承诺完整 Office 排版、宏或演示动画编辑；公式重算复用官方 LibreOffice Kit。字幕按实际语音片段同步，不承诺逐字时间戳。可编辑视频工程会执行工作区 React 代码，只应渲染可信工程。

项目代码按 [MIT](LICENSE) 提供。Remotion、Chromium、PDF.js 和其他依赖保留自己的许可；MIT 不覆盖它们的全部使用条件。见 [第三方说明](THIRD_PARTY_NOTICES.md) 和 [配乐来源](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/packages/artifact-services/media/BGM-USAGE.md)。

平台支持取决于已准备的 Office、语音与媒体运行环境，要求见[平台说明](https://github.com/ecnu/EduWork/blob/main/packages/dsh-knowledge-studio/packages/artifact-services/docs/PLATFORMS.md)。

源码、Issue 与 PR 统一在 [EduWork](https://github.com/ecnu/EduWork/tree/main/packages/dsh-knowledge-studio)。开发命令在 `EduWork/packages/dsh-knowledge-studio` 中执行，npm 安装保持独立；发布流程见[包维护说明](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES.md)。
