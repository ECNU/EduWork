# 原生 Profile 目录名规范化

`prepareProductProfile(...)` 为原生 Runtime 使用 `DSH_HOME/profiles/desktop-native`，旧 Runtime 继续使用 `DSH_HOME/profiles/desktop`。

启动器已在准备 Profile 前取得单实例锁；通过发行版数据目录归属及路径边界校验后，若新目录不存在且 `desktop-017` 是归属当前 home 的普通目录，则整体原子改名。迁移保留 Profile 内的用户配置、依赖、插件启停、生成配置及未完成写入日志，由现有 Profile 准备逻辑继续处理。

新目录存在时不迁移或合并旧目录；旧目录链接、非目录或越界路径直接报错。其他用户配置和数据目录、Skills/插件导入、构建与更新机制均不调整。

旧版原生客户端仍使用 `desktop-017`；若需要回退该客户端，应完全退出后将 Profile 改回旧名，不自动双向同步两份 Profile。
