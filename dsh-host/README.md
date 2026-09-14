# 共用桌面 Host

[English](README_EN.md)

将锁定的 DSH `0.1.5-rc.2` 桌面 Host 适配到 Electron 与 Go/Wails。两种壳均运行本机单用户 Host。

## 准备适配器

使用 Node 24 执行：
```powershell
node dsh-host/prepare.mjs --upstream <verified-source-directory> --output <candidate-host-directory>
```

准备脚本逐一校验导入源码的固定 SHA-256，使用 Node 的 TypeScript 转换器，无需安装 Electron 或编译器。产物包括 `host-process.mjs`、`host-protocol.mjs`、`desktop-host` 覆盖包、上游 MIT 许可证及输入输出哈希回执。

覆盖包安装到产品 Profile 的 `node_modules/@deepseek-ai/dsh-desktop-host`。`lib/wire.js` 必须与 `lib/index.js` 一起保留；不捆绑无关的 Electron 应用代码。

适配范围包括：

- 保留产品提供的 Agent 预设根目录；没有配置时才使用官方默认目录。
- 独立开发构建可显式设置 `allowLinkedProfile: true`，不因此开启 Node Inspector；默认仍执行官方路径检查。
- 通过 stdin 的单行 JSON 传递可选桌面 bootstrap，凭据不进入参数、环境变量、回执或浏览器状态。
- Host 日志写入 stderr，保证 stdout 是二进制协议；限制保留的日志尾部并向宿主报告生命周期错误。
- 关闭时由 Node 流持有并释放管道描述符，移除 `destroy()` 后的两处手动 `closeSync`，避免 Windows 未完成 I/O 导致重复关闭。派生源码仍受哈希校验约束。

Electron 可直接使用生成的 `DesktopHostProcess`：
```js
const host = new DesktopHostProcess(nodePath, profilePath, undefined, {
  bootstrap, allowLinkedProfile: true, onFailure,
})
await host.start()
const response = await host.fetch(request)
await host.stop()
```

## Wails 传输

Wails 使用 `dsh-desktop/internal/desktoptransport`。Windows Go 的 `os/exec` 不支持 `ExtraFiles`，因此由 `bridge.mjs` 持有 Node 所需的 fd 3/fd 4 管道和 fd 5 生命周期 IPC；Go 父进程通过 stdin/stdout 与其通信。不加载 DSH WebServer 插件。

壳保留两个私有 loopback 服务：bootstrap 提供的认证凭据/浏览器桥，以及用于 Wails 媒体和下载的只读流式服务。它们均不提供多人共享应用服务。

Wails 2 在 Windows 上会缓冲 AssetServer 响应直到 EOF，因此有限静态文件与 RPC 响应限制为 32 MiB。持续事件流改用 `EventBridge.Open/Next/Cancel` 原生绑定。每次提供顶层页面前递增文档代次、取消上一页的活动和待处理订阅，并将代次注入事件适配器；页面刷新释放遗留读取，旧 JavaScript 无法重新订阅。

`/api/` 下的 GET/HEAD 请求通过 307 跳转到流式媒体服务，仍经同一 Go/Node/官方 Host 管道读取。支持 Range 的文件先读取 HEAD 元数据，再每次最多读取 256 KiB 并立即发送给浏览器。暂停的媒体不会占住共享响应管道或阻塞其他 RPC。原生音视频、Range/HEAD 和下载链接直接使用此机制，不要求专用渲染组件；Electron 也可采用相同的有界读取契约，无需引用 Go/Wails 代码。

每次跳转使用随机、限定到单个资源的读取授权，有效期 30 分钟且仅限当前进程。URL 不是身份或 bootstrap 凭据，不含原文件查询，不记录到日志或磁盘。服务仅绑定 `127.0.0.1`，校验 Host 及 Wails Origin/Referer，严格限定 CORS，拒绝修改方法和改变的查询，并在退出时清除授权。Wails 自定义 AssetServer 无法加载 WebView2 ServiceWorker，因此不使用该方案。

## 桥协议与生命周期

外层桥保留 DSH3 的 13 字节帧头和 64 KiB 原始正文块。非零流 ID 使用请求/响应的开始、数据、结束、取消和错误帧；响应类型 5 每次授予一个上传块，避免缓冲上传阻塞取消。

流 0 留给桥协议 1：请求 128 初始化私有 bootstrap，129 关闭；响应 128 表示就绪、129 致命错误、130 已停止。这些控制帧不进入官方 Host 线路。Go 请求上下文与响应正文 `Close` 会传播取消，流式正文与 Range 头直接透传。Windows Job Object 包含桥和 Host，父进程异常结束时也能清理。

## 独立 Wails 装配

入口为 `dsh-desktop/cmd/eduwork-wails-candidate`，默认读取 exe 旁的 `eduwork.desktop.json`，开发时可用 `--config` 指定其他清单。产品、Node、Host 与数据路径隔离；写 Profile 或启动 Host 前获取独占数据目录租约。与 Electron 共用 `product-profile-cli.mjs`，但使用独立 Windows Credential Manager 命名空间。

`--probe` 在不开窗口时检查实际官方 Host 首页和传输注入。该入口独立于 `main.go` 和旧更新器。

`dsh-desktop/scripts/assemble-official-host.ps1` 接收 `-Product`、`-HostAdapter`、`-Output`、带相邻 `LICENSE` 的 Node 24.18.0 及可选 `-Version`，回执分别记录产品和壳版本。拒绝已存在的输出目录及 `current`。`build-official-host.ps1` 可重建已退出的独立构建 exe，无需重复制全部 Runtime。

构建使用校验过的 go-webview2 派生源码与独立 Go modfile，不修改原 `go.mod`、模块缓存或 `main.go`。仅显式设置 `EDUWORK_DESKTOP_CDP_PORT` 为 1024–65535 的整数时启用诊断 CDP，且只监听 loopback。

## 验证
```powershell
$env:DSH_HOST_SOURCE = '<verified-source-directory>'
node --test dsh-host/test/prepare.test.mjs
$env:DSH_HOST_ADAPTER = '<prepared-host-directory>'
cd dsh-desktop
go test ./internal/desktoptransport ./internal/nativevault -count=1
```

协议测试使用真实准备后的 `DesktopHostProcess`、编解码器和小型合成 Host，覆盖 9 MB 二进制上传/响应、媒体 Range、原生事件拉取、读取授权边界、EOF 前响应、暂停 40 MiB 读取时并行 RPC、页面刷新后的订阅恢复、上传与响应取消、Host 错误、stdin bootstrap 和退出。

产品 Profile、登录、预览和原生窗口需要在装配结果上另行验收。生成适配器、日志、Profile 和用户凭据只放入被忽略的构建目录。
