# 变更记录 / Changelog

## Unreleased

- 修复 iOS / iPadOS 16.4–17.3 上远程界面白屏：配对成功、电脑上也显示已连接，但设备上什么都不显示。远程网页现在会补上这些系统缺少的浏览器功能，DSH 界面也能正常加载。低于 16.4 的系统会提示版本过低，不再白屏。只需更新中继，电脑端不用更新。

- Fix a blank remote interface on iOS / iPadOS 16.4–17.3, where pairing succeeded and the computer showed the device as connected but nothing appeared on it. The remote web page now fills in the browser features these versions lack, so the DSH interface loads as well. Older versions are told the system is too old instead of showing a blank page. Only the relay needs updating; computers do not.

- 修复电脑启用“思考过程机器翻译”后远控页面无法启动的问题；远端翻译沿用电脑已配置的服务与限制，配置仍仅能在电脑上修改。
- Fix remote workbench startup with reasoning machine translation enabled. Remote translation uses the Host's configured service and limits; preferences remain editable only on the computer.

## 0.1.6 — Unreleased

- 兼容 DSH 0.2.2-rc.2；将已验证的 0.2.2 预发布 API 系列纳入有界兼容范围，保留原有受支持的宿主。 适配 Office Kit、搜索 provider、子代理停止及账号通知接口；继续拒绝本机终端和配置管理接口。
- Support DSH 0.2.2-rc.2 and the qualified 0.2.2 prerelease API family while retaining previously supported hosts. Adapt Office Kit, search providers, subagent interruption and account notification RPCs; retain terminal and configuration-management restrictions.
- 补齐新版会话状态与事件、工具结果订阅、文件搜索、会话团队开关、定时任务和 Markdown 导出接口，并以真实 rc.2 网页宿主的接口清单检查允许与拒绝边界。
- Cover new session state/events, tool-result subscriptions, file search, per-session team mode, scheduled tasks and Markdown export. Verify the allow/deny boundary against an actual rc.2 web-host inventory.

## 0.1.5 — 2026-11-07

- 连接在生成配对码时关闭后，及时清理待确认请求。
- Drop a pending approval when the connection closes while its pairing code is being computed.

- 修复 DSH 0.2.2 上手机布局错位：远程设备上侧栏打开后是空白遮罩、左上角出现两套按钮。DSH 0.2.2 已自带手机布局，插件不再覆盖它的布局，只保留远程设备上设置仅可查看的提示。兼容范围改为 DSH 0.2.2-rc.1 及以上，DSH 0.2.1 宿主请继续使用 0.1.4。

- Fix the phone layout on DSH 0.2.2, where a remote device's sidebar opened as an empty mask and the top-left corner showed two sets of buttons. DSH 0.2.2 fits itself to phones, so the plugin no longer overrides its layout and only keeps settings view only on remote devices. The plugin now requires DSH 0.2.2-rc.1 or later; DSH 0.2.1 hosts should keep 0.1.4.

## 0.1.3 — Unreleased

- 兼容声明接纳已验证的 DSH 0.2.2-rc.1 与 Cordis 4.1；保留原有功能、配置及受支持的旧宿主范围。
- Accept qualified DSH 0.2.2-rc.1 and Cordis 4.1 peers, retaining existing behavior, configuration and supported older hosts.

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
