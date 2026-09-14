# macOS 支持与贡献

EduWork 当前提供 Windows x64 桌面包。macOS 桌面装配、原生资源和系统集成仍需适配，尚无可用的完整 macOS 发行包。

## 共用架构

macOS 使用 Electron，并复用同一套工作区、Studio、插件和配置。机构发行引用公共核心，不另行维护平台功能。DSH、Node、Electron 及 npm 插件版本以仓库锁文件为准，构建过程中不跟随上游最新版。

相关入口：

- [Electron 壳](../dsh-electron/README.md)：官方源码与产品适配的组合方式。
- [Host](../dsh-host/README.md)：桌面通信、凭据和本地运行服务。
- [构建指南](BUILD.md)：npm 组件锁、资源准备和装配输入。
- [共享服务平台要求](../packages/dsh-knowledge-studio/packages/artifact-services/docs/PLATFORMS.md)：Python、语音和媒体依赖。

## 适配范围

| 部分 | macOS 要求 |
| --- | --- |
| 应用与数据目录 | 应用包保持只读；将配置、会话、日志、缓存和下载内容放在用户可写目录。 |
| Native 模块 | 在目标架构安装并验证 PTY、文件锁、数据库等原生模块；区分 Node 与 Electron ABI。 |
| Office | 提供可重定位 Python、所需 wheels 和字体，验证 DOCX/XLSX/PPTX 生成与预览。 |
| 媒体 | 提供架构匹配的 Chromium、FFmpeg 和 Remotion 组件，复用公共媒体服务。 |
| 系统 TTS | 增加 macOS 语音提供方，枚举真实音色并通过统一接口返回 WAV。 |
| 本地 ASR | 配置匹配架构的 whisper.cpp 和模型，验证参数、路径、取消及输出格式。 |
| 桌面操作 | 验证托盘、窗口恢复、单实例唤起、外部链接、文件打开与 OIDC 回调。 |
| 发行与更新 | 为 macOS 单独实现并验证安装、数据保留、更新失败恢复、签名与公证。 |

Apple Silicon 与 Intel 应分别构建和测试，不能复用 Windows 的运行时目录。最低系统版本由 Electron 和全部原生依赖的实际要求决定，并须在对应系统上验证。

## 开发验证

先准备锁定的核心与插件依赖，完成目标架构的构建，再从打包后的应用运行功能检查。当前 Windows PowerShell 装配脚本不是现成的 macOS 构建入口。

Pull Request 应说明测试的 macOS 版本、硬件架构、构建命令和功能范围。除启动外，还需覆盖文件权限、中文与空格路径、企业登录、工作区、Office 和音视频。使用合成数据；真实机构登录由具备权限的测试者单独验证。

GitHub macOS runner 可承担构建和自动检查。GUI、系统权限、音色和实际安装体验仍需真机确认。仅生成 `.app` 或解析 npm 依赖成功不代表完整平台支持。

## 发行要求

macOS 包可采用 ZIP 或 DMG，文件名按 [版本与发行规范](RELEASE.md) 区分系统和架构。面向普通用户发行前，完成 Developer ID 签名、公证、Gatekeeper、全新用户目录启动和更新验证；证书及密码通过受保护的 CI 环境管理。

公版与机构版复用同一构建流程。通过验证的平台才加入正式 Release，更新源按系统、架构和发行身份分别提供产物。
