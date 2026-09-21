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
| 验证后发行 | `0.3.5`，DSH 为 `0.1.5-rc.2` | 公测版 | 经审阅后发布 |
| 后续开发 | `0.3.6-dev.20260913.1` | 开发版 | 普通测试用本地包或 CI artifact；获批后可发布 GitHub prerelease |
| 上游稳定后的发行 | 例如 `0.4.0`，DSH 无预发布后缀 | 正式版 | 经审阅后发布 |

日期采用北京时间，同一天的构建序号递增。每次构建必须指定版本，不以打包机时间隐式决定。开发版使用 `X.Y.Z-dev.YYYYMMDD.N`，公测发行使用 `X.Y.Z`、标签 `vX.Y.Z`，需要通过 GitHub 推送开发版时，标签为 `vX.Y.Z-dev.YYYYMMDD.N` 并设置 prerelease；必须先确认版本号和发布说明。普通 CI 构建不创建 Release。已发布版本不可复用。0.x 阶段能力或兼容性变化通常提高次版本，兼容修复提高补丁版本。

Windows 设置恢复“公测版”和“开发版（含公测版）”两个更新渠道。公测只查 stable，拒绝开发包；开发同时查 development/stable，按 SemVer 选择较新版本。`0.3.4 < 0.3.5-dev.20260912.1 < 0.3.5`，因此同基线开发版可升级到公测版。切换渠道不会降级，也不改变当前版本徽标；下载、待安装、安装期间不允许切换。用户选择随升级保留。装配必须核对产品版本、首页中英文徽标一致，不能仅改回执版本号而复用旧徽标资源。

公版与 ECNU 版同一次发行使用相同的产品版本。发行配置、平台和壳放进文件名，例如 `EduWork-0.3.0-windows-x64-electron.zip` 与 `EduWork-ECNU-0.3.0-windows-x64-electron.zip`。它们不能互相覆盖数据和配置。壳名不放进 SemVer 后缀。

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

1. 本地修改、测试、生成干净源代码快照。两个仓库各自是一条干净历史；机构仓锁定公版快照的实际提交。
2. 审阅版本、文档、示例、隐私扫描、许可证和插件组合。独立插件的开发包与公开稳定包分别冻结，禁止覆盖同版本 tarball。
3. 经授权后先推公版，再推锁定该公版提交的 ECNU 仓。仓库私有期间，机构 CI 可配置 `EDUWORK_CORE_SSH_KEY` 专用只读部署密钥，或 `EDUWORK_CORE_READ_TOKEN` 细粒度只读令牌，权限仅限读取公版；公开后移除并撤销专用凭据，使用通常的 token。配置方法见机构仓构建指南。
4. 当前 `validate-local-web.yml` 从锁定 npm Runtime/插件及产品源码构建，执行源码/依赖检查和构建，上传轻量脱敏报告。它不会创建 Release。开发产物不进入用户更新渠道；私有 Fork PR 的跨私有仓构建限制见 [协作说明](../CONTRIBUTING.md)。
5. 真实桌面、原生 Office/音视频、OIDC、托盘、链接、移动目录验收后，冻结最终 Electron 产物及 SHA-256，再启用正式 Release/更新渠道。ECNU 旧版升级另附本地过渡验收记录，不要求 GitHub 构建临时 Go 包。见 [发行检查项](../RELEASE-CHECKLIST.md)。CI 产物留存不等于一次公开发行。

公版发行入口为 GitHub Releases。原样镜像 CI ZIP 时可复用其大小和校验值；机构在本机加入私有配置后，必须重新计算包内清单、ZIP 摘要与大小，并据此生成学校 OSS 更新清单。程序文件保持 CI 原样，不为学校渠道重新编译。Release 工作流接收公测版本 `X.Y.Z` 或开发版本 `X.Y.Z-dev.YYYYMMDD.N`；开发版发布为 prerelease，不占用公测 latest，并检查两仓版本、核心提交、插件锁、原生资源回执和 ZIP 哈希；发布权限只交给发行 job。

Windows Electron Release 工作流已提供（见下文），不包含签名安装器和完整旧版迁移发布链。Windows 构建不能代替 macOS 平台验证。

打包输入、缓存和模式切换见 [BUILD.md](BUILD.md)；macOS 平台要求见 [MACOS.md](MACOS.md)。

## 触发 Windows Electron Release

