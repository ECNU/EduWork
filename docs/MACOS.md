# macOS 支持与贡献

EduWork 提供 Windows x64 和 macOS 15+ Apple Silicon（arm64）开发包。Mac 使用 ad-hoc 签名，尚无 Apple Developer ID 签名或公证，首次打开可能需要系统安全确认。Intel Mac 不在当前构建范围内。

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
| 系统 TTS | 共享服务的 `system` 提供方调用系统 `say`，枚举已安装音色并返回 WAV；中文配音需要中文音色。桌面构建需更新对应 npm 组件锁并验收。 |
| 本地 ASR | 配置匹配架构的 whisper.cpp 和模型，验证参数、路径、取消及输出格式。 |
| 桌面操作 | 验证托盘、窗口恢复、单实例唤起、外部链接、文件打开与 OIDC 回调。 |
| 发行与更新 | 为 macOS 单独实现并验证安装、数据保留、更新失败恢复、签名与公证。 |

Apple Silicon 与 Intel 应分别构建和测试，不能复用 Windows 的运行时目录。最低系统版本由 Electron 和全部原生依赖的实际要求决定，并须在对应系统上验证。

## 开发验证

先准备锁定的核心与插件依赖，完成目标架构的构建，再从打包后的应用运行功能检查。当前 macOS 候选流程只支持 Apple Silicon arm64；不得复用 Windows 运行时。已在 macOS 15.4.1 / arm64 上验证本地候选装配与启动；这不代表其他系统版本或完整功能已通过。

`dsh-electron/scripts/prepare-electron.ps1` 在 macOS 上按上游锁定版本下载并校验 Electron ZIP，复用缓存前检查 `Electron.app` 的版本和二进制架构，不匹配则报错。完成产品、壳、Node 和 OpenSSL 输入准备后，可用以下命令装配未签名候选（路径须替换为实际已验证输入，输出目录不得已存在）：

```powershell
./dsh-electron/scripts/prepare-electron.ps1 -Upstream $Upstream -Output $ElectronInput
./dsh-electron/scripts/assemble-macos.ps1 -Product $Product -ShellBuild $ShellBuild `
  -ElectronRuntime (Join-Path $ElectronInput 'runtime') -Output $Output `
  -Version $Version -Node $Node -OpenSSL $OpenSSL
```

公版的用户配置从包内模板在首次启动时复制到用户目录；已有配置和示例不会被覆盖。机构版推荐[首次启动下载签名配置](PUBLISHER_BOOTSTRAP.md)，CI 原包即可分发，不再要求配置 PKG。选择静态配置部署时仍可传 `-ExternalPublisherConfig <绝对路径>`，保持配置在 `.app` 外。此候选只生成 ad-hoc 签名的 `.app` 与 ZIP，不可视为 Developer ID 签名或公证后的正式发布。

配置、会话、日志、内容更新缓存和渠道偏好保存在 `~/Library/Application Support/<distribution>-electron/`。启用[配置与 Skills 更新](CONTENT_UPDATES.md)后，更新仍在此目录下载、校验和激活，不会修改 `.app`；生效配置统一为该用户目录中的 `config/eduwork.jsonc`，仅保留一份回退备份；旧外部配置只作为首次迁移来源。装配脚本在签名前生成 `Contents/Resources/bundled-skills.json`，记录内置 Skills 的校验值，用来识别本地修改。Windows 继续使用原有绿色版目录和 `RELEASE-MANIFEST.json`。

macOS 可选接入 Sparkle 原生更新：后台检查，用户确认下载及安装后替换应用并重启。发行必须提供独立的更新清单与签名公钥；没有配置更新源的包保持禁用。配置与 Skills 更新继续在用户目录中完成。装配、签名和渠道规则见 [Mac 更新](MACOS_UPDATES.md)。

Pull Request 应说明测试的 macOS 版本、硬件架构、构建命令和功能范围。除启动外，还需覆盖文件权限、中文与空格路径、企业登录、工作区、Office 和音视频。使用合成数据；真实机构登录由具备权限的测试者单独验证。

