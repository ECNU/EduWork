# 兼容性与已知限制

**简体中文** | [English](compatibility.en.md)

`@eduwork/dsh-mail@0.1.1` 面向官方 DeepSeek Harness `0.1.5-rc.1`，同时保留已验收旧基线的精确 peer 范围。旧无作用域包迁移见[迁移说明](EDUWORK-MIGRATION.md)。

## 已验证基线

- DeepSeek Harness `0.1.5-rc.1`（当前发布基线）；
- DeepSeek Harness `0.1.2-rc.1`、`0.1.3-alpha.1`、`0.1.3-alpha.2`、`0.1.5-alpha.1`（保留兼容的历史验收基线）；
- Node.js 22+；
- Web Client 动态 Bundle；
- 本地 Host 文件系统；
- IMAP4rev1/IMAP4rev2 服务器与 SMTP Submission 服务的用户名 + 密码/应用密码认证。

插件依赖 DSH Profile 提供 `settings`、`credentials`、`tools`、`permissionPresets`、`approval` 和 `fs`。设置页还依赖官方 Web Client 的 Remotes、Renderer 与 Settings 插槽；普通权限下发信需要交互式审批通路，Full Access 下不会弹出审批。

DSH `0.1.5-rc.1` 要求插件从工具执行上下文显式使用 Agent。Mail 从每次执行的 `exec.agent` 读取当前会话，通过 `agent.session` 获取权限预设和工作区，不依赖全局 Agent，不创建或恢复 Session，也不使用普通 subprocess handle。ToolRuntime、Permission Presets、Credentials、Settings、Renderer 和 Settings Client 接缝均已验收。

官方通用文件上传、Workspace Files 和 `readByteRange()` 可供后续大附件体验复用，但当前不能替代 IMAP 下载所需的 Host 二进制写入：`ctx.fs` 仍没有 `writeBytes()`。因此本版本继续保留受工作区约束、重新校验真实路径并使用独占随机文件名的本地下载适配。

## 协议范围

- IMAP 遵循只读 mailbox 语义，并用 UIDVALIDITY 防止陈旧 UID 误读。
- SMTP 支持隐式 TLS 和 STARTTLS，不支持明文连接。
- 当前不实现 XOAUTH2/OIDC 邮箱登录。Gmail、Microsoft 365 等是否可用取决于租户是否仍允许应用密码或相应 SMTP AUTH。
- 不向 IMAP Sent folder 追加副本；是否保存“已发送”由 SMTP 服务端策略决定。
- 复杂 S/MIME、PGP、日历邀请和嵌套 `message/rfc822` 只作为普通 MIME 数据处理，不承诺专用语义。

## DSH 二进制写限制

当前发布基线 DSH `0.1.5-rc.1` 提供 `readBytes`，没有 `writeBytes`。因此：

- 发送本地附件可完整复用官方 seam；
- 下载附件只能在 `ctx.fs.processPath()` 与 Host Node 进程指向同一文件系统时工作；插件会在创建目录后解析真实路径并再次验证工作区包含关系；
- E2B、远程容器或其他不共享 Host 路径的 FS Provider 应禁用或预期 `mail_get_attachment` 明确失败；
- 官方增加二进制写 API 后，本插件应优先迁移并删除本地写适配。

## 版本策略

插件独立使用 SemVer，不跟随宿主产品版本。兼容性修复和依赖维护使用 patch，向后兼容能力使用 minor，破坏工具或配置契约才使用 major。在 DSH `0.x` 阶段，每次升级都先运行 `npm run check` 与目标 Runtime 验收，再在隔离 Profile 中完成 IMAP/SMTP 互操作，不应只依赖编译通过。
