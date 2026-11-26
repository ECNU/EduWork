# 更新源部署与 GitHub 接入

[发行与版本规则](RELEASE.md) · [发行边界](EDITIONS.md) · [配置示例](../config/desktop/examples/updates.jsonc)

Windows 公版默认从 `ecnu/EduWork` 的 GitHub Releases 获取更新。安装版使用 `electron-updater`，便携版继续使用 Go 更新器。机构可为便携版配置静态更新源。学校版安装包没有软件更新源。企业登录与发行身份、更新渠道相互独立。

本文的来源适配与安装契约以 Windows 更新器为主。macOS 使用 Sparkle 和独立 appcast，公版同样从 GitHub 下载发行包，见 [macOS 应用更新](MACOS_UPDATES.md)。

Electron 还支持发行方授权的[配置与 Skills 独立更新](CONTENT_UPDATES.md)，复用同一检查入口和左下角提示。内容修订号与软件版本分别管理，签名校验后于下次启动生效；程序、插件和运行时仍使用本文的整包更新机制。

## 是否必须使用 OSS

不必须。OSS、其他对象存储、CDN 或普通 HTTPS 静态文件服务器，都可以提供更新清单与安装包。客户端不调用阿里云管理 API，也不需要云账号；发行方在上传端管理写入权限即可。

GitHub Releases 可以同时提供公版安装器和便携包的更新。便携版的 GitHub 与静态源共用检查更新、左下角提示、下载进度、校验与重启安装流程。

## 当前支持到哪里

