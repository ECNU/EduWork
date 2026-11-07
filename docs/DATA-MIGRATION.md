# 数据清单与迁移兼容边界

本文列出[旧便携版迁入 Windows 标准安装版](WINDOWS-INSTALLED-MIGRATION.md)时复制的数据、兼容条件和遇到中断后的处理方式。

## 适用版本

数据格式以[当前桌面构建配置](../config/desktop-build.json)选中的 DSH 锁和组件锁为依据。包源码的开发版本、插件声明的兼容范围与产品实际装配版本分别管理；更换锁定组合后需要重新核对格式与迁移规则。

| 组件 | 本文对应的版本 | 来源 |
| --- | --- | --- |
| EduWork | `0.4.13` | [源码回执](../source-receipt.json) |
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
| `P` | 新程序根目录，由标准安装器提供 |
| `W` | 独立可写根目录；默认使用 `%LOCALAPPDATA%/EduWork/<distribution>` |
| `N` | 发行版数据命名空间 `<distribution>-electron` |
| `H` | DSH 数据目录，即 `S/data/N/dsh` |
| `B` | Electron 浏览器与凭据目录，即 `S/data/N/browser` |

目录迁移后，清单中的 `S` 相对路径保持不变，根目录换为 `W`。S、P、W 应使用互不包含的真实目录；不要将程序目录别名当成已经验证的独立数据目录。

macOS 的 DSH 与浏览器数据位于用户 Application Support 下的发行版目录，Alpha 身份还可能使用独立命名空间，实际选择见[桌面路径实现](../dsh-electron/src/desktop-paths.mjs)。不能套用 Windows 的 S → W 流程；macOS 备份恢复、跨设备迁移需要分别确定支持范围。

## 数据清单

下表说明迁入安装版时复制哪些数据，以及迁入后应核对的内容。H 中未单列的文件也随目录复制，下方列出的排除项除外。

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
| 用户插件与 Skills | profile 中的用户依赖、H 内插件资料及 `H/skills/` | 随 H 复制，排除 Skill 暂存与回收目录 | 保留来源、版本、启用状态和用户内容；自建链接会拒绝；旧 profile 指向程序依赖的受管链接验证归属后不迁入，依赖由新程序提供。插件自行写到 H 外的数据不在此复制范围内 |
| 工作区注册与会话归属 | `H/storages/workspace.json`；workspace 数据域 v2 | 复制注册表，拒绝程序目录内部工作区 | 保留工作区 ID、路径、会话列表、排序、置顶和归档状态；不自动改写绝对路径 |
| 外部工作区资料与成果 | 注册表指向的外部目录，含 Office、媒体和可编辑工程 | 不复制、不移动、不删除，只保留引用 | 完整备份需明确仅保存引用还是包含文件；跨设备、缺盘或路径变化必须提示并处理路径重映射 |
| Studio 索引与任务 | `H/plugins/dsh-knowledge-studio/workspaces/<id>/index.lbug`、`task.json` | 随 H 复制 | 索引不能代替源资料和成果；关闭数据库后复制，恢复需核对工作区关联。中断的索引任务不能误记为已完成 |
| 凭据与加密上下文 | `B/credentials.encrypted`、`B/Local State`；Electron `safeStorage` | 一起复制；有凭据库但缺 Local State 时拒绝 | 文件相同不代表能解密；同用户环境需要验证，跨用户、跨设备或跨系统应按需重新认证 |
| 账号、邮件与浏览器状态 | profile 配置和 credential ref；B 下 Cookies、Local Storage、Preferences 等 | 浏览器状态按排除规则复制 | 配置、凭据引用和浏览器状态分别保留；不能由复制成功推断登录有效或令牌未过期 |
| 更新偏好与配置备份 | `S/data/state/update-preferences.json`、`software-update-preferences.json`、`data/configuration/eduwork.previous.jsonc` | 存在时复制到 W 下同名位置 | 保留用户更新选择；不迁入下载包、helper 或未完成的更新事务 |
| 配置初始化与发行内容状态 | `S/data/configuration/state.json`、`data/state/` 下迁移回执、`data/content-updates/<scope>/`、`data/publisher-bootstrap/` | 复制到 W 下同名位置，软件更新事务除外 | 保留初始化标记、默认配置指纹、签名内容、已启用 Skills 和版本下限；未完成的配置或内容更新须先恢复或完成 |
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

