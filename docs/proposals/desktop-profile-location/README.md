# 桌面 Profile 目录

**简体中文** | [English](README_EN.md)

## 改动边界

本 PR 将原生 DSH Profile 的内部名称从 `desktop-017` 规范为 `desktop`，不再绑定 Runtime 版本。原生与旧 Runtime 的启动逻辑均选择 `DSH_HOME/profiles/desktop`。

`DSH_HOME`、`eduwork.jsonc`、examples、会话、附件、浏览器数据和更新状态继续使用原路径。配置暴露范围、构建资源及现有 Skills、插件导入逻辑不变。

## 已实现的行为

`prepareProductProfile(...)` 直接使用 `desktop`，不存在时按现有逻辑初始化。不探测、迁移、合并或删除 `desktop-017`，也不创建 `desktop-legacy`。旧路径不再作为原生 Profile 的加载入口。

已有可用的原生 `desktop` 继续使用。若同名目录来自旧 Runtime，其 `node_modules` 为指向 App 的链接，现有原生 Profile 安全检查会拒绝该链接；需由用户备份并移走冲突目录后启动，不自动覆盖。

## 用户迁移与风险

这是 Profile 路径的破坏性更新：旧原生 Profile 的偏好、用户安装插件及启停状态不会自动带入新 Profile，原文件保留。需要保留这些内容的用户可以让 AI 在完全退出客户端并备份后协助迁移；说明见 [CHANGELOG](../../../CHANGELOG.md)。

迁移应区分旧原生 `desktop-017` 与旧 Runtime `desktop`，不能直接合并不同 Runtime 的依赖目录。自定义插件引用旧 Profile 的绝对路径或文件链接时，需要相应修正。

代码没有目录迁移，因此不再引入迁移改名失败或迁移并发风险。已有旧 Runtime 同名目录仍可能阻止启动，且重装 App 不保证清除用户配置。真实 macOS、Windows 初始化及现有配置冲突验收完成前，PR 保持 Draft。