| 场景 | 当前状态 |
| --- | --- |
| Windows 公版安装版 | 使用随包 GitHub 源，通过 `electron-updater` 检查、下载并安装更新。支持确认后立即安装或在正常退出时自动安装 |
| Windows 学校版安装版 | 未配置软件更新源，设置页显示不支持软件更新 |
| Windows 便携版 + 静态 HTTPS 更新源 | 支持后台检查、下载及续传、进度、SHA-256 校验、立即或下次启动安装 |
| Windows 公版便携版用户配置留空 | 使用随包 GitHub 默认源，从旧 Go 迁入时优先保留原机构更新源 |
| ECNU 旧 Go → Go 过渡版 → Electron | 使用独立兼容清单与已验收的迁移包，不能混入公版入口 |
| 私有仓库、草稿、没有已发布版本 | 客户端只从公开的已发布版本获取更新 |
| 增量更新 | 安装版使用 `.blockmap` 差分。便携版公测包为前 3 个公测版提供增量包。无法使用差分或增量包时下载完整包，见[增量更新](#增量更新) |
| macOS 程序更新 | 已接入 Sparkle：按 appcast 检查、下载并验签，用户确认后安装与重启；旧包首次迁移和系统授权边界见 [Mac 更新](MACOS_UPDATES.md) |

## Windows 安装版更新

公版装配时从发行配置读取 GitHub 仓库，将更新源写入 `resources/app-update.yml`。学校版安装包省略此文件。验收可使用 HTTPS 静态源，见[构建指南](BUILD.md)。

稳定渠道使用 GitHub Latest Release 中的 `latest.yml`。开发渠道使用 `dev.yml`，GitHubProvider 按 `releases.atom` 的顺序选取第一个匹配的 `dev` 标签，既不按版本号重新排序，也不翻页。这个限制只影响开发渠道。两个渠道均禁止降级。

用户确认立即安装后，桌面应用先停止 Host 和后台服务，随后交由安装器更新程序。启用自动安装后，正常退出时若已有校验完成的包且 Host 能安全停止，应用会交给安装器处理，安装后保持退出。安装版不提供「下次启动时安装」，新版启动失败时也不会自动回滚。

## GitHub 配置与默认值

设置页的「启用软件更新」决定是否检查、下载软件更新，正式版和开发版均默认开启。关闭后会记住选择，重启和升级不会重新开启；配置与 Skills 的签名内容更新仍独立运行。更新渠道可另外选择，重新开启软件更新时沿用原来的来源和渠道。正在检查、下载或已有待安装包时，先完成当前更新再修改开关。

启动时检查和定时检查默认开启，可以单独关闭。两项都关闭时仍可手动检查。Windows 的自动下载与自动安装默认关闭。便携版启用自动安装后，会将已校验的包预约到下次启动时安装。macOS 启用自动下载后，可再选择是否在退出时自动安装，原有 Sparkle 自动下载并退出安装的偏好继续生效。

以下来源配置、版本筛选和 JSON 清单适用于 Windows 便携版的 Go 更新器。公版便携包自带默认源，也可在 `config/eduwork.jsonc` 中显式选择 GitHub。

```json
"updates": {
  "provider": "github",
  "repository": "ecnu/EduWork",
  "defaultPolicy": "stable"
}
```

`repository` 只接受 `owner/repo`，不接受 URL 或 Token。`updates` 中省略来源时使用随包默认值；旧安装的有效 `config/update.bridge.json` 优先于新的随包默认源。显式 `manifestURL` 切换到静态源；显式 `provider: github` 切回 GitHub。两种来源不要混填。来源配置修改后从托盘退出并重新启动。旧配置的 `provider: disabled` 在首次使用新开关时视为关闭；之后以界面保存的选择为准，重新开启时复用保留的来源或随包可信来源。开关保存在独立的软件更新偏好文件中，不改写用户的更新源配置。

GitHub 公测渠道通过 `/repos/{owner}/{repo}/releases/latest` 读取非 prerelease 的 `vX.Y.Z`。开发渠道同时读取 Release 列表，接收标为 prerelease 的 `vX.Y.Z-dev.YYYYMMDD.N`，与公测候选按 SemVer 比较取较新者。列表分页读取，超过 200 个记录时提示发行方归档，不悄悄选取不完整结果。草稿、其他格式标签、错误发行/平台/壳、错误大小或摘要都不能作为更新；所有来源均不降级。

元数据缓存 15 分钟，过期后使用 ETag 条件请求；不可读与限流结果同样退避 15 分钟。手动连续点击不会反复请求 GitHub。错误会明确显示，不当作“已是最新版本”。客户端匿名请求，不读取学校登录令牌或 GitHub 凭据；只允许配置仓库的对应 tag 资产及 GitHub 下载服务器上的 HTTPS 跳转。

GitHub 的 `update-windows-amd64.json` 必须由 `scripts/github-update-manifest.mjs` 生成，保持输出字节原样，不添加缩进或末尾换行。该紧凑格式兼容旧客户端的 JSON 缓存；新版缓存保留完整响应字节，并在读取旧缓存时重新获取。发现更新和安装前的完整性检查都以 GitHub 资产 SHA-256 为准，不能只比较解析后的 JSON 内容。重复检查和重启后的检查也应纳入更新验收。

## 增量更新

Windows 安装版由 `electron-updater` 利用 `.blockmap` 和缓存的旧安装器做差分下载，差分不可用时下载完整安装器。

以下 ZIP 增量包用于 Windows 便携版。

公测版发布时，CI 为前 3 个公测版各生成一个增量包 `EduWork-<版本>-windows-x64-electron-from-<旧版本>.zip` 及其 `.sha256`，在 `update-windows-amd64.json` 的同一个 artifact 下以 `deltas` 列出。增量包与完整包结构相同，只含新的 `RELEASE-MANIFEST.json`、内容变化的文件、`config/` 等用户管理的目录，以及 Host 启动时改写的 venv 配置；条目从完整包原样复制。增量包超过完整包一半时不生成；开发版不生成。

更新器按当前版本和本机 `RELEASE-MANIFEST.json` 的 SHA-256 选择增量包。下载完成后、应用仍在运行时，先核对要从安装目录复用的文件；没有对应条目、下载失败或本机程序文件被改过时，改下完整包。安装时只把“解压完整包”换成“解压增量包并复用安装目录中未变化的文件”，之后的逐文件校验、替换、启动自检和回滚与完整包相同。Electron 权限治理范围及 `resources/product/` 下的文件采用本地复制，其他文件在支持时使用硬链接；这不增加网络下载量。产品目录不与旧备份共享文件，避免新版启动后清理备份改变文件 ctime，误触发插件热重载。某个版本的增量安装失败过一次后，该版本改用完整包。

旧更新器仍可能使用硬链接。因此装配时还对锁定的 DSH client-modules 加入内容校验：仅 ctime 改变、mtime 与代码字节均未改变时，更新监视基线而不重载插件；真实代码变化或正常构建更新时间仍沿用上游机制。该适配以完整输入 SHA-256 校验，并记录在 `assembly.json.runtimePatches`；升级 DSH 时须重新评估或移除。

增量包由已安装版本的更新器安装，因此从支持增量的版本之后的下一个版本起生效；旧客户端忽略 `deltas`，照常下载完整包。静态更新源可在 artifact 中写同样的 `deltas`（每项含 `fromVersion`、`fromManifestSha256`、`fileName`、`bytes`、`sha256`、`url`、`sha256Url`），文件与完整包放在同一版本目录。

## 静态 HTTPS 更新源的现有要求

以下清单和部署要求适用于便携版的 Go 更新器。

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

公版更新保留 `data/` 和用户 `config/`，包括企业连接、用户 Logo 与更新源选择。配置赛尔或华师登录的公版仍是 `eduwork` 发行；修改显示名称或登录企业不会变成 `eduwork-chatecnu`，也不切换到 ECNU 更新包。

## 配置随升级如何处理

公版与机构版 Electron 都读取 `config/eduwork.jsonc`。软件升级保留该文件，不再按产品版本生成配置副本。公版默认不启用远程配置；机构版可通过[首次启动获取配置](PUBLISHER_BOOTSTRAP.md)初始化，然后用签名内容更新默认字段，保留用户手工修改。

唯一回退备份是 `data/configuration/eduwork.previous.jsonc`。旧版升级将原来实际生效的学校配置迁入统一入口，确认成功启动后清理未再修改的旧入口。配置编辑、UAT 切换和回退见[配置文件](CONFIGURATION.md)。历史、个人模型、Key、默认模型和用户已保存的界面及更新渠道偏好仍独立保留。

静态机构部署可用 `scripts/configure-desktop-archive.ps1` 为 CI 原包加入 `config/eduwork.jsonc`；无需变更程序文件。脚本兼容旧版含版本化文件的 CI 包，但新包不再生成这些文件。

## 开发包与公测包的默认渠道

装配 Windows Electron 便携包时，PowerShell 入口 `dsh-electron/scripts/assemble-windows.ps1` 使用 `-UpdateDefaultPolicy development|stable`，Node 入口 `dsh-electron/scripts/assemble-windows.mjs` 使用 `--update-default-policy development|stable`。省略时，`X.Y.Z-dev.YYYYMMDD.N` 默认开发渠道，`X.Y.Z` 默认仅公测版。清单 URL 中的 `/stable/` 只定位更新源，不能反过来把开发包的默认偏好改成公测。

旧 Go 过渡包曾将随包默认值写入 `eduwork.desktop.json` 和 `config/update.bridge.json`。Electron 将默认值写在 `resources/app/eduwork.desktop.json` 的 `updates.defaultPolicy`；发行方也可在 `config/eduwork.jsonc` 配置该项。

第一次初始化更新器时，将所选渠道及 `source: packaged-default` 记录到 `data/state/update-preferences.json`；用户主动切换时记录 `source: user`。此文件跨重启、Go 更新和 Go → Electron 迁移保留。旧版无 `source` 的有效渠道记录同样保留；不能推测它不是用户选择而覆盖。

优先级为：**已有渠道记录 → 本次装配默认值**。因此开发渠道升级到较新的公测 Electron 后仍保留开发偏好；全新公测安装默认仅公测。静态源的开发渠道同时查询 development 与 stable，取更高版本；公测渠道只查询 stable。GitHub 按相同渠道语义筛选已发布的 Release 与 prerelease，所有来源均不降级。

## GitHub 与静态源的区别

以下对照适用于 Windows 便携包。

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

公版每个 Windows Release 同时附带同版本的便携包与安装器。安装版更新依赖安装器、对应渠道的 `latest.yml` 或 `dev.yml` 和 `.blockmap`；发布流程会校验它们与构建回执绑定的文件名、大小及摘要。Windows 安装器只由 Node 候选生成，学校版和 macOS 发布范围不变。

Release 附件包括桌面 ZIP 及 `.sha256`、`release-receipt.json`、已批准的 `RELEASE-NOTES.md`、`update-windows-amd64.json`、[便携自解压包 ZIP](PORTABLE-EXTRACTOR.md) 及其 `.sha256` 和 `.json` 回执，以及各[增量包](#增量更新)及其 `.sha256`。公版 Windows 另附同版本安装器、`latest.yml`（开发版使用 `dev.yml`）和 `.blockmap`。便携更新清单按同次 CI 的原始桌面 ZIP 尺寸、摘要和发行身份生成，并引用该 ZIP。发布器校验每个附件的名单、尺寸和摘要；普通开发构建只保留 CI artifact。

机构版可按[首次启动获取机构配置](PUBLISHER_BOOTSTRAP.md)分发 CI 原包，无需本机重装配。若仍采用旧版静态配置装配，修改后的 ZIP 必须重新生成尺寸、摘要和包内清单，并与 GitHub 原包分别校验和发布。

发行前用两个实际 CI 桌面版本验收下载、续传、安装、重启及配置/历史保留，再验证错误发行、错误架构、损坏包和不可读 Release 的提示。源码层的网络模拟与事务测试不能代替实际桌面验收；私有仓库阶段保持草稿，不通过公开仓库或内置读取令牌绕过这一限制。macOS 的原生更新、签名与系统授权验收按 [Mac 更新指南](MACOS_UPDATES.md)执行；不能仅凭程序启动成功认定升级通过。

Windows 安装版需用两个实际安装器验收更新，记录差分下载或完整包回退，并确认更新后安装目录、卸载入口和个人数据正常。Windows 便携版增量验收必须保留更新器自动打开的第一个进程，等更新器完成备份清理后，确认会话列表、输入框和设置可操作，并检查前端错误；随后再验收正常退出与第二次启动。健康标记通过不代表清理后界面仍可用，不能先关闭第一次进程、只验证第二次。首次修复升级也必须使用已发布旧包里的原更新器，覆盖旧硬链接清理行为。

发行说明由项目负责人确认。发布 CI 产物、装配机构配置和切换在线更新渠道分别执行，不能由一次源码提交隐式触发。

## 启动自检与失败恢复

以下启动自检与回滚机制适用于 Go 更新器。

旧版 → Go 过渡版、Go → Electron、Electron → Electron 是三个独立的验收入口。每一跳都要使用在线渠道实际提供的包；修正 Electron 的启动不能替代重新验收 Go 过渡包。冷启动测试须覆盖插件导入繁忙时的 stdin bootstrap 读取，避免已经收到的启动信息被定时器误判为缺失。

更新器先校验包和逐文件摘要，再备份、替换程序，最后等待新版 Host 与界面完成启动自检。原有 `data/`、`config/` 和环境配置不作为程序文件替换。备份失败时只恢复已移动的文件；新版启动失败时停止本次启动的进程树，再移除本次写入的程序并恢复备份。

若文件仍被占用导致恢复无法完成，更新器会报告失败及保留备份的位置，不宣称恢复成功。重试不会删除含原程序的备份，其他版本成功更新也不会清理这类恢复目录。遇到此提示，请保留整个客户端目录并提供诊断包；不要删除 `data/state/updates/transactions/` 中尚未恢复的备份。

维护者的本地故障注入应覆盖：下载中断与续传、错误哈希、文件占用、备份中途失败、新版启动失败、恢复文件受阻和重试。实际发行前还需验证配置、会话、附件与渠道偏好在每条升级路径上均保留；仅通过单元测试不能确认发行包可用。
