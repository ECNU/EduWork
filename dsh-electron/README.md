# EduWork 官方 Electron 桌面集成

[English](README_EN.md)

这是独立于 `dsh-desktop/`（Go + Wails）的第二个桌面装配入口。两种宿主共用同一份 EduWork 产品装配、插件、技能及预览实现。

桌面基底锁定 DSH `0.1.5-rc.2`（`fb2c4b9e698e30edb738bca4cf0618587db7d203`）。Electron 主进程、窗口、`dsh-app://` 和流式 Host 传输从该提交派生，产品适配以可核对的补丁生成，不修改共享的官方源码缓存。Host 适配放在 `../dsh-host/`，供两种桌面宿主复用。

每个发行版独立使用应用标识、浏览器缓存、DSH 数据和凭据。桌面构建沿用锁定的 npm 插件组合。更新入口由发行配置决定；未配置更新源时不会自动下载新版本。开发验证使用独立数据目录。

## 构建入口

先完成同版本的 Web 产品装配。公版或机构版由 `$WebProduct` 的发行配置决定，壳中不复制业务代码。以下变量都指向明确选择、校验过的本地输入；Node 使用官方解压目录中的 `node.exe`，旁边应保留 `LICENSE`。

```powershell
node dsh-host/prepare.mjs --upstream $Upstream --output $HostAdapter
./scripts/prepare-desktop-product.ps1 -WebAssembly $WebProduct -HostAdapter $HostAdapter -Output $DesktopProduct

# 原生资源参数来自本地缓存位置配置，只包含资源路径，不包含账号。
./scripts/prepare-desktop-resources.ps1 -OutputRoot $DesktopProduct @NativeResourceInputs

./dsh-electron/scripts/prepare-electron.ps1 -Upstream $Upstream -Output $ElectronCache
node dsh-electron/scripts/build-shell.mjs --upstream $Upstream --host $HostAdapter --output $ElectronShellBuild
./scripts/assemble-desktop-candidate.ps1 -Shell electron -Product $DesktopProduct -HostAdapter $HostAdapter `
  -ElectronShellBuild $ElectronShellBuild -ElectronRuntime "$ElectronCache/runtime" `
  -Node $Node -OutputRoot $CandidateRoot -Version '0.3.5-dev.20260912.3'
```

`-Shell electron`、`wails` 或 `both` 选择装配目标。输出分别为 `electron-candidate/` 和 `wails-candidate/`；已存在的目标会被拒绝，构建 Electron 需要锁定上游源码已经安装的构建依赖；Wails 需要 Go、Windows 构建工具和 WebView2。

日常测试默认只装配 Electron，再分别选择公版/ECNU 发行配置；修改 Host 或壳适配时才使用 `both` 做一致性验收。DSH 桌面 Host 在此基线没有 npm 包，是固定官方源码构建的明确例外，不能用不存在的 npm 包替代。macOS 仍需平台适配和原生验收，Windows 脚本不能直接产出可用的 Mac 发行包。

## 本机数据与比较

Electron 默认数据为 `<安装目录>/data/<发行名>-electron/{dsh,browser,logs}`，系统加密凭据单独保存在 browser 目录；Wails 使用 `<安装目录>/data/<发行名>-wails/dsh` 与独立 Windows Credential Manager 命名空间。关闭程序后可以移动整个目录，已登记的外部工作区原文件位置仍需有效。直接解压启动不会扫描旧数据；从 Go 过渡版的经过校验的更新握手启动时，会导入当前 Go 数据目录，两壳不同时写同一份会话库。

候选固定插件和 Host 组合。托盘提供打开、新建会话、检查更新、设置和退出。`config/eduwork.jsonc` 配置更新入口；[绿色版更新适配器](src/portable-updates.mjs)调用共用下载和安装控制器，支持开发/公测渠道、下载进度与重启安装。旧 Go 过渡更新器可通过经过校验的握手调用 `legacy-migration.mjs`，按握手类型导入旧 `data/dsh` 或 Go 过渡版的数据目录，保留原始数据；普通启动不自动扫描其他安装。用户也可从设置中选择旧客户端根目录，检查并合并历史数据。版本发布前必须对实际 ZIP 执行相应迁移验收，不能用一次历史验收替代新包验证。安装器、签名及 macOS 仍需独立推进。

面向 Go 过渡用户的 Windows 包，装配后须先运行 `build-legacy-shortcuts.ps1 -Candidate <electron-candidate>`，再运行 `pack-migration-release.ps1 -Candidate <electron-candidate> -Output <zip> -Migration wails-host-v1`。它仅生成兼容旧快捷方式的小型启动器，不构建 Go 桌面壳。

## 验证入口

```powershell
node --test dsh-electron/tests/native-vault.test.mjs dsh-electron/tests/lifecycle.test.mjs dsh-electron/tests/media-transport.test.mjs dsh-host/test/product-profile.test.mjs
node dsh-electron/tests/desktop-smoke.mjs --shell electron --product $Product --cdp http://127.0.0.1:9333 --data-root $TestData --evidence $Evidence
node scripts/verify-desktop-parity.mjs --reference $DesktopProduct --electron $ElectronProduct --wails $WailsProduct --evidence $ParityResult
```

窗口验收只在明确开启的本机调试端口运行。Electron 用 `--remote-debugging-port=9333 --remote-debugging-address=127.0.0.1`；Wails 候选用 `EDUWORK_DESKTOP_CDP_PORT=9334`，默认均不开放调试端口。Electron 的 `EDUWORK_DESKTOP_TEST_DATA_ROOT`、Wails 的 `--home` 可将合成数据留在验收目录。

共同的真实文件预览与上传脚本为 `tests/desktop-preview-acceptance.mjs`。`tests/desktop-conversation-acceptance.mjs` 仅对明确配置的私有验收 provider 发两条有界合成请求，并在退出时清理临时凭据；不将测试配置放进产品包。OIDC 系统加密与 Host 联合测试见 [测试说明](tests/oidc-native-vault.md)。实际通过范围及限制应随该次发行的验收回执提供，源码仓不打包内部测试日志或用户数据。

普通网页链接由系统浏览器打开，应用窗口保持在本机工作台。`tests/external-navigation.electron.mjs` 使用真实 Electron 隐藏测试页面验证同窗口/新窗口链接，捕获浏览器启动调用，不打开用户账号页面；无需远程调试端口。静态导航策略另有单元测试。
