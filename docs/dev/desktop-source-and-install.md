# 桌面源码身份与本地安装边界

## 源码与工作区

`sourceFileSet(root)` 按源码审计的目录排除规则返回实际文件路径与内容哈希，冻结 receipt 自身单独计入身份。

`desktopSourceIdentity({ coreRoot, editionRoot })` 返回公版与机构版的提交、实际源码文件集哈希及 receipt 哈希。

两端 orchestrator 在进入工作区前计算身份，将其写入 checkpoint 参数与构建回执；同一工作区只能继续构建相同提交和源码。`Workspace.enter()` 遇到身份变化或旧 checkpoint 缺失身份时返回 `EDUWORK_SOURCE_CHANGED`，由调用者选择新工作区，避免清理父产物后误复用子阶段。

`verifySnapshot` 显式传入 pinned-source 审计阶段；开发工作树模式保留源码审计，省略 receipt 一致性校验，并记录 `sourceSnapshot: not-run-working-tree`。非开发候选禁止关闭快照校验。

## 应用名称与安装

`desktopApplicationName({ edition, platform, sourceAlpha })` 提供打包与本地安装共享的应用名称。

macOS 打包回执记录 `applicationName`，启动验收、DMG 生成及本地安装消费同一名称；开发版保留 `Alpha.app` 后缀。

`installPreparedApplication({ staging, installRoot, applicationName })` 将已解压应用移动到不存在的安装目标。

安装只消费已验收归档，先核对归档哈希、实际应用名称和目标是否存在，再移动应用；保留已有安装，不修改正式发布、签名或更新策略。