开发更新包可由机构仓的 `Build ECNU Windows development artifact` 工作流构建，版本使用 `X.Y.Z-dev.YYYYMMDD.N`。它复用同一桌面构建、锁定依赖、ZIP 校验和启动检查，只保留 Actions artifact，不创建 Release、不编写发行说明，也不接触 OSS 凭据。源码基线版本和实际装配版本分别记录在回执中；界面徽标与默认更新渠道使用实际装配版本。维护者下载精确的 CI ZIP 后做升级验收，最后发布开发渠道清单。

开发包在普通逐文件清单上追加更新器所需的 `launcherVersion`、`flavor` 和 `launch`，附带旧快捷方式兼容入口。同一 ZIP 可用于新装及已验收的 Go 过渡版到 Electron 更新。0.2 原入口仍只提供 Go 过渡包，开发包不能直接下发给 0.2。

机构本地验收也使用 GitHub CI 的同一份 ZIP：下载 Release 资产并核对 SHA-256，使用 `scripts/configure-desktop-archive.ps1` 加入私有配置。公版与机构版均使用 `config/eduwork.jsonc`；启用首次下载配置的机构包可直接分发 CI 原包，详见[配置更新策略](UPDATES.md#配置随升级如何处理)。仅加入配置和已支持的品牌文件，不重新编译或替换 `resources/`。实际 Client ID、凭据与个人信息不提交仓库，也不通过 CI secret 注入安装包；公开配置只提供占位模板。归档验收记录时保留运行编号、提交、原始 ZIP 哈希及配置之外文件的校验结果，实际私有配置单独保管。

Release notes 必须先与项目负责人讨论确认，不由代理自行编写，也不由构建脚本自动生成。确认后将原文存为发行仓库的 `docs/releases/<版本>.md`；触发时填写 `release_notes` 路径，并确认 `notes_approved`。未确认、文件缺失或空白时停止发布；CI 原样复制已确认的说明，记录 SHA-256，发布 job 再核对摘要。日常源码 CI 不需要发布说明，也不会创建 Release。GitHub 始终只发 Electron；Go 过渡包仅通过旧 OSS 更新渠道分发。

维护者在仓库 Actions → Release Windows Electron → Run workflow 中选择 main，填写已确认的产品版本，例如公测版 `0.3.5` 或开发版 `0.3.6-dev.20260914.3`。ECNU 仓运行对应同名工作流；先提交公共核心，再让 ECNU 的 core.lock.json 锁定该提交、源文件哈希和相同版本。构建产物的源码与组件校验信息须对应所选提交。

工作流只接受手动触发，不因 PR、main push 或任意 tag 自动发行。build job 只有 Contents: Read；跨私有仓仍使用专用只读部署密钥。只有依赖构建、整包校验和启动冒烟通过的 publish job 获得 Contents: Write。发布前以草稿上传并核对 ZIP、SHA-256、构建回执和说明，全部成功才将 Release 发布；同版本不同字节或其他提交的标签会拒绝覆盖。上传失败留下草稿供排查，不对用户暴露半成品。

CI 使用锁定 npm Runtime 和插件，固定 DSH 源码只作为 UI 编译及官方 Desktop Host/Electron 适配输入。Node、Python/wheels、Whisper/模型使用 SHA-256；Chromium 按独立资源锁中的版本从 Playwright 官方 CDN 下载，分别核对已锁定的归档和可执行文件 SHA-256；不使用较新 npm Playwright 默认选择的浏览器。Microsoft DLL 来自 Windows runner 的 Visual Studio x64 Redist 目录，检查微软签名并记录实际版本/哈希。

CI 仅执行源码与锁定依赖检查、构建、打包、解压同一 ZIP 后的完整性校验，以及实际客户端启动冒烟（界面载入与 Host 基本通信）。不在 CI 反复执行模型会话、OIDC 登录/重启、Office 或音视频业务全流程；这些由维护者提交前在本地验收，现有完整测试脚本保留。回执的 ci-build-and-launch-v1 范围只记录 CI 实际执行的项目。测试使用临时配置和数据，账号或数据不进入安装包。

发行包含 Windows x64 Electron ZIP、同名 .sha256、release-receipt.json、RELEASE-NOTES.md 和 update-windows-amd64.json。构建中间 ZIP artifact 保留 3 天，脱敏验收报告保留 7 天。签名安装器、macOS 和旧 Go 两跳迁移不由此流程发布；本流程不会修改 OSS、旧更新清单或仓库可见性。
