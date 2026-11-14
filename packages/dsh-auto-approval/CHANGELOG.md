# 变更记录 / Changelog

## 0.1.0 — Unreleased

- 首个版本：在专门的权限预设下，用固定规则和 SystemOne 兼容的决策模型审查 bash/pwsh 越出沙箱的申请，判断用户会同意的放行一次，其余交给用户确认。
- 审查限时（默认 10 秒），网络错误、429 和 5xx 重试一次，同一会话连续失败 3 次暂停 5 分钟；支持 API Key、可选 OIDC 和免鉴权服务，默认关闭。
- 每个审查的申请随命令结果在轨迹里留一条记录，写明结果和分数；对话模型只得知是自动放行还是问过用户。
- 用户拒绝过越界申请后，到用户发下一条消息之前，不再审查，直接交给用户。
- 文件工具 write、edit、apply_patch 的越界申请也审查：按效果相同的命令或补丁展示，列出每个文件的真实路径和状态；改本次会话之前就有的文件，要模型判断用户要求过才放行。
- 用户在提问卡上的回答算作用户的消息。
- 写入 `~/Library/LaunchAgents` 的登录启动项算改软件配置。
- 输入框旁的权限菜单和权限按钮上，自动审批预设显示图标。
- Initial release: under a dedicated permission preset, review bash/pwsh sandbox escalation requests with fixed rules and a SystemOne-compatible decision model, allowing once what the user would agree to and asking the user otherwise.
- Time-limited review (10 seconds by default), one retry for network errors, 429 and 5xx, and a 5-minute pause after 3 failures in a row in a session; supports API keys, optional OIDC and unauthenticated services; disabled by default.
- Each reviewed request leaves a notice in the trajectory with the outcome and score; the conversation model learns only whether it was allowed automatically or the user was asked.
- After the user rejects an escalation, requests go straight to the user until the user writes again.
- Escalations from the file tools write, edit and apply_patch are reviewed too, shown as the command or patch with the same effect, with each file's real path and state; a change to a file that was there before the session is allowed only when the model judges it requested.
- Answers on question cards count as user messages.
- Writing login items to `~/Library/LaunchAgents` counts as changing software configuration.
- The auto-approval preset shows an icon in the composer's permission menu and on its permission control.
