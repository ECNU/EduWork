# EduWork 官方 Electron 桌面集成

[English](README_EN.md)

这是独立于 `dsh-desktop/`（Go + Wails）的第二个桌面装配入口。两种宿主共用同一份 EduWork 产品装配、插件、技能及预览实现。

桌面基底锁定 DSH `0.1.5-rc.2`（`fb2c4b9e698e30edb738bca4cf0618587db7d203`）。Electron 主进程、窗口、`dsh-app://` 和流式 Host 传输从该提交派生，产品适配以可核对的补丁生成，不修改共享的官方源码缓存。Host 适配放在 `../dsh-host/`，供两种桌面宿主复用。

每个发行版独立使用应用标识、浏览器缓存、DSH 数据和凭据。桌面构建沿用锁定的 npm 插件组合。更新入口由发行配置决定；公版默认使用 GitHub，用户可通过配置覆盖来源或关闭更新。开发验证使用独立数据目录。

## 构建入口

完整 Windows 测试包使用[构建指南](../docs/BUILD.md#从-web-到桌面)中的入口，包含工具要求、公版与机构版命令及输出位置。在干净的 EduWork 检出目录准备 Git、PowerShell 7、Node.js 24.18.0、Go 1.26.6 和 Visual Studio 2022 C++ Build Tools 后运行：

```powershell
$Version = (Get-Content source-receipt.json -Raw | ConvertFrom-Json).version
./scripts/ci-eduwork-windows-release.ps1 -CoreRoot . -EditionRoot . `
  -DistributionConfig config/distributions/generic.json -Version $Version `
  -Development -Output ../eduwork-electron-test
```

版本须为 `X.Y.Z-dev.YYYYMMDD.N`，输出目录须尚不存在。该命令复用 CI 配方，在 `publish/` 生成经过检查的 ZIP，不创建 Release；自动准备锁定上游、Host、原生资源和 Electron，无需填写未定义的本地输入变量。真实登录、媒体质量和升级另做验收。

单独调试 Host 或壳时，可按[共用构建脚本](../scripts/ci-eduwork-windows-release.ps1)查看已准备的 `host/`、`product/`、`inputs/`、`electron/` 和 `shell/`。其中[原生资源准备](../scripts/prepare-windows-release-inputs.ps1)在 `inputs/inputs.json` 记录输入路径与哈希。`assemble-desktop-candidate.ps1` 支持 `electron`、`wails` 和 `both`，只有核对壳一致性时才需要双壳。锁定基线的官方 Host 没有 npm 包，按固定源码构建；macOS 仍需独立适配和真机验收。

## 本机数据与比较

任务提醒与托盘待处理菜单见[桌面通知](../docs/DESKTOP_NOTIFICATIONS.md)。事件处理由公版实现，机构版共用；原生通知需按平台验收。

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
