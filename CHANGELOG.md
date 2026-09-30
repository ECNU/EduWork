# 变更记录

本文件记录构建脚本的开发变更；正式发行说明仍按发行流程另行确认。

## 2026-09-30 — 跨平台构建脚本与 Windows 验收

- 本地提交 `86d767b` 曾将 Web 装配、桌面输入、Electron 壳和打包脚本从 PowerShell 移植到 Node.js，新增共享构建工具和一键本地流水线；当时 Windows 链路尚未实机验证。远端 `feat/cross-platform-build-scripts` 已继续实现该迁移，本地分支现以远端提交 `7562b401` 为基线，舍弃了该本地提交的代码差异。
- Windows 实机 SOP 修复了 Visual Studio DLL 签名校验的参数传递和 Windows PowerShell 模块路径、原生输入安装的两处 JSON 处理错误，以及 PNG 格式 ICO 在 Windows PowerShell 5.1 下的图标校验误报。
- 修正打包验收回执，使 `asset.name` 记录实际 ZIP 文件名。开发包在 Windows x64 上完成 Web、原生资源、Host、Electron、便携 ZIP、解压校验和桌面启动冒烟。由于上述修复仍在工作树中，本次构建回执的 `sourceSnapshotVerified` 为 `false`。
- 后续按要求将 Windows Node 构建链剩余的 PowerShell 调用换成 `.mjs`：用锁定的 `resedit` 写入并校验 Electron 图标、更新器和解包器的 PE 资源；用 Windows SDK `signtool.exe` 校验微软 DLL 签名；公开版解包器的构建、ZIP 封装和验收改由 `portable-extractor.mjs` 执行。Windows 开发版和公开版 GitHub 构建入口、构建说明也改为调用 `.mjs`。
- 本轮仅做针对性验证：Electron 图标写入、更新器 manifest 写入及只读验证、微软签名和版本读取均在 Windows 本机通过；相关 `.mjs` 语法检查、源码审计及 ZIP 工具的读写探针通过。**替换后未重跑完整 SOP；公开版解包器尚未完成干净检出下的端到端验收。**此前已通过的开发包在仓库同级的 `eduwork-windows-sop-20260930-retry/publish/`，该包早于本轮 PE 资源脚本替换，不代表本轮新代码的完整构建结果。
