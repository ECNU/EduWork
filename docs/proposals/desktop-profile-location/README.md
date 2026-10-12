# 桌面 Profile 目录提案

**简体中文** | [English](README_EN.md)

状态：未完成。本 PR 发现目录命名与存放位置的问题，留待独立 PR 设计和实现；本 PR 不修改 Profile 路径或迁移用户数据。

当前 Electron 启动器将 `DSH_HOME` 设为发行版数据目录，原生 DSH Profile 固定写入 `DSH_HOME/profiles/desktop-017`。macOS 数据位于用户的 Application Support，Windows 便携版数据位于安装目录的 `data` 下。

后续需明确 Profile 与用户可编辑配置的边界，核对 DSH 对 `DSH_HOME` 的路径要求，并设计旧安装的迁移和回退。仅改目录名会使已有设置和状态无法读取。
