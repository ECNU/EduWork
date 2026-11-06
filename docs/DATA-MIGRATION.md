# 数据清单与迁移兼容边界

本文说明 [#124：完整备份恢复与 DSH 双向迁移](https://github.com/ECNU/EduWork/issues/124) 的数据范围，以及 Windows 便携版离线备份恢复原型的用法。原型先支持同组合、空目标恢复；已有的历史会话导入入口见[历史数据导入](数据导入.md)，会话合并与整目录恢复分别适用。

下文“Windows 目录迁移”指 [#251 的实验实现](https://github.com/JJasonSun/EduWork/blob/e22d7202c6fcf2692014cf0703a4067eedf9da78/dsh-electron/scripts/migrate-portable-to-installed.mjs)：将便携版个人数据复制到独立可写目录。它不提供完整备份包、跨版本转换或已有目标数据合并，也不代表已发布标准安装版。安装、升级与卸载的后续设计见 [#176](https://github.com/ECNU/EduWork/issues/176)。

## 适用版本

数据格式以[当前桌面构建配置](../config/desktop-build.json)选中的 DSH 锁和组件锁为依据。包源码的开发版本、插件声明的兼容范围与产品实际装配版本分别管理；更换锁定组合后需要重新核对格式与迁移规则。

| 组件 | 本文对应的版本 | 来源 |
| --- | --- | --- |
| EduWork | `0.4.12` | [源码回执](../source-receipt.json) |
| DSH | `0.2.2-rc.1`，提交 `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db` | [内核锁](../third_party/dsh/candidate-v0.2.2-rc.1/LOCK.json) |
| 本地记忆 | `@eduwork/dsh-memory@0.2.1` | [组件锁](../third_party/dsh/candidate-v0.2.2-rc.1/memory.json) |
| Studio | `@eduwork/dsh-knowledge-studio@0.6.4` | [组件锁](../third_party/dsh/candidate-v0.2.2-rc.1/knowledge-studio.json) |
| 身份与邮件 | `@eduwork/dsh-oidc@0.3.3`、`@eduwork/dsh-mail@0.2.4` | [身份锁](../third_party/dsh/candidate-v0.2.2-rc.1/oidc.json)、[邮件锁](../third_party/dsh/candidate-v0.2.2-rc.1/mail.json) |

其余预装插件及安装依赖见[插件安装清单](../third_party/dsh/candidate-v0.2.2-rc.1/source-probe/package.json)和[包维护说明](PACKAGES.md#客户端装配)。历史 `config/assembly.eduwork.json` 与 `third_party/npm-015-rc1/` 属于 DSH 0.1.5 配方，不是当前默认桌面组合。

## 目录约定

以下清单先覆盖 Windows 旧便携版这一迁移来源：

| 符号 | 含义 |
| --- | --- |
| `S` | 旧便携程序根目录，包含可执行程序、`config` 和 `data` |
| `P` | 新程序根目录，由匹配组合的开发包提供 |
| `W` | 独立可写根目录；#251 默认使用 `%LOCALAPPDATA%/EduWork/<distribution>` |
| `N` | 发行版数据命名空间 `<distribution>-electron` |
| `H` | DSH 数据目录，即 `S/data/N/dsh` |
| `B` | Electron 浏览器与凭据目录，即 `S/data/N/browser` |

目录迁移后，清单中的 `S` 相对路径保持不变，根目录换为 `W`。S、P、W 应使用互不包含的真实目录；不要将程序目录别名当成已经验证的独立数据目录。

macOS 的 DSH 与浏览器数据位于用户 Application Support 下的发行版目录，Alpha 身份还可能使用独立命名空间，实际选择见[桌面路径实现](../dsh-electron/src/desktop-paths.mjs)。不能套用 Windows 的 S → W 流程；macOS 备份恢复、跨设备迁移需要分别确定支持范围。

## 离线备份恢复原型

[备份脚本](../scripts/backup-desktop.mjs)从已退出的 Windows x64 Electron 便携版读取数据，生成包含 `BACKUP-MANIFEST.json` 和 `payload/` 的备份目录。恢复时另行提供匹配的便携程序目录，脚本将程序和备份数据复制到一个空目标，得到独立的便携版副本。它不修改来源程序、备份或外部工作区，也不向当前客户端合并数据。

### 范围与准入

- **同组合**：发行版、appId、完整 EduWork 版本、DSH 版本与提交一致；程序文件还须逐个符合 `RELEASE-MANIFEST.json`，整个程序文件集的 SHA-256 必须与备份一致。插件、Runtime、桌面壳或程序字节不同都会拒绝，即使版本号相同。开发后缀也必须相同。
- **备份数据**：整个 `config/`、`data/N/dsh/`、`data/N/browser/`、`data/N/logs/`，以及 `data/state/`、`data/configuration/`、`data/content-updates/` 和 `data/publisher-bootstrap/`。保留空目录；排除软件更新目录 `data/state/updates/`，以及下文列出的 Skill 临时目录、附件临时对象与浏览器缓存。原型保留全部配置文件、初始化状态、更新偏好与迁移回执、已启用的在线 Skills 和版本状态，范围比 #251 当前的目录映射更宽。
- **外部资料**：只保存工作区注册与引用，不复制外部文件，不改写绝对路径。注册表中的工作区与来源程序、备份、配套程序或恢复目标有目录包含关系时拒绝；通过目录别名引用同一位置也会检查。会话 cwd 和插件自存路径保持原文，恢复后需核对。自定义配置环境变量指向的外部文件和其他数据命名空间不在备份范围内。程序目录中存在未列入发行清单的额外文件时会拒绝，需先另行保管。
- **停写要求**：开始前退出应用及其后台进程，命令结束前不要重启。脚本检查相关 Windows 进程、待安装更新和软件更新事务；配置或内容更新存在待应用、试运行或待重试状态时也会拒绝。复制后重新核对源文件和进程，无法查询进程或磁盘空间时停止。它不是在线数据库快照工具。
- **空目标**：输出目录必须不存在或为空，父目录须已存在；输入与输出不能相同或相互包含。所复制目录中的符号链接、Windows 路径别名冲突、不安全文件名，以及不完整的凭据上下文会被拒绝。需要文件总大小之外至少 16 MiB 的可用空间。

备份保留完整记忆数据库及其边车文件，不通过记忆语义导出生成快照。遗忘标记和会话策略随原文件保留；恢复旧备份仍会回到备份时的状态，不会自动融合备份后发生的遗忘。

### 使用方法

使用仓库锁定的 Node.js 24 工具链，在 Windows 上从仓库根目录执行。所有参数使用绝对路径；示例中的备份目录和恢复目标均应为空或尚未创建。

```powershell
# 检查数据范围、程序身份、文件哈希、进程与空间，不写入备份。
node scripts/backup-desktop.mjs backup --source "D:\Apps\EduWork" --output "E:\Backups\EduWork-snapshot" --dry-run

# 生成离线备份目录。
node scripts/backup-desktop.mjs backup --source "D:\Apps\EduWork" --output "E:\Backups\EduWork-snapshot"

# 配套程序可来自同一发行包，也可使用仍完好的来源程序目录。
# 只复制其已校验的程序文件，使用备份中的个人配置和数据。
node scripts/backup-desktop.mjs restore --backup "E:\Backups\EduWork-snapshot" --program "D:\Packages\EduWork" --target "D:\Restored\EduWork" --dry-run
node scripts/backup-desktop.mjs restore --backup "E:\Backups\EduWork-snapshot" --program "D:\Packages\EduWork" --target "D:\Restored\EduWork"
```

`--dry-run` 会执行与写入前相同的校验，输出组合身份和数据文件清单，不创建目标或临时目录。正式恢复先检查备份清单、文件数量、大小和 SHA-256，再从配套程序和备份复制；配套程序中的个人配置与 `data/` 不参与恢复。

备份目录包含个人配置、会话、浏览器状态和加密凭据，脚本不额外加密或脱敏。妥善保存完整目录，并另行保留匹配的程序包；它不是诊断附件。哈希用于发现文件损坏，不能证明未知来源备份或程序的可信性。

### 失败与恢复后的检查

复制在目标旁的 `.eduwork-backup-*` 临时目录中完成；校验通过后才切换为目标目录。复制、哈希或来源复查失败时清理本次临时目录，保留输入和已有目标。进程被强制终止或机器断电可能留下临时目录；确认命令已经退出、目标与原始输入仍完好后，再单独清理对应临时目录并重试。脚本不自动删除旧临时目录或继续半份备份。

命令成功仅表示文件恢复完成。首次使用恢复副本时，分别核对会话与附件、工作区路径、记忆与遗忘记录、设置与用户插件；凭据是否可解密、账号是否仍有效，以及退出后的冷启动，都需在 Windows 原生应用中确认。验证完成前保留原数据和备份。

原型不提供客户端按钮、压缩包、自动备份、已有数据合并、跨版本转换、官方 DSH 双向迁移或 macOS 恢复。跨 Windows 用户或设备的凭据可用性也不在当前保证范围内。文件层回归可运行 `node --test tests/desktop-backup.test.mjs`；合成数据检查不能代替真实桌面验收。

## 数据清单

“目录迁移行为”描述 #251 的复制范围；“保留与恢复要求”用于约束完整备份设计，不表示这些恢复能力已经实现。H 中未单列的文件仍在整树复制范围内，本表不是清理或删除列表。

| 数据 | 位置或格式 | 目录迁移行为 | 保留与恢复要求 |
| --- | --- | --- | --- |
| 会话原始记录 | `H/sessions/<project>/<session>/`；当前为 v4，默认 Zstandard JSONL | 复制整个会话目录 | 保留日志、代际文件及辅助文件；关闭写入后再复制，恢复时核对会话 ID、cwd、事件序列和附件引用 |
| 会话投影与搜索 | `H/storages/session_projcache/`、`H/session-query-memory.sqlite3` | 随 H 复制 | 属于可重建数据，不能代替原始会话；数据库须停止写入，缓存兼容不等于会话或整包兼容 |
| 上传文件与图片 | `H/attachments/v1/` | 复制正式对象，排除 `tmp/` | 保留内容对象、显示名路径及图片对象；会话中的引用须能解析到内容一致的文件 |
| 本地记忆 | `H/memory.sqlite3`；`local_memory` 数据域 v1 | 随 H 复制 | 保留记录、遗忘标记 `tombstones`、会话策略 `session_policies`、编辑历史和置顶状态；不能只复制可见记忆文本 |
| 记忆语义导出 | `dsh-local-memory` v2 JSON，由用户选择位置保存 | 不额外搜集外部导出文件 | 当前导出只有 `records`，不含遗忘标记和会话策略，不能作为完整记忆备份 |
| 桌面配置 | `S/config/eduwork.jsonc`；可选 `config/examples/`、`config/update.bridge.json` | 复制到 W 下同名位置 | 保留用户设置与凭据引用；配置可能包含敏感值，备份与共享应分别处理 |
| DSH 设置与插件启用状态 | `H/profiles/desktop-017/package.json`、`cordis.patch.yml`、依赖锁与模块，以及 H 根目录 patch | 随 H 复制 | 同时保留 profile 配置、依赖和 bundle 启用列表；只备份旧 `settings.yaml` 会遗漏当前设置 |
| 历史设置与迁移状态 | `H/settings.yaml*`、`.eduwork-settings-migration.json`、profile 更新 journal | 随 H 复制 | 原文和回执须一致；保留尚无对应插件的设置节，不能提前删除迁移中的文件 |
| 用户插件与 Skills | profile 中的用户依赖、H 内插件资料及 `H/skills/` | 随 H 复制，排除 Skill 暂存与回收目录 | 保留来源、版本、启用状态和用户内容；扫描到符号链接会拒绝。插件自行写到 H 外的数据不在此复制范围内 |
| 工作区注册与会话归属 | `H/storages/workspace.json`；workspace 数据域 v2 | 复制注册表，拒绝程序目录内部工作区 | 保留工作区 ID、路径、会话列表、排序、置顶和归档状态；不自动改写绝对路径 |
| 外部工作区资料与成果 | 注册表指向的外部目录，含 Office、媒体和可编辑工程 | 不复制、不移动、不删除，只保留引用 | 完整备份需明确仅保存引用还是包含文件；跨设备、缺盘或路径变化必须提示并处理路径重映射 |
| Studio 索引与任务 | `H/plugins/dsh-knowledge-studio/workspaces/<id>/index.lbug`、`task.json` | 随 H 复制 | 索引不能代替源资料和成果；关闭数据库后复制，恢复需核对工作区关联。中断的索引任务不能误记为已完成 |
| 凭据与加密上下文 | `B/credentials.encrypted`、`B/Local State`；Electron `safeStorage` | 一起复制；有凭据库但缺 Local State 时拒绝 | 文件相同不代表能解密；同用户环境需要验证，跨用户、跨设备或跨系统应按需重新认证 |
| 账号、邮件与浏览器状态 | profile 配置和 credential ref；B 下 Cookies、Local Storage、Preferences 等 | 浏览器状态按排除规则复制 | 配置、凭据引用和浏览器状态分别保留；不能由复制成功推断登录有效或令牌未过期 |
| 更新偏好与配置备份 | `S/data/state/update-preferences.json`、`software-update-preferences.json`、`data/configuration/eduwork.previous.jsonc` | 存在时复制到 W 下同名位置 | 保留用户更新选择；不迁入下载包、helper 或未完成的更新事务 |
| 配置初始化与发行内容状态 | `S/data/configuration/state.json`、`data/state/` 下迁移回执、`data/content-updates/<scope>/`、`data/publisher-bootstrap/` | 除上一行列出的文件外，未纳入 #251 当前映射 | 备份恢复原型复制这些目录，保留初始化标记、默认配置指纹、签名内容、已启用 Skills 和版本下限；未完成的配置或内容更新须先恢复或完成 |
| 日志与活动缓存 | `S/data/N/logs/`、`H/derived/activity-insights/v3/` | 日志存在时复制，活动缓存随 H 复制 | 日志可能含路径与诊断信息；派生缓存不能替代原始历史数据 |
| 程序与发行资源 | S 下程序、Runtime、resources 和产品模块 | 不复制到 W | 新程序由 P 提供；旧程序和数据保留在 handoff 副本，不能在新版验证成功前删除 |
| 其他顶层用户文件 | S 中不属于上述映射的文件或自建目录 | 不进入 W，仍保留在 handoff | 复制清单不等于全部个人文件清单；完整备份需识别额外文件并明确纳入方式 |

数据库必须在相关应用与后台服务停止写入后复制。不能仅凭文件名删除 SQLite 的 WAL/SHM 文件，也不能把对单个数据库文件的哈希校验当成一致性快照。

### 明确排除的内容

- H 下的 `.skill-staging/`、`.skill-trash/` 和 `attachments/v1/tmp/`。
- B 下的 `Cache`、`Code Cache`、`GPUCache`、`DawnGraphiteCache`、`DawnWebGPUCache`、`Shared Dictionary`、`Session Storage`、`lockfile`、`SingletonLock`、`DevToolsActivePort`，以及首段以 `declarative_performance_observer.db` 开头的路径。`Local Storage` 不在排除项中。
- 未列入映射的程序文件、更新下载与事务目录，以及外部工作区内容。

文件清单不单独保存空目录；`skipped` 提示也未必逐项列出嵌套排除路径，应结合上述规则阅读实际文件清单。

## Windows 目录迁移的版本兼容矩阵

以下准入规则仅用于 #251 的 Windows 目录迁移。“允许”表示可以进入文件迁移流程，不代表当前组合已经通过原生应用验收。

| 来源与目标 | 当前规则 | 边界 |
| --- | --- | --- |
| Windows x64 Electron portable → installed；同发行版、同 appId、同 DSH 版本及完整提交、同 EduWork 基础版本 | 允许 | 还须满足目标目录、进程与数据检查 |
| `0.4.12` → `0.4.12-dev.<…>`，其他身份一致 | 允许 | 基础版本按首个 `-` 之前的部分比较；开发后缀差异不等于支持跨版本转换 |
| EduWork 基础版本不同 | 拒绝 | 不转换数据，不通过更改版本文件绕过 |
| DSH `0.2.1-rc.3` → `0.2.2-rc.1`，或任何 DSH 版本/提交不一致 | 拒绝 | 单个会话格式的升级能力不能替代整包兼容判断 |
| 通用版 ↔ 机构版，或 appId 不同 | 拒绝 | 配置、能力与身份映射需另行定义 |
| EduWork ↔ 官方 DSH | 未支持 | #124 尚需确定双向映射、插件缺失和不兼容设置的处理 |
| macOS、跨 Windows 用户或跨设备恢复 | 不在当前支持范围 | 路径、凭据绑定和平台数据库分别评估；不能用同机文件复制结果推导兼容 |

应用版本、DSH 版本、每个数据域的格式版本和插件版本须分别记录。RELEASE-MANIFEST 的基本身份检查不等于已经验证所有程序文件，也不覆盖插件数据格式的兼容性。

## Windows 目录迁移的目标冲突与失败恢复

| 条件 | 当前行为 | 数据保护边界 |
| --- | --- | --- |
| W 不存在或为空目录 | 允许进入迁移 | S、P、W 互不包含；成功后写入 W 归属标记和迁移回执 |
| W 非空或已有归属标记 | 拒绝 | 不覆盖、不静默合并；先启动 installed 会初始化 W，随后导入同样被拒绝 |
| 同一来源已成功迁移，再次执行 | 拒绝重复迁移 | 保留 handoff 和已激活目标 |
| 参数路径重叠、W 自身或数据映射中的扫描项为符号链接 | 拒绝 | 根目录别名不等于一律拒绝；进程与工作区检查还会解析物理路径 |
| 工作区的记录路径或物理路径位于 S 内 | 拒绝 | 需要单独迁出工作区并验证引用；目录迁移器不自动处理 |
| 外部工作区仍在原路径 | 保留引用 | 外部文件不变；路径不存在时，复制注册表不能恢复缺失文件 |
| 旧应用、相关后台进程仍运行，或存在 pending update / 未完成事务 | 拒绝 | 不强行终止进程，不删除事务文件绕过保护 |
| 空间不足或无法确定可用空间 | 实际迁移拒绝 | 要求复制文件总字节数加 16 MiB 余量；dry-run 可能仍返回清单，须检查空间字段 |
| 凭据库存在但缺 Local State | 拒绝 | 不产生可用目标；文件齐全后仍须验证真实解密 |
| 激活前复制、哈希校验或回执写入失败 | 尝试恢复 S 的原路径，清理本次 staging | 检测到源数据变化时中止；若原路径被重新占用，保留 handoff 并报告人工处理 |
| 进程中断，journal 有效且目标尚未激活 | 可恢复或清理陈旧状态后重试 | dry-run 先显示恢复动作；目标冲突、日志无效或来源不明确时保留现场 |
| 回执为 `activated`，但首次启动失败 | 保留目标与 handoff，不自动标为应用验收成功 | 目标可能已产生新数据，不能直接覆盖、删除或与旧数据合并 |

`activated` 表示文件已复制、校验并切换到目标目录。应用能否读取会话和附件、保留记忆遗忘标记、加载设置与插件、解密凭据，以及退出后的冷启动，仍是不同的验证要求。

## 后续能力边界

- **完整备份集合**：原型保存上述本地数据和程序组合清单；可选外部工作区文件、外部配置、压缩与加密，以及各数据域的语义兼容检查仍需分别实现。诊断 ZIP、记忆语义导出都不能代替完整备份。
- **已有数据处理**：原型只允许空目标；已有数据合并与替换尚未实现，不能静默覆盖。客户端内的恢复预演与操作入口也需单独设计。
- **遗忘与旧备份**：恢复或合并旧备份时必须处理较新的遗忘标记，避免旧记录重新启用已遗忘内容；当前目录迁移器不提供这类合并策略。
- **跨版本与双向迁移**：为限定版本建立转换规则，明确插件缺失、设置不兼容、外部路径变化和重新认证；不得通过放宽目录迁移的版本检查宣称支持。
- **恢复完成条件**：除文件完整性，还应核对会话—附件、会话—工作区、记忆—遗忘标记的关联，以及应用实际读取能力。原数据保留到目标验证完成；Windows 与 macOS 分别确定支持范围。

## 实现依据

- #251 的[迁移器](https://github.com/JJasonSun/EduWork/blob/e22d7202c6fcf2692014cf0703a4067eedf9da78/dsh-electron/scripts/migrate-portable-to-installed.mjs)、[目录选择](https://github.com/JJasonSun/EduWork/blob/e22d7202c6fcf2692014cf0703a4067eedf9da78/dsh-electron/src/desktop-paths.mjs)与[可写根初始化](https://github.com/JJasonSun/EduWork/blob/e22d7202c6fcf2692014cf0703a4067eedf9da78/dsh-electron/src/writable-root.mjs)。
- EduWork 的 [profile](../dsh-host/native-profile.mjs)、[历史设置迁移](../dsh-host/settings-migration.mjs)与[凭据存储](../dsh-electron/src/native-vault.mjs)。
- 锁定 DSH 的[会话格式](https://github.com/deepseek-ai/deepseek-harness/tree/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/session/session-format-catalog)、[会话持久化](https://github.com/deepseek-ai/deepseek-harness/tree/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/session/session-persistence-jsonl)、[附件存储](https://github.com/deepseek-ai/deepseek-harness/tree/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/attachment/attachment-local)与[工作区格式](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/workspace/workspace/src/spec.ts)。
- Memory 和 Studio 的实际输入由上表组件锁确定；用户功能与包维护入口分别见[本地记忆](../packages/dsh-memory/README.md)和 [Studio](../packages/dsh-knowledge-studio/README.md)。
