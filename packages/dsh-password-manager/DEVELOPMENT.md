# 开发指南

## 接入

设置页复用 DSH 的 settings.section 插槽及 Button、Switch 原生组件；设置搜索复用 settings.action。桌面主 frame 的专用 IPC 校验来源，修改操作要求用户激活。设置接口只返回账号元数据和开关，不返回密码。

工具通过 desktopServices 的已认证原生服务接口调用。会话 ID 来自执行上下文，工具响应限制为固定状态。桌面适配在 dsh-electron/src/builtin-password-agent.mjs；密码库、表单识别及保存逻辑复用固定版本 Orca 模块。主体复用关系见 dsh-electron/vendor/orca/UPSTREAM.md。

## 登录

原生代码在不向侧栏 CDP 注册的临时会话中完成填写和 POST 提交。仅允许授权 origin 的请求，启用全局远程调试时拒绝启动。提交后要求整页导航、无密码框且有 Cookie，关闭凭据页后移交 Cookie。返回 session-ready 后仍须核对业务页面的登录状态。

HTTPS 使用系统证书信任，不提供忽略证书错误的选项。普通浏览器页面与同用户操作系统权限不受此隔离机制限制。

## 验证

Node.js 24：`npm ci --ignore-scripts`、`npm run check`。仓库根目录执行 `node --test dsh-electron/tests/builtin-password-agent.test.mjs` 验证授权、取消、撤销及结果净化。真实桌面测试使用独立配置与虚构账号，覆盖保存、搜索、设置开关、自动提交、会话移交及密码不进入工具响应。平台模拟测试不能替代实机验收。
