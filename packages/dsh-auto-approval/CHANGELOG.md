# 变更记录 / Changelog

## 0.1.0 — Unreleased

- 首个版本：在专门的权限预设下，用固定规则和 SystemOne 兼容的决策模型审查 bash/pwsh 越出沙箱的申请，判断用户会同意的放行一次，其余交给用户确认。
- 审查限时（默认 5 秒），网络错误、429 和 5xx 重试一次，同一会话连续失败 3 次暂停 5 分钟；支持 API Key、可选 OIDC 和免鉴权服务，默认关闭。
- 每个审查的申请随命令结果在轨迹里留一条记录，写明结果和分数；对话模型只得知是自动放行还是问过用户。
- Initial release: under a dedicated permission preset, review bash/pwsh sandbox escalation requests with fixed rules and a SystemOne-compatible decision model, allowing once what the user would agree to and asking the user otherwise.
- Time-limited review (5 seconds by default), one retry for network errors, 429 and 5xx, and a 5-minute pause after 3 failures in a row in a session; supports API keys, optional OIDC and unauthenticated services; disabled by default.
- Each reviewed request leaves a notice in the trajectory with the outcome and score; the conversation model learns only whether it was allowed automatically or the user was asked.
