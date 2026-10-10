# 桌面 Profile 目录

**简体中文** | [English](README_EN.md)

原生 DSH Profile 从 `DSH_HOME/profiles/desktop-017` 改为 `DSH_HOME/profiles/desktop`，不再绑定 Runtime 版本。不自动迁移或删除旧目录；需要保留旧偏好和插件时，可在退出客户端并备份后让 AI 协助迁移。已有旧 Runtime 的同名目录需先备份移走，避免复用其指向 App 的依赖链接。

本次只调整内部 Profile 名称，其他配置和数据路径、构建资源及插件导入逻辑不变。
