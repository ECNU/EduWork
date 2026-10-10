# 桌面 Profile 目录

**简体中文** | [English](README_EN.md)

原生 DSH Profile 的内部名称已从 `desktop-017` 规范为 `desktop-native`，不再绑定 Runtime 版本。启动时若新目录不存在而旧目录存在，则在取得客户端单实例锁后整体改名，保留用户偏好、依赖和写入事务日志；新旧目录同时存在时使用新目录，不自动合并。旧 Runtime 的 `profiles/desktop` 保持独立。

本次仅调整内部 Profile 名称。`DSH_HOME`、用户配置文件、会话、附件、浏览器数据和更新状态继续使用原路径，现有导入逻辑不变。实现边界见[设计说明](../../dev/native-profile-name.md)。
