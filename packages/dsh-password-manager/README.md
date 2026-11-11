# 内建密码管理器

[English](README_EN.md)

EduWork 内建浏览器密码库与 Agent 登录的可选开发候选，暂未发布。手动登录成功后提示保存或更新密码，再次访问时选择账号即可填写。凭据由操作系统加密保存在本机。

“启用浏览器密码管理”控制保存提示、填写和 Agent 使用；关闭后保留账号与网站登录状态。已保存账号可按网站或用户名搜索。

在“设置 → 密码管理器”管理账号及“允许 Agent 使用已保存账号”开关。设置顶部搜索“密码”可直接定位。开关默认关闭，开启后首次登录选择账号，同一会话复用授权；关闭开关会取消进行中的 Agent 登录并撤销授权。

Agent 调用 `password_manager`，提供 `action: "login"` 和 HTTPS 登录页 `url`。原生代码在隔离会话中自动填写、提交，关闭凭据页后将 Cookie 移交侧栏。工具只返回固定状态；`session-ready` 表示会话已移交，网站认证结果仍需核对。

首版自动登录支持同源 HTTPS POST 表单、整页导航和 Cookie 会话。MFA、SPA、多步及跨域 SSO 待适配。普通页面仍保留 JavaScript 和调试能力，手动填写的表单值可以被页面脚本读取；保护范围是 Agent 凭据调用链路。

桌面候选以 `EDUWORK_BUILTIN_PASSWORDS=1` 开启。当前验证目标为 Windows；macOS 自动登录入口未开放。开发和验证见[开发指南](DEVELOPMENT.md)。
