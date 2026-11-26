# 共用桌面 Host

[English](README_EN.md)

将锁定的 DSH `0.1.5-rc.2` 桌面 Host 适配到 Electron，运行本机单用户 Host。

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

## 验证
```powershell
$env:DSH_HOST_SOURCE = '<verified-source-directory>'
$env:EDUWORK_TEST_RUNTIME = '<pinned-legacy-runtime-directory>'
node --test dsh-host/test/prepare.test.mjs
```

产品 Profile、登录、预览和原生窗口需要在装配结果上另行验收。生成适配器、日志、Profile 和用户凭据只放入被忽略的构建目录。
