# 更新源部署与 GitHub 接入

[发行与版本规则](RELEASE.md) · [发行边界](EDITIONS.md) · [配置示例](../config/desktop/examples/updates.jsonc)

Windows 公版默认从 `ecnu/EduWork` 的 GitHub Releases 获取更新。机构可在配置文件中覆盖为静态更新源。企业登录与更新源相互独立，登录某个企业不会改变发行身份或更新渠道。

## 是否必须使用 OSS

不必须。OSS、其他对象存储、CDN 或普通 HTTPS 静态文件服务器，都可以提供更新清单与安装包。客户端不调用阿里云管理 API，也不需要云账号；发行方在上传端管理写入权限即可。

GitHub Releases 可以作为唯一发行来源，不要求同时购买 OSS。两种来源共用检查更新、左下角提示、下载进度、校验与重启安装；GitHub 通过 `provider` 和 `repository` 配置，不把发布网页当作静态 JSON 清单。

## 当前支持到哪里

| 场景 | 当前状态 |
| --- | --- |
| Windows Electron + 配置好的静态 HTTPS 更新源 | 已实现后台检查、下载/续传、进度、SHA-256 校验、立即或下次启动安装 |
| Windows 公版用户配置留空 | 使用随包 GitHub 默认源；从旧 Go 迁入时优先保留原机构更新源 |
| ECNU 旧 Go → Go 过渡版 → Electron | 使用独立兼容清单与已验收的迁移包，不能混入公版入口 |
| GitHub CI 创建 Release | 生成 ZIP、校验文件、回执、已确认的说明及更新清单；全部上传校验后才发布，不切换 OSS 指针 |
| 直接从 GitHub 自动发现和安装 | 已实现 Windows 来源适配，共用现有下载与安装器；按用户所选渠道接收已发布公测版或开发版 |
| 私有仓库、草稿、没有已发布版本 | 提示尚无可读取的版本；不内置 GitHub Token，不影响正常使用应用 |
| macOS 自动更新 | 待真机适配与签名/更新验收，见 [MACOS](MACOS.md) |

Windows 使用 `dsh-electron/src/portable-updates.mjs` 调用共用更新辅助程序，核心实现在 `dsh-desktop/internal/updater/`。GitHub 适配位于 `github.go`，不使用上游 DSH 的更新源，也不另建 `electron-updater` 安装路径。其他平台的下载页入口不等于支持 Windows 安装协议。

## GitHub 配置与默认值

公版无需额外配置。要显式选择 GitHub，可在 `config/eduwork.jsonc` 中写入：

```json
"updates": {
  "provider": "github",
  "repository": "ecnu/EduWork",
  "defaultPolicy": "stable"
}
```

`repository` 只接受 `owner/repo`，不接受 URL 或 Token。`updates` 中省略来源时使用随包默认值；旧安装的有效 `config/update.bridge.json` 优先于新的随包默认源。显式 `manifestURL` 切换到静态源；显式 `provider: github` 切回 GitHub。两种来源不要混填。`provider: disabled` 关闭在线检查。修改后从托盘退出并重新启动。

GitHub 公测渠道通过 `/repos/{owner}/{repo}/releases/latest` 读取非 prerelease 的 `vX.Y.Z`。开发渠道同时读取 Release 列表，接收标为 prerelease 的 `vX.Y.Z-dev.YYYYMMDD.N`，与公测候选按 SemVer 比较取较新者。列表分页读取，超过 200 个记录时提示发行方归档，不悄悄选取不完整结果。草稿、其他格式标签、错误发行/平台/壳、错误大小或摘要都不能作为更新；所有来源均不降级。

元数据缓存 15 分钟，过期后使用 ETag 条件请求；不可读与限流结果同样退避 15 分钟。手动连续点击不会反复请求 GitHub。错误会明确显示，不当作“已是最新版本”。客户端匿名请求，不读取学校登录令牌或 GitHub 凭据；只允许配置仓库的对应 tag 资产及 GitHub 下载服务器上的 HTTPS 跳转。

## 静态 HTTPS 更新源的现有要求

