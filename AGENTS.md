# Development guidance

- Release notes 必须先与项目负责人讨论确认，不得自行编写或自动生成。CI 只复制已确认的说明文件。GitHub 桌面 Release 仅发布 Electron；Go/Wails 过渡包在本地构建，经旧更新器验收后走原 OSS 渠道。

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
