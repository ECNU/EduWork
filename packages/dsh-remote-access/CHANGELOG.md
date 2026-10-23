# 变更记录 / Changelog

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