1. **稳定且可直接读取的 HTTPS 地址。** 清单和文件 GET 不应要求网页登录、Cookie 或给用户分发上传密钥。当前配置入口不支持下载源的自定义认证头。现有初始 URL 不接受用户名、密码、查询参数和片段；临时签名 URL 不适合作为渠道配置。
2. **按发行与路线分开目录。** 公版、ECNU、旧 Go、Go → Electron 各自使用独立的根路径。清单按 `stable` / `development` 和平台定位；公测只提供 `X.Y.Z`，开发渠道可提供 `X.Y.Z-dev.YYYYMMDD.N`。版本比较不降级。
3. **遵守现有清单格式。** Windows 示例采用 `schemaVersion: 1`、`target: windows-amd64`、`flavor: offline`、`shell: electron`。外部文件名仍用 `windows-x64`。当前每个 flavor 只能放一条对应路线的产物，不能把两种壳或两个发行版放在同一 flavor 下。
4. **初始下载地址与清单同源且在渠道目录内。** 例如 `/eduwork/stable/latest-windows-amd64.json` 对应 `/eduwork/stable/0.3.5/...zip`。这是当前路径校验规则；更换成 GitHub、跨域 CDN 或其他目录布局需要来源适配，不能直接放宽全部地址校验。
5. **字节数、哈希和包内契约齐全。** 清单填写最终 ZIP 的真实 bytes/SHA-256，并提供内容为 `<sha256>  <完整文件名>` 的 `.sha256`。安装阶段还要求包内 `RELEASE-MANIFEST.json`、逐文件清单及 Electron 启动/发行身份。普通文件夹 ZIP、GitHub 自动生成的 Source code ZIP 和新版更新包不是同一概念。
6. **下载完整且可重试。** 支持 HTTP Range 可继续部分下载；当前实现也处理服务端忽略 Range 返回完整文件的情况。代理/CDN 不得篡改文件字节。清单缓存应及时刷新；版本目录与已发布文件不可同名换内容。
7. **先上传包，再发布指针。** 先核对最终 ZIP、旁路校验文件与包内身份，完成真实升级测试，最后更新 latest 清单。移除错误指针用于停止继续分发，不等于自动回滚已安装客户端。

最小目录示意（版本为示例，不表示已发布）：

```text
eduwork/
  stable/
    latest-windows-amd64.json
    0.3.5/
      EduWork-0.3.5-windows-x64-electron.zip
      EduWork-0.3.5-windows-x64-electron.zip.sha256
  development/
    latest-windows-amd64.json
    0.3.6-dev.20260913.1/
      ...
```

将 [updates.jsonc](../config/desktop/examples/updates.jsonc) 的 `updates` 段合并到安装目录的 `config/eduwork.jsonc`，从托盘退出再启动。`manifestURL` 控制 Windows 更新器；`releasesURL` 只是可选的发布网页地址，不替代清单和下载协议。用户配置覆盖随包默认值；从 Go 迁入的 Electron 在没有该项时会保留已有 `config/update.bridge.json` 渠道。

更新保留 `data/` 和用户 `config/`，包括企业连接、用户 Logo 与更新源选择。配置赛尔或华师登录的公版仍是 `eduwork` 发行；修改显示名称或登录企业不会变成 `eduwork-chatecnu`，也不切换到 ECNU 更新包。

## 开发包与公测包的默认渠道

两种 Windows 装配脚本都接受 `-UpdateDefaultPolicy development|stable`。省略时，`X.Y.Z-dev.YYYYMMDD.N` 默认开发渠道，`X.Y.Z` 默认仅公测版。清单 URL 中的 `/stable/` 只定位更新源，不能反过来把开发包的默认偏好改成公测。

Go 的随包默认值记录在 `eduwork.desktop.json` 的 `updateDefaultPolicy`，并同时写入新装的 `config/update.bridge.json`。升级保留旧 `config/` 时，新程序仍使用本次装配的默认值，避免旧配置中的错误默认值继续生效。Electron 将默认值写在 `resources/app/eduwork.desktop.json` 的 `updates.defaultPolicy`；发行方也可在 `config/eduwork.jsonc` 配置该项。

第一次初始化更新器时，将所选渠道及 `source: packaged-default` 记录到 `data/state/update-preferences.json`；用户主动切换时记录 `source: user`。此文件跨重启、Go 更新和 Go → Electron 迁移保留。旧版无 `source` 的有效渠道记录同样保留；不能推测它不是用户选择而覆盖。

优先级为：**已有渠道记录 → 本次装配默认值**。因此开发渠道升级到较新的公测 Electron 后仍保留开发偏好；全新公测安装默认仅公测。静态源的开发渠道同时查询 development 与 stable，取更高版本；公测渠道只查询 stable。GitHub 按相同渠道语义筛选已发布的 Release 与 prerelease，所有来源均不降级。

## GitHub 与静态源的区别

