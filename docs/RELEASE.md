# 版本、发行和升级

本规范适用于 `ecnu/EduWork` 及 `ecnu/EduWork-ECNU`。产品版本由 EduWork 决定；DSH、插件、桌面壳的版本另记在装配回执中。

更新源的部署要求、OSS 与 GitHub 的差别见[更新源指南](UPDATES.md)。Windows 公版默认 GitHub，机构可配置静态源；两者共用下载与安装器。CI 公测包与开发包均包含更新契约，正式发布前仍须验收实际桌面升级。

## 发行分工

GitHub 常规桌面 Release 面向长期维护的 Electron 公版和 ECNU 版，按已验收的 Windows/macOS 系统与架构构建。日常临时客户端、Go/Wails 过渡包及旧版升级演练由维护者在本地制作和验收，不加入 GitHub 桌面打包矩阵，不创建临时 Release。Go 壳源码和必要回归仍保留。

旧 ECNU 用户所需过渡包由维护者验收后通过原兼容分发渠道提供；后续衔接 Electron。GitHub 与旧更新渠道的实现分开维护，不能为了简化 GitHub 流程取消老用户升级要求。已有源码/Web CI 继续运行；Mac 适配所需 CI 构建和验证产物仍可使用，但不因此扩展为临时双壳发行体系。日常 PR/main CI 仍不发布。

## 版本号

GitHub Release 标题统一为“项目名 版本号”，例如 `EduWork 0.3.6-dev.20260914.3` 或 `EduWork-ECNU 0.3.6`，不追加“（开发版）”“（公测版）”等文字。发布渠道由版本号及 GitHub 的 prerelease 标记区分。

| 用途 | 例子 | 首页标记 | GitHub Release / 更新清单 |
| --- | --- | --- | --- |
| 开发与测试 | `0.3.5-dev.20260912.1` | 开发版 | 普通测试用本地包或 CI artifact；获批后可发布 GitHub prerelease |
| 稳定渠道发行 | `0.4.0`，DSH 为 `0.2.0-rc.2` | 公测版 | 经审阅后发布非 prerelease，并进入 stable 渠道 |
| 后续开发 | `0.3.6-dev.20260913.1` | 开发版 | 普通测试用本地包或 CI artifact；获批后可发布 GitHub prerelease |
| 上游稳定后的发行 | `X.Y.Z`，DSH 无预发布后缀 | 正式版 | 经审阅后发布非 prerelease，并进入 stable 渠道 |

日期采用北京时间，同一天的构建序号递增。每次构建必须指定版本，不以打包机时间隐式决定。开发版使用 `X.Y.Z-dev.YYYYMMDD.N`，公测发行使用 `X.Y.Z`、标签 `vX.Y.Z`，需要通过 GitHub 推送开发版时，标签为 `vX.Y.Z-dev.YYYYMMDD.N` 并设置 prerelease；必须先确认版本号和发布说明。普通 CI 构建不创建 Release。已发布版本不可复用。0.x 阶段能力或兼容性变化通常提高次版本，兼容修复提高补丁版本。

Windows 设置恢复“公测版”和“开发版（含公测版）”两个更新渠道。公测只查 stable，拒绝开发包；开发同时查 development/stable，按 SemVer 选择较新版本。`0.3.4 < 0.3.5-dev.20260912.1 < 0.3.5`，因此同基线开发版可升级到公测版。切换渠道不会降级，也不改变当前版本徽标；下载、待安装、安装期间不允许切换。用户选择随升级保留。装配必须核对产品版本、首页中英文徽标一致，不能仅改回执版本号而复用旧徽标资源。

公版与机构版可以独立安排发行；机构版通过核心锁固定已经验收的公版来源，不要求同时发布。基于同一公版发布时，使用对应的产品版本。发行配置、平台和壳放进文件名，例如 `EduWork-0.3.0-windows-x64-electron.zip` 与 `EduWork-ECNU-0.3.0-windows-x64-electron.zip`。它们不能互相覆盖数据和配置。壳名不放进 SemVer 后缀。

仅发布 macOS 修复、没有对应 Windows 包时，GitHub 标签使用 `macos-v<产品版本>`，例如 `macos-v0.3.6-dev.20260921.2`；应用版本、Release 标题和包名仍使用原产品版本。此类开发版继续标记为 prerelease，且不设置为 latest。现有 Windows 客户端只识别 `v<版本>` 标签，独立的 Mac 标签可避免它误选缺少 Windows 更新清单的 Release；Mac 通过签名 Sparkle appcast 获取新包。仅更新 Mac 渠道，Windows 与配置更新渠道保持原样。

