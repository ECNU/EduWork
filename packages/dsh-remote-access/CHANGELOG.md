# 变更记录 / Changelog

## 0.1.2 — 2026-10-26

- 修复运行中安装或启用远控插件后，远端无法保存预览版说明确认状态的问题。
- 设置页支持机构账号与自建中继切换、机构登录、连接测试和重试；添加设备入口始终显示，并说明不可用原因。
- 机构鉴权被拒绝时显示通用排错提示，不再将所有失败都关联到固定的电脑数量上限。

- Fix saving the preview notice acknowledgment remotely after installing or enabling the plugin while DSH is running.
- Add organization/account and self-hosted relay selection, organization sign-in, connection testing and retry actions. Keep the add-device entry visible with an explanation when unavailable.
- Show general recovery guidance for rejected organization authentication instead of associating every failure with a fixed computer limit.

## 0.1.1 — 2026-10-24

- 随 npm 包提供中英文自托管中继部署指南：固定版本启动、Key、HTTPS/Nginx、路径前缀、systemd、OIDC、iframe 与排错。
- 澄清同源集成的信任范围，以及直接终端接口与 Agent 权限的区别；运行代码与协议不变。

- Include bilingual relay deployment guides covering pinned npm startup, access keys, HTTPS/Nginx, path prefixes, systemd, OIDC, iframe integration and troubleshooting.
- Clarify same-origin trust boundaries and direct terminal APIs versus Agent permissions; runtime code and protocol are unchanged.

## 0.1.0 — 2026-10-23

- 首个版本：在手机或其他电脑的浏览器中使用本机的 DSH，包含 DSH 插件与设置页、可自托管的中继和网页客户端。
- 连接端到端加密；新设备须在电脑上核对配对码并允许，可逐台移除。
- 远程设备可查看与新建会话、继续或停止任务、审批与回答提问、预览与下载成果；设置只能查看，账号、凭据、插件管理等仅限本机。
- 手机上沿用 DSH 自己的界面，按窄屏调整侧栏与设置弹窗。
- 中继可凭机构登录的 ID Token 或接入密钥接纳电脑，并限制每个账号的电脑数和连接频率；发行版可预置机构的中继，用户登录后即可使用。
- 支持带路径前缀的中继地址；通过 `RELAY_FRAME_ANCESTORS` 配置允许嵌入的门户来源，默认禁止嵌入。
- 随包提供协议文档；Node.js 最低版本为 24.22.1，与部署说明中的安全更新基线一致。

- First version: use DSH on this computer from a browser on a phone or another computer, with the DSH plugin and its settings page, a self-hostable relay and the web client.
- Connections are end-to-end encrypted; a new device must be allowed on the computer after checking its pairing code, and devices can be removed one by one.
- Remote devices can view and start sessions, continue or stop tasks, approve and answer questions, and preview and download results; settings are view only, and accounts, credentials and plugin management stay on the computer.
- Phones get DSH's own interface, with the sidebar and the settings dialog fitted to narrow screens.
- The relay admits computers by an organization's ID Token or by an access key, and limits computers per account and connection rates; a distribution can preset its organization's relay, ready once the user signs in.
- Relay URLs support path prefixes; `RELAY_FRAME_ANCESTORS` configures which portals may embed the page, with embedding denied by default.
- Includes the protocol documentation; requires Node.js 24.22.1 or newer, matching the security update baseline in the deployment guide.
