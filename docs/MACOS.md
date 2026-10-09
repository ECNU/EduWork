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

开发包优先使用[构建指南](BUILD.md#本机构建)中的 Node.js 入口，先准备锁定的核心与插件依赖，再从打包后的应用运行功能检查。当前 macOS 候选流程只支持 Apple Silicon arm64；不得复用 Windows 运行时。macOS 15.4.1 与本机 macOS 27.0 的候选装配及启动已有验证记录；具体验收范围仍以各次回执为准。

需要单独定位 Electron 输入或装配步骤时，可使用 Node.js 脚本按上游锁定版本下载并校验 Electron ZIP；复用缓存前检查 `Electron.app` 的版本和二进制架构，不匹配则报错。完成产品、壳、Node 和 OpenSSL 输入准备后，可用以下命令装配候选（路径须替换为实际已验证输入，输出目录不得已存在）：

```sh
node dsh-electron/scripts/prepare-electron.mjs --upstream "$UPSTREAM" --output "$ELECTRON_INPUT"
node dsh-electron/scripts/assemble-macos.mjs \
  --product "$PRODUCT" --shell-build "$SHELL_BUILD" \
  --electron-runtime "$ELECTRON_INPUT/runtime" --output "$OUTPUT" \
  --version "$VERSION" --node "$NODE" --openssl "$OPENSSL"
```

公版的用户配置从包内模板在首次启动时复制到用户目录；已有配置和示例不会被覆盖。机构版推荐[首次启动下载签名配置](PUBLISHER_BOOTSTRAP.md)，CI 原包即可分发，不再要求配置 PKG。选择静态配置部署时仍可传 `--external-publisher-config <绝对路径>`，保持配置在 `.app` 外。此候选只生成 ad-hoc 签名的 `.app` 与 ZIP，不可视为 Developer ID 签名或公证后的正式发布。

配置、会话、日志、内容更新缓存和渠道偏好保存在 `~/Library/Application Support/<distribution>-electron/`。启用[配置与 Skills 更新](CONTENT_UPDATES.md)后，更新仍在此目录下载、校验和激活，不会修改 `.app`；生效配置统一为该用户目录中的 `config/eduwork.jsonc`，仅保留一份回退备份；旧外部配置只作为首次迁移来源。装配脚本在签名前生成 `Contents/Resources/bundled-skills.json`，记录内置 Skills 的校验值，用来识别本地修改。Windows 继续使用原有绿色版目录和 `RELEASE-MANIFEST.json`。

macOS 可选接入 Sparkle 原生更新：后台检查，用户确认下载及安装后替换应用并重启。发行必须提供独立的更新清单与签名公钥；没有配置更新源的包保持禁用。配置与 Skills 更新继续在用户目录中完成。装配、签名和渠道规则见 [Mac 更新](MACOS_UPDATES.md)。

Pull Request 应说明测试的 macOS 版本、硬件架构、构建命令和功能范围。除启动外，还需覆盖文件权限、中文与空格路径、企业登录、工作区、Office 和音视频。使用合成数据；真实机构登录由具备权限的测试者单独验证。

GitHub macOS runner 可承担构建和自动检查。GUI、系统权限、音色和实际安装体验仍需真机确认。仅生成 `.app` 或解析 npm 依赖成功不代表完整平台支持。

涉及 Electron 菜单或输入行为的修改，应在实际打包应用的对话输入框和设置文本框中，用合成文本验证 `Cmd+A/C/X/V/Z` 与 `Cmd+Shift+Z`，确认全选、复制、剪切、粘贴、撤销和重做，并检查“编辑”菜单。使用真实键盘或系统原生按键自动化；DOM 键盘事件、CDP 输入或 `webContents.sendInputEvent()` 不能替代 macOS 菜单快捷键验收。测试无需发送模型请求。

## CI 开发候选

开发包与双平台发布候选的构建入口、版本范围和命令见[构建指南](BUILD.md#选择入口)。开发包在 `macos-15` arm64 runner 上构建、验收并上传 artifact；候选发布须由维护者单独授权。公版 Mac 使用 GitHub 仓库 `updates/macos/` 的签名 appcast，程序从 GitHub Release 下载；公开仓库和 CI 只保存验证公钥。

构建从校验锁下载 Node、独立 Python 和 Office wheels、Chromium，并从固定源码构建 OpenSSL 与本地 Whisper CPU 引擎，携带离线语音模型。Python 与浏览器复用已有版本，Mac 专属输入记录在 `config/macos-native.lock.json`。Python 调用关闭字节码缓存，应用启动不修改签名包。

CI 验证解压后的内置浏览器、Python、FFmpeg、转写引擎、LadybugDB、桌面启动与退出，以及启动前后的签名完整性。默认桌面冒烟使用合成账号配置，不访问学校服务。维护者可在签名内容源就绪后添加 `--verify-publisher-bootstrap`，用原包和全新用户目录检查实际配置下载与激活；不登录账号，下载的配置不进入公开产物。学校登录和系统权限仍须由有权限的测试者确认。产物保持 ad-hoc 签名，没有 Apple 公证，是否启用 Sparkle 由更新源配置和产物回执确认；原生安装验收由独立 Mac CI 执行。

## 发行要求

macOS 包可采用 ZIP 或 DMG，文件名按 [版本与发行规范](RELEASE.md) 区分系统和架构。开发版需要全新用户目录启动与更新验证，并如实声明 ad-hoc 签名的限制；公测发行前还需完成 Developer ID 签名、公证和 Gatekeeper 验收；证书及密码通过受保护的 CI 环境管理。

公版与机构版复用同一构建流程。通过验证的平台才加入正式 Release，更新源按系统、架构和发行身份分别提供产物。

## DMG 拖拽安装窗口

双平台候选 CI 的 Node 入口通过 `scripts/prepare-macos-dmg.mjs` 从已验收 ZIP 内应用生成 DMG；旧 PowerShell 配方使用 `scripts/prepare-macos-dmg.ps1`。两者均挂载最终只读镜像，核对应用文件、签名、背景及 Applications 快捷方式；两种下载格式包含相同应用。

可在 macOS 上为现有应用生成带标题、拖拽指引和 Applications 快捷方式的 DMG。需要 Xcode Command Line Tools 及支持 `venv` 和 `pip` 的 Python 3.10+。

```sh
python3 -m venv /tmp/eduwork-dmg-venv
/tmp/eduwork-dmg-venv/bin/python3 -m pip install --only-binary=:all: --require-hashes -r scripts/macos-dmg/requirements.txt
/tmp/eduwork-dmg-venv/bin/python3 -B -m unittest discover -s scripts/macos-dmg -p 'test_*.py'
/tmp/eduwork-dmg-venv/bin/python3 scripts/macos-dmg/package.py --app '/path/to/EduWork.app' --output '/path/to/EduWork-macos-arm64.dmg'
```

输出必须不存在。窗口标题读取应用已有的显示名称，保留原文件名和签名，不增加 Apple 公证。脚本校验应用签名及镜像完整性；验收时打开最终 DMG，检查背景、图标布局和 Applications 快捷方式，并验证拖拽安装后的启动与签名。

## 安装与 DMG 清理

将应用从 DMG 拖入“应用程序”目录后，打开安装好的应用才会触发清理；仅完成拖拽不会触发。应用会核对仍挂载的 DMG：安装卷内须有同名应用，且两份应用均通过签名校验并具有相同签名身份；只有唯一匹配时才记录该镜像。未发现来源、来源不匹配或存在多个匹配镜像时保留文件，后续启动可以重新识别。

安装后的应用在启动早期、单实例检查及加载工作环境和登录前，自动正常推出确认过的源安装卷，再将 DMG 移到废纸篓，无需额外确认。清理前再次校验应用签名及镜像文件身份；卷被占用会短暂重试，不强制推出。失败时保留文件及记录，后续启动重试同一源镜像；应用签名变化后保留旧镜像，重新核对新安装的来源。清理不删除已安装应用或用户数据，也不搜索下载目录中的其他安装包。

只有安装卷已推出且 DMG 已移入废纸篓，才记录清理完成；完成后的同一安装副本不再扫描。应用替换或重新安装后可重新识别。旧版本提前写入但未标记清理完成的安装记录也允许重试。

从 DMG 安装卷直接双击应用时，应用会记录源 DMG，通过 macOS 原生安装接口搬移到“应用程序”目录，再启动安装好的应用执行清理。存在已有版本时询问是否替换；不覆盖仍在运行的已有版本。系统可能要求安装授权；取消或失败时保留 DMG 并退出，之后启动原有应用不会清理该镜像，重新安装仍可识别。