GitHub macOS runner 可承担构建和自动检查。GUI、系统权限、音色和实际安装体验仍需真机确认。仅生成 `.app` 或解析 npm 依赖成功不代表完整平台支持。

涉及 Electron 菜单或输入行为的修改，应在实际打包应用的对话输入框和设置文本框中，用合成文本验证 `Cmd+A/C/X/V/Z` 与 `Cmd+Shift+Z`，确认全选、复制、剪切、粘贴、撤销和重做，并检查“编辑”菜单。使用真实键盘或系统原生按键自动化；DOM 键盘事件、CDP 输入或 `webContents.sendInputEvent()` 不能替代 macOS 菜单快捷键验收。测试无需发送模型请求。

## CI 开发候选

公版运行 `Build desktop release candidates`，机构版运行 `Build ECNU desktop release candidates`，选择 Windows、Mac 或两者。工作流仅保留验收产物，校验后由维护者发布。公版 Mac 使用 GitHub 仓库 `updates/macos/` 的签名 appcast，程序从 GitHub Release 下载；公开仓库和 CI 只保存验证公钥。

`scripts/ci-eduwork-macos-release.ps1` 在 `macos-15` arm64 runner 上复用公共装配，生成待验收的开发 ZIP，不自动发布 Release。输入为核心目录、机构目录、发行配置、已确认版本与说明文件：

```powershell
./core/scripts/ci-eduwork-macos-release.ps1 -CoreRoot ./core -EditionRoot ./institution `
  -DistributionConfig edition/distribution.json -Version $Version `
  -ReleaseNotesFile "docs/releases/$Version.md" -ReleaseNotesApproved -Output $Output
```

构建从校验锁下载 Node、独立 Python 和 Office wheels、Chromium，并从固定源码构建 OpenSSL 与本地 Whisper CPU 引擎，携带离线语音模型。Python 与浏览器复用已有版本，Mac 专属输入记录在 `config/macos-native.lock.json`。Python 调用关闭字节码缓存，应用启动不修改签名包。

CI 验证解压后的内置浏览器、Python、FFmpeg、转写引擎、LadybugDB、桌面启动与退出，以及启动前后的签名完整性。默认桌面冒烟使用合成账号配置，不访问学校服务。维护者可在签名内容源就绪后添加 `-VerifyPublisherBootstrap`，用原包和全新用户目录检查实际配置下载与激活；不登录账号，下载的配置不进入公开产物。学校登录和系统权限仍须由有权限的测试者确认。产物保持 ad-hoc 签名，没有 Apple 公证，是否启用 Sparkle 由更新源配置和产物回执确认；原生安装验收由独立 Mac CI 执行。

## 发行要求

macOS 包可采用 ZIP 或 DMG，文件名按 [版本与发行规范](RELEASE.md) 区分系统和架构。开发版需要全新用户目录启动与更新验证，并如实声明 ad-hoc 签名的限制；公测发行前还需完成 Developer ID 签名、公证和 Gatekeeper 验收；证书及密码通过受保护的 CI 环境管理。

公版与机构版复用同一构建流程。通过验证的平台才加入正式 Release，更新源按系统、架构和发行身份分别提供产物。

## DMG 拖拽安装窗口

可对已签名的应用单独生成带标题、拖拽指引和 Applications 快捷方式的 DMG；默认候选构建仍生成 ZIP。需要 macOS、Xcode Command Line Tools 及支持 `venv` 和 `pip` 的 Python 3。

```sh
python3 -m venv /tmp/eduwork-dmg-venv
/tmp/eduwork-dmg-venv/bin/python3 -m pip install --only-binary=:all: --require-hashes -r scripts/macos-dmg/requirements.txt
/tmp/eduwork-dmg-venv/bin/python3 scripts/macos-dmg/package.py --app '/path/to/EduWork.app' --output '/path/to/EduWork-macos-arm64.dmg'
```

输出必须不存在。窗口标题读取应用已有的显示名称，保留原文件名和签名，不增加 Apple 公证。脚本校验应用签名及镜像完整性；验收时打开最终 DMG，检查背景、图标布局和 Applications 快捷方式，并验证拖拽安装后的启动与签名。
