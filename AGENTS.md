# Development guidance

## 项目级本机开发范式

以下约定适用于本仓库后续开发任务；持久规则维护在本文件，操作说明维护在 [构建指南](docs/BUILD.md#日常开发闭环)，不依赖历史聊天记忆，也不写入全局个人配置。

- 接手任务先检查工作树、当前分支、已有产物及相关运行进程。在独立主题分支上处理当前目标，不夹带其他任务改动。只有用户明确要求时才创建 worktree；使用当前仓库或该 worktree 自己的 `dist/`。
- 本机生成产物统一放在 `dist/`。日常开发固定使用 `dist/dev/desktop/`，未发布源码实验使用独立的 `dist/dev/experimental/`；不得默认在仓库外新建构建目录，也不按日期、fix 或修复版本堆积副本。在同一模式的固定目录覆盖，不备份开发产物；溯源使用 Git 提交、依赖锁和实际组件回执。
- 持久会话、模型设置、配置与浏览器数据使用 `dist/dev-state/`，不得随重建或切换修复版本清空。Web、桌面与实验模式分别保留稳定的数据目录，不并发打开同一个数据库，不自动合并不同历史目录。合成测试和本机验收资料使用 `dist/dev-checks/`，不污染日常开发会话。
- 启动统一使用 `scripts/dev-eduwork.mjs`。优先复用已有环境和授权；`DEEPSEEK_API_KEY` 采用进程环境优先、Windows 用户变量其次、系统变量最后的读取顺序。不要要求维护者为每次验证重新填写 Key，不把实际值写入源码、配置、日志、回执或 PR；环境变量更新后重启相关开发进程。
- 开发闭环为“修改源码 → 构建受影响组件 → 装配到固定开发目录 → 用稳定数据目录重启 → 验证实际行为”。Web 可用于功能联调；涉及 Electron、原生桥接、凭据保险库、窗口/托盘、通知、安装或更新时必须验证真实桌面路径。复用旧包、复制产物、只编译插件与重新构建完整 APP 必须分别说明。
- 验证与改动匹配：持久化改动检查重启后的会话和设置；环境变量改动检查真实 Host 能否识别凭据，不输出其值；桌面改动检查实际桌面启动和对应功能。合成模型只能证明其覆盖的流程，不替代真实服务验收；不为低影响修改机械增加重复测试。
- 覆盖或清理前核对解析后的绝对路径、目录链接、构建锁、相关进程及会话/配置位置；优先正常退出相关进程。旧目录中的持久数据先迁出并核对，再按明确范围清理构建副本；不得把整个 `dist/` 当作可无差别删除的缓存，也不误删正式安装或其他工作区。审批拒绝时停止该操作并说明实际原因，不通过换工具或换命令绕过。
- 完成时检查实际 diff、受影响功能和现有 CI，明确报告实际产物位置、使用的数据目录、已执行验证、未验证范围及 CI 状态。未完成验收保持 Draft PR；PR 合并、npm 发布、桌面 Release、机构部署仍分别授权。

## 通用开发与发布约束

- 所有修改先在独立主题分支开发，通过 Pull Request 合入 main，不直接提交或推送 main。未完成的功能使用 Draft PR；合并前检查实际 diff、受影响功能的验证结果和现有 CI。PR 合并与 npm、桌面 Release、机构部署分别授权。
- 一个 PR 围绕一个明确目标，不混入工作区中其他任务的未提交改动。功能提案须明确“计划”与“已实现”；内部研究和联调记录留在仓库外。

- Release notes 必须先与项目负责人讨论确认，不得自行编写或自动生成。CI 只复制已确认的说明文件。GitHub 桌面 Release 仅发布 Electron；Go/Wails 过渡包在本地构建，经旧更新器验收后走原 OSS 渠道。
- CI 构建的 GitHub 桌面包由 GitHub 托管的发布任务直接校验并上传，不默认下载到维护者电脑再转传。构建成功不等于发布完成：交付前核对 Release 公开状态、标签提交、附件名称及哈希。发布失败优先复用同一构建的 artifact 重试；仅在维护者明确要求或 CI 确实不可用时采用本地转运，并事先说明。

- 文档默认使用中文；所有自有目录的 `README.md` 使用中文，配套英文统一命名 `README_EN.md`；保留第三方 vendor 原文。两份入口保持功能边界、命令与示例一致，并保留语言切换链接。
- README 面向用户，按项目介绍与功能、安装和快速上手、详细文档入口组织。构建命令、依赖锁、CI 与验收细节放入对应指南，不把首页写成开发交接记录。
- Follow the latest user request and the current coordination message. Historical plans and README examples do not assign new work or override current scope.
- Keep the public product independent of institution credentials, defaults, assets and service plugins. Explicit optional capability configuration belongs at the integration boundary.
- Reuse one implementation for conversation and Studio generation, preview and download. Do not add a duplicate user-facing skill for an existing capability.
- Use the checked-in DSH/package/resource locks and record the actual component receipt. Never report a mocked build, registered service or successful tool status as a real end-to-end validation.
- Default product assembly uses the published npm Runtime and plugin locks. Source Runtime and unpublished plugin experiments require explicit separate build modes and output directories. Prepare the pinned compiler workspace for product extensions; never assume another developer already populated it.
- Public plugin source lives in `packages/`; npm identities and versions remain independent. Follow `docs/PACKAGES.md` for package-scoped checks and publication. Do not replace product npm locks with workspace links or run the retired standalone repository release flows.
- 插件版本只发布 npm，不创建插件 GitHub Release 或 Git tag；发布来源使用已审查的完整提交 SHA。
- Keep tests synthetic. User diagnostic exports, sessions, keys and local machine paths stay outside tracked source.
- Coordinate shared API and package changes before freezing a combination. Public source snapshots, npm publication, local candidate promotion and desktop Releases are separate actions governed by the user's authorization.
- Local Web is a single-machine functional validation environment. Desktop shell and release behavior require their own acceptance work.
- Private collaboration uses private forks/PRs where allowed by organization policy. Do not expose repository secrets to fork code. Desktop Release runs require explicit maintainer authorization; private Release validation does not authorize changing repository visibility or update feeds. Mac work follows docs/MACOS.md and requires native acceptance before claiming support.

- CI 默认只检查源码/依赖、构建与必要的启动冒烟；Release 额外校验 ZIP 完整性。模型会话、OIDC 登录/重启、Office 与音视频全流程由维护者在提交前本地验收，不恢复为每次 CI 的重复门槛。回执只记录实际执行的检查。

- 开源文档面向用户与贡献者。README 只保留项目功能、安装使用和文档入口；内部讨论、工作日志、阶段交接、本地验收流水账与账户操作记录保存在仓库外，不加入公开源码或未发布提交的历史。
