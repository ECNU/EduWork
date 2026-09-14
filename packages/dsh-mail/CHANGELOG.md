# 变更日志

**简体中文** | [English](CHANGELOG.en.md)

## 0.1.1 - 2026-09-11

- 新增官方 DeepSeek Harness `0.1.5-rc.1` 的精确 peer 支持，并完成 Tool/Agent、Session、Permission Presets、Filesystem、Credentials、Settings 与 Web Client 接缝验收。
- 保持 IMAP 只读、读写能力默认关闭、SMTP 普通权限逐次审批、Full Access 仅免审批、邮箱内容不可信和附件工作区边界不变。
- 将 Nodemailer 更新到 `9.1.0`、Mailparser 更新到 `3.9.23`，修复上游地址解析、域名校验和内容解析安全问题。
- 补齐面向 `0.1.5-rc.1` 的安装、配置、验证、开发和已知限制说明。

## 0.1.0 - 2026-09-06

- 兼容基线更新为 DeepSeek Harness `0.1.2-rc.1`，并保留 Host 导出名、Profile 行 id、settings namespace、安全作用域、凭据引用和附件目录契约。
- 设置页迁移到 DSH Client 的 `settingsScope`，使用原子 mutation、revision fence 和只读状态。
- 设置 Schema 改用与 DSH 基线一致的 `@deepseek-ai/schemastery` `3.18.2`，并移除会掩盖 peer 冲突的 `legacy-peer-deps` 安装配置。
- CI 扩展为 Windows/Linux 与 Node.js 22/24；新增手动发布工作流，默认只检查和打包，并为后续启用 npm Trusted Publishing/OIDC 预留稳定 tag 与同 commit CI 校验。
- 公开文档同步稳定版安全声明、`settingsScope` 架构、单一维护者治理现状和首发 npm CLI + 浏览器 2FA 流程；本次不声明 provenance，Trusted Publishing 作为后续路径。
- npm 包补齐中英文贡献、治理、维护者、支持和行为准则文档，避免 README 的包内相对链接失效。

## 0.1.0-alpha.5 - 2026-09-05

- npm 包身份改为 `@eduwork/dsh-mail`，同步安装路径、组合模块路径与客户端注册。
- 保留 Host 导出名、插件行 id、settings namespace 和安全作用域中的 `dsh-mail-assistant`，保留 `DSH_MAIL_ASSISTANT_PASSWORD` 与 `.dsh-mail-assistant/attachments`；客户端 ModuleLoader 使用新包名。
- 旧无作用域版本保留可安装，并提供 Profile 迁移说明。

- 移除误列为生产依赖的打包时传递依赖；Host 运行库继续完整内嵌在发布产物中。
- Dependabot 只自动提交开发依赖的 minor/patch 更新；major、DSH 兼容基线和 `tsdown` minor 更新改为人工评估。
- Host bundle 检查新增发布清单约束，防止重新引入外部运行时依赖。

## 0.1.0-alpha.4 - 2026-09-01

- 首个公开 npm 预览版。
- 仓库元数据、安装入口、默认中文与英文镜像文档更新为公开地址。
- 增加 GitHub CI、CodeQL、Dependabot、Issue/PR 模板、治理规则和公开发布检查表。
- 新增依赖许可证、文档镜像、链接、敏感信息和 npm 包内容检查。
- Host bundle 内嵌 IMAP/SMTP 运行库，发布包不再要求终端用户重复安装这些依赖。
- 下载附件在本地写入前重新验证真实路径，拒绝由符号链接或目录联接造成的工作区逃逸。

## 0.1.0-alpha.3 - 2026-08-31

- 兼容基线更新到 DeepSeek Harness `0.1.2-alpha.2` 和 `@deepseek-ai/cordis` `4.0.2`。
- `mail_send` 接入 DSH 原生权限预设：普通权限逐次确认，Full Access 在发信能力已单独开启时免确认。
- 增加只读 `mail_list_folders`，允许发现归档目录和服务商自定义目录。
- 增加稳定的 `mail_find` 游标分页、正序/倒序以及 `matched`、`returned`、`hasMore`、`nextCursor`。
- 增加有限且不泄露服务端诊断的 IMAP 错误归一化。

## 0.1.0-alpha.2 - 2026-08-30

- 设置流程调整为邮箱账号、服务器、高级选项和 Agent 权限四部分。
- 保持 alpha.1 的设置 Schema 和 Credential Ref 兼容。

## 0.1.0-alpha.1 - 2026-08-29

- 首个内部预览版。
- 提供 `mail_find`、`mail_read`、`mail_get_attachment` 和 `mail_send`。
- 默认只读 IMAP、DSH Credential 存储、独立读/发开关、工作区附件限制和邮件不可信数据标记。