| 项目 | 静态 HTTPS / OSS | GitHub Releases 接入要求 |
| --- | --- | --- |
| 发现新版 | 固定渠道 JSON | 读取 Release 元数据及对应更新资产，转换为同一内部描述 |
| 下载地址 | 现有同源渠道目录 | Release 的仓库/tag/asset 路径，以及下载时的重定向 |
| 权限 | 面向客户端只读 | 客户端仅匿名读取公开资源，私有仓库与草稿不提供自动更新 |
| 开发频道 | `development` 目录 | 经负责人确认后发布 prerelease；普通测试构建只保留 CI artifact |
| 下载安装 | 共用 Windows 更新器 | 继续共用，不能另写一套数据迁移和安装逻辑 |

GitHub 官方 API 提供 Release、资产下载地址、大小及摘要信息；公共资源允许匿名读取，私有资源需要相应读取权限。`latest` 接口不包含 draft/prerelease，仍需按 EduWork 的版本和发行身份过滤，不能把接口返回的任意资产视为可更新客户端。[GitHub Release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)

资产下载可能直接返回文件，也可能返回 `302` 跳转。适配器验证对应仓库/tag/资产，仅接受 GitHub 下载服务器上的 HTTPS 跳转；下载请求不携带学校 OIDC 令牌、GitHub 读取令牌或 Cookie。[GitHub 资产 API](https://docs.github.com/en/rest/releases/assets#get-a-release-asset)

GitHub 匿名请求额度按来源 IP 计算。客户端已缓存并限制检查频率；共享出口仍可能触发限流，机构可配置自己的静态源。公版不内置个人 GitHub Token。[GitHub API 限额](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

每个 Release 文件必须小于 2 GiB。发行前检查完整 Electron ZIP 的实际大小；当前安装协议期望一个完整 ZIP，超限不能直接拆卷而不调整客户端。[GitHub Release 容量要求](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)

## CI 产物与发行验收

开发包与公测包均写入 `RELEASE-MANIFEST.json`、逐文件清单和 `wails-host-v1` 启动契约；同一 ZIP 可用于全新安装、Electron 更新及合格 Go 过渡版迁移，不能投放到旧 0.2 更新入口。

公测 Release 包含五类资产：桌面 ZIP、`.sha256`、`release-receipt.json`、已批准的 `RELEASE-NOTES.md` 和 `update-windows-amd64.json`。最后一项由同次 CI 的真实包尺寸、摘要与发行身份生成。发布器复核它与回执一致，校验每个上传文件的尺寸与摘要后，才将草稿正式发布。普通开发构建仅保留为 CI artifact。需要推送开发渠道时，经负责人确认版本号与说明后再发布 prerelease，并提供同样的更新资产；artifact 本身不会被客户端发现。

机构在本机给 CI 原包加入配置后，必须更新 ZIP 尺寸、摘要和包内清单；程序文件保持 CI 原样，不能沿用原 ZIP 哈希。GitHub 原包与机构 OSS 装配包分别校验和发布。操作见[本机配置装配](BUILD.md#从-ci-原包装配机构配置)。

发行前用两个实际 CI 桌面版本验收下载、续传、安装、重启及配置/历史保留，再验证错误发行、错误架构、损坏包和不可读 Release 的提示。源码层的网络模拟与事务测试不能代替实际桌面验收；私有仓库阶段保持草稿，不通过公开仓库或内置读取令牌绕过这一限制。macOS 仍需真机、签名与更新适配验收。

发行说明由项目负责人确认。发布 CI 产物、装配机构配置和切换在线更新渠道分别执行，不能由一次源码提交隐式触发。

## 启动自检与失败恢复

旧版 → Go 过渡版、Go → Electron、Electron → Electron 是三个独立的验收入口。每一跳都要使用在线渠道实际提供的包；修正 Electron 的启动不能替代重新验收 Go 过渡包。冷启动测试须覆盖插件导入繁忙时的 stdin bootstrap 读取，避免已经收到的启动信息被定时器误判为缺失。

更新器先校验包和逐文件摘要，再备份、替换程序，最后等待新版 Host 与界面完成启动自检。原有 `data/`、`config/` 和环境配置不作为程序文件替换。备份失败时只恢复已移动的文件；新版启动失败时停止本次启动的进程树，再移除本次写入的程序并恢复备份。

若文件仍被占用导致恢复无法完成，更新器会报告失败及保留备份的位置，不宣称恢复成功。重试不会删除含原程序的备份，其他版本成功更新也不会清理这类恢复目录。遇到此提示，请保留整个客户端目录并提供诊断包；不要删除 `data/state/updates/transactions/` 中尚未恢复的备份。

维护者的本地故障注入应覆盖：下载中断与续传、错误哈希、文件占用、备份中途失败、新版启动失败、恢复文件受阻和重试。实际发行前还需验证配置、会话、附件与渠道偏好在每条升级路径上均保留；仅通过单元测试不能确认发行包可用。