允许进入迁移不等于已经完成 Windows 原生应用验收。详细流程见[安装与迁移](WINDOWS-INSTALLED-MIGRATION.md)。

| 来源与目标 | 当前规则 | 边界 |
| --- | --- | --- |
| Windows x64 Electron 便携版 `0.4.12` 或 `0.4.13` → 标准安装版 | 同发行版、appId、完整 DSH、Node、Electron 与 npm 插件包身份一致时允许 | 公版 `0.4.12` 的远程访问插件版本与当前装配不同，会被组件校验拒绝 |
| 迁移格式 v1 的兼容便携包 → 标准安装版 | 同上 | 核对来源与目标实际装配回执，不能只看版本号 |
| DSH 版本或提交、Node/Electron 版本、npm 插件版本或包哈希不一致 | 拒绝 | 需先定义并验证数据转换，不通过修改身份文件绕过 |
| 通用版 ↔ 机构版，或 appId 不同 | 拒绝 | 配置、能力与身份映射需另行定义 |
| EduWork ↔ 官方 DSH | 未支持 | 仍需确定双向映射、插件缺失和不兼容设置的处理 |
| macOS、跨 Windows 用户或跨设备 | 不在这条迁移流程的支持范围 | 路径与凭据绑定分别评估；不能用同机文件复制推导兼容 |

准入配置见[Windows 便携迁移配置](../config/windows-portable-migration.json)，实现见[共享迁移器](../dsh-electron/src/portable-migration.mjs)。

## Windows 目录迁移的目标冲突与失败恢复

| 条件 | 当前行为 | 数据保护边界 |
| --- | --- | --- |
| W 不存在或为空目录 | 允许进入迁移 | S、P、W 互不包含；成功后写入 W 归属标记和迁移回执 |
| W 非空或已有归属标记 | 拒绝 | 不覆盖、不静默合并；首次启动先询问迁移或全新使用；已有数据不覆盖 |
| 同一来源已成功迁移，再次启动 | 读取一致的回执并使用已迁入数据，不重复复制 | 保留 handoff 和已激活目标 |
| 参数路径重叠、W 自身或数据映射中的扫描项为符号链接 | 拒绝 | 来源根目录链接也会拒绝；父目录别名、进程和工作区按物理路径检查 |
| 工作区的记录路径或物理路径位于 S 内 | 拒绝 | 需要单独迁出工作区并验证引用；目录迁移器不自动处理 |
| 外部工作区仍在原路径 | 保留引用 | 外部文件不变；路径不存在时，复制注册表不能恢复缺失文件 |
| 旧应用、相关后台进程仍运行，或存在 pending update / 未完成事务 | 拒绝 | 不强行终止进程，不删除事务文件绕过保护 |
| 空间不足或无法确定可用空间 | 实际迁移拒绝 | 要求复制文件总字节数加 16 MiB 余量；dry-run 可能仍返回清单，须检查空间字段 |
| 凭据库存在但缺 Local State | 拒绝 | 不产生可用目标；文件齐全后仍须验证真实解密 |
| 激活前复制、哈希校验或回执写入失败 | 尝试恢复 S 的原路径，清理本次 staging | 检测到源数据变化时中止；若原路径被重新占用，保留 handoff 并报告人工处理 |
| 进程中断，journal 有效且目标尚未激活 | 可恢复或清理陈旧状态后重试 | dry-run 先显示恢复动作；目标冲突、日志无效或来源不明确时保留现场 |
| 回执为 `activated`，但首次启动失败 | 保留目标与 handoff，不自动标为应用验收成功 | 目标可能已产生新数据，不能直接覆盖、删除或与旧数据合并 |

`activated` 表示文件已复制、校验并切换到目标目录。应用能否读取会话和附件、保留记忆遗忘标记、加载设置与插件、解密凭据，以及退出后的冷启动，仍是不同的验证要求。