显示策略来自 `dsh-host/release-policy.mjs`，由客户端构建脚本写入界面，不能仅编辑用户 JSONC 来把开发构建伪装成公测版。首次启动不显示上游内测说明；缺少模型 Key 时必要的配置引导仍保留。

## 发行文件名与更新目标

正式桌面产物统一采用 `<发行名>-<产品版本>-<系统>-<架构>-<壳>.<格式>`。发行名使用 `EduWork` 或 `EduWork-ECNU`，不在文件名中使用显示品牌的 `@`；壳使用现有协议值 `wails` / `electron`，不另引入 `go` 别名。以下为命名示例，不表示对应平台已经发行或通过验收：

| 产物 | 文件名示例 |
| --- | --- |
| 公版 Windows Electron | `EduWork-0.3.0-windows-x64-electron.zip` |
| 本地 ECNU Go/Wails 过渡包（非 GitHub 常规产物） | `EduWork-ECNU-0.3.0-windows-x64-wails-bridge.zip` |
| ECNU Windows Electron | `EduWork-ECNU-0.3.0-windows-x64-electron.zip` |
| 公版 Apple Silicon | `EduWork-0.3.0-macos-arm64-electron.dmg`，同名 `.zip` |
| 公版 Intel Mac | `EduWork-0.3.0-macos-x64-electron.dmg`，同名 `.zip` |

ECNU 的 Mac 产物同样使用 `EduWork-ECNU` 前缀。若确实保留不同内容的在线/离线包，在壳之后增加 `-online` / `-offline`；包类型在旧更新协议中的 `flavor` 仍须保留。新装与跨壳迁移如果产生不同字节的 ZIP，迁移包增加 `-from-wails`，不能同名覆盖；若同一份包满足两条已验收路径，可复用同一 URL 和哈希，无需复制成品。校验文件使用完整文件名加 `.sha256`。

文件名帮助人辨认，更新器依靠清单和包内身份选择、校验产物。Windows 更新流程校验版本、大小、哈希与 Electron 发行身份，CI 统一生成新装与更新可用的 ZIP。GitHub 清单同时约束仓库、版本、发行、平台、架构、壳与包类型。旧 Go 仍使用兼容清单，不改变旧字段含义；发布前必须完成实际桌面升级验收。

- 公版和 ECNU 使用独立更新入口；登录某个企业或修改显示品牌不改变安装包的发行身份。
- 旧 Go 的原始 `stable` / `development` 入口只提供 Go 过渡包。旧实现按 `flavor` 选取产物，不能把同类型的 Wails 与 Electron 同时塞进该清单并期待它根据文件名选对。
- Go 过渡版使用独立迁移入口，只接受更高版本、显式声明 `wails-host-v1` 的 Electron 迁移包，从过渡版正在使用的数据目录导入。`legacy-wails-v1` 只保留旧实现兼容，不适用于已在过渡版继续工作的人。
- Electron 的后续同壳更新按发行、系统和架构隔离；Mac 与 Windows、arm64 与 x64 不交叉下发。过渡期两壳版本可能不再同步，因此后续自动安装清单应按更新路线分别维护版本，而非共享一个不可区分的 latest 指针。
- 外部文件名统一使用 `windows-x64` / `macos-arm64` / `macos-x64`。旧 Go 协议的 `windows-amd64` 与当前 Host 协议的 `windows-x64`、`darwin-arm64` 等值通过明确映射衔接，不能为了文件名统一而重写旧客户端所需的 target。

Electron CI 必须从同一份装配身份生成文件名、更新元数据、包内回执及校验文件。直接镜像 CI 原包时保持字节与摘要一致；在本机加入机构配置后，OSS 包必须重新生成清单与摘要，程序文件保持 CI 原样。本地 Go 过渡包沿用自己的兼容渠道。所有产物与哈希就绪并完成验收后，才更新各自渠道指针。私有测试 artifact 不进入公开更新渠道。

## 旧版兼容

