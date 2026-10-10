# 桌面 Profile 目录

**简体中文** | [English](README_EN.md)

状态：已实现。macOS、Windows 的配置与全部用户数据统一到主目录下的 `.config/<distribution>/`，公版为 `.config/eduwork/`。原生 Profile 使用不含版本号的 `dsh/profiles/desktop-native`；首次启动复制校验旧数据并保留旧副本，新目录已存在时不自动合并。

路径、迁移与回退边界见[设计说明](../../dev/desktop-user-directory.md)；生效配置见[配置指南](../../CONFIGURATION.md)。两平台真实凭据、重启与更新安装仍需原生验收。