按 [SemVer 优先级](https://semver.org/#spec-item-11)，`0.3.0` 高于旧 `0.2.0-dev.*`、`0.2.0`、`0.3.0-rc.*` 和 `0.3.0-dev.*`。原来的版本号不重写。旧 Go 更新器及新壳的比较器都有这些回归用例；这仅证明版本比较，不等于证明整包自动迁移成功。

公测更新清单拒绝带预发布后缀的构建。可在 `config/eduwork.jsonc` 配置更新地址，参考 `config/desktop/examples/updates.jsonc`。Windows Go 桥接和 Electron 现在共用经过校验的后台下载、进度及重启安装；安装前由用户选择时机。macOS 的更新与签名方案需单独真机验收，不将 Windows 验收结论外推。

旧 Go 自动更新使用旧清单格式，不能直接换成新壳的下载页清单。过渡发行先让旧用户升级到支持跨壳迁移的 Go 版，再由它验证 ZIP 和迁移握手，启动 Electron 导入历史。不得把 Electron ZIP 当作旧 Go ZIP 下发。普通启动不自动扫描别的安装目录；配置、会话与凭据的迁移应单独验收。完整迁移验收通过前保留双壳发行能力。

`cmd/eduwork-wails-candidate` 已接入可选的过渡升级器。使用 `dsh-desktop/scripts/assemble-wails-bridge.ps1` 和 `pack-wails-bridge.ps1` 才会生成包含 `ChatECNU-Work.exe` 兼容入口、旧 `run` 参数、`apply-update`、健康确认及下载安装控制的过渡包。普通 Wails 候选仍不启用它。迁移渠道显式配置在 `config/update.bridge.json`，使用旧清单 schemaVersion 1、`allowShellMigration: true`、`target: windows-amd64` 和 `flavor: offline`。

已发布 ECNU `0.2.0-dev.20260909.3` 应作为首跳验收基线；另选更早的代表版本验证旧渠道兼容。既有 `0.2.x → 0.2.x` 旧辅助程序验收、版本比较或模拟跨壳事务不能替代 `旧发布包 → 本次 Go 过渡包` 的真实下载、安装、启动、历史可见和失败恢复验收。第一跳必须在本次正式发行前完成，不能推迟到下一次 Electron 迁移发行。

跨壳升级要求目标版本高于当前版本。例如旧 `0.2.0-dev.*` Go → `0.3.5-dev.*` Go 过渡版 → `0.3.5` Electron。不要依靠相同版本号触发换壳；每条路线都须使用实际发行包验证。

旧 `stable` / `development` 地址在过渡期间保留，各自提供身份匹配的旧格式清单，指向 Go 过渡发行。旧更新器校验渠道内的下载路径，因此可在两个旧路径镜像同一份已校验 Go ZIP；这不等于恢复开发版 Release。跨壳 Electron 包只进入过渡版启用的独立迁移渠道。最早版本是否能够同时查询两条渠道，必须用真实旧包验证，不能仅凭当前源码推断。

迁移保留原始历史数据，复制并校验会话、附件、设置、记忆和用户技能；不直接激活旧插件安装缓存或复制系统加密凭据。旧 `data/dsh` 先导入 `data/<distribution>-wails/dsh`，第二跳必须从后者导入 `data/<distribution>-electron/dsh`，以保留过渡版新增内容。已有目标数据不自动覆盖或合并。两次转换需要重新登录；外置旧数据目录需走显式导入。

## 本地、CI 与公开发行

### CI 产物直接发布

GitHub 托管的构建产物由 GitHub 托管的发布任务读取、校验和上传，不默认经维护者电脑下载后再转传。下载安装包用于真机验收，不是上传 Release 的必要步骤。构建完成和发布完成是两个状态，交付前须检查 Release 已公开、标签来源正确、附件齐全且哈希一致。

公版和机构版的桌面候选工作流都提供 `publish` 选项。选择 `main` 和两个平台，填写已确认的版本（如 `0.4.0-alpha.1`）及 `docs/releases/<版本>.md`，确认 `notes_approved` 后，构建成功会调用独立发布任务。构建任务只有读取权限；发布任务才有读取 artifact 和写入 Release 的权限。默认仍只构建，不因日常 PR 或推送自动发行。

已经构建成功的版本，或上传中断的版本，运行 `Publish desktop candidate`（机构版为 `Publish ECNU desktop candidate`），填写原候选构建的 `source_run_id` 和同一版本、说明文件。先以 `publish=false` 在云端验证，再以 `publish=true` 发布；无需重新构建或本机转运。机构版从锁定的公版核心复用发布脚本。

发布器检查来源工作流、已合并提交、两个平台回执、Actions artifact 摘要及全部文件哈希，上传时保持完整文件名。先形成草稿，按构建方式核对完整附件后才公开；预发布不设为 Latest，stable 另核对 Windows 更新清单并公开为正式 Release。重复执行只接受同一提交和相同字节，不替换不匹配的附件，不删除已发布版本；如需删除重发，须由维护者另行明确授权。产物超过 Actions 保留期限后需要重新构建。此流程不修改 OSS 或更新入口。

1. 本地修改、测试、生成干净源代码快照。两个仓库各自是一条干净历史；机构仓锁定公版快照的实际提交。
2. 审阅版本、文档、示例、隐私扫描、许可证和插件组合。独立插件的开发包与公开稳定包分别冻结，禁止覆盖同版本 tarball。
3. 经授权后先推公版，再推锁定该公版提交的 ECNU 仓。仓库私有期间，机构 CI 可配置 `EDUWORK_CORE_SSH_KEY` 专用只读部署密钥，或 `EDUWORK_CORE_READ_TOKEN` 细粒度只读令牌，权限仅限读取公版；公开后移除并撤销专用凭据，使用通常的 token。配置方法见机构仓构建指南。
4. 当前 `validate-local-web.yml` 从锁定 npm Runtime/插件及产品源码构建，执行源码/依赖检查和构建，上传轻量脱敏报告。它不会创建 Release。开发产物不进入用户更新渠道；私有 Fork PR 的跨私有仓构建限制见 [协作说明](../CONTRIBUTING.md)。
5. 真实桌面、原生 Office/音视频、OIDC、托盘、链接、移动目录验收后，冻结最终 Electron 产物及 SHA-256，再启用正式 Release/更新渠道。ECNU 旧版升级另附本地过渡验收记录，不要求 GitHub 构建临时 Go 包。见 [发行检查项](../RELEASE-CHECKLIST.md)。CI 产物留存不等于一次公开发行。

公版发行入口为 GitHub Releases。原样镜像 CI ZIP 时可复用其大小和校验值；机构在本机加入私有配置后，必须重新计算包内清单、ZIP 摘要与大小，并据此生成学校 OSS 更新清单。程序文件保持 CI 原样，不为学校渠道重新编译。桌面候选工作流接收正式版本 `X.Y.Z`，以及 `X.Y.Z-alpha.N`、`beta.N`、`rc.N` 或 `X.Y.Z-dev.YYYYMMDD.N`；预发布版本发布为 prerelease，不占用公测 latest，并检查两仓版本、核心提交、插件锁、原生资源回执和 ZIP 哈希；发布权限只交给发行 job。

双平台桌面候选使用同一个手动工作流构建；公开发布仍须在两个平台各自通过验收。桌面发布不包含完整旧版迁移发布链。

打包输入、缓存和模式切换见 [BUILD.md](BUILD.md)；macOS 平台要求见 [MACOS.md](MACOS.md)。

## 手动桌面候选与发布

在 Actions → **Build desktop release candidates** 中选择版本、构建方式和平台。`publish=false` 只保留 CI artifact；`publish=true` 要求从 `main` 构建两个平台、使用已与项目负责人确认的 `docs/releases/<版本>.md`，并在两平台通过后由 GitHub 发布任务直接校验和上传。失败后可通过 **Publish desktop candidate** 复用同一次构建的 artifact，不重新打包。两种构建方式使用同一个手动入口：

| 构建方式 | 版本 | 产物与发布范围 |
| --- | --- | --- |
| `node`（默认） | `X.Y.Z` 及 alpha、beta、rc、dev 预发布版本 | Node 阶段编排、`config/desktop-build.json` 锁定的 DSH 候选组合；Windows ZIP 与安装包、macOS ZIP 与 DMG，以及校验和与平台回执。stable 另带 Windows 更新清单。可发布双平台预发布或正式 Release。 |
| `ps1` | 同一版本范围 | 旧 PowerShell 入口、锁定源码配方，暂供配方与回执对照。 |

`node` 构建即使只保留 artifact，也要求已确认的版本说明，以便之后直接发布同一份产物。公开 Release 会再次核对运行来源、源码提交、版号、说明、两平台归档哈希、启动验收及安装包检查；已有同标签、同文件名但不同字节的资产不会被覆盖。macOS stable 包必须带 Sparkle 配置和公钥，DMG 从已验收 ZIP 的应用生成并进行只读镜像核对；当前仍为 ad-hoc 签名，Developer ID 签名、公证和 appcast 私钥签名须按独立发行验收流程完成。机构版需另按其私有发行配置和验收流程执行。

Release notes 必须先与项目负责人讨论确认，不由代理自行编写或由构建脚本生成。确认后将原文保存为 `docs/releases/<版本>.md`，填写路径并勾选 `notes_approved`。发行包含社区贡献时，在说明中列出贡献者的 GitHub 用户名、改动和 PR 链接。真实登录、模型对话、系统权限和升级行为由维护者在目标平台另行验收；CI 回执只记录实际执行的检查。

日常 `main` 更新由 [双平台开发包工作流](../.github/workflows/development-desktop.yml)自动构建并保留 artifact，不创建 GitHub Release。GitHub 只发布 Electron；Go 过渡包仍走旧 OSS 渠道。构建命令与平台输入见[构建指南](BUILD.md)，macOS 签名和安装要求见[macOS 支持](MACOS.md)。
