# Windows installed 数据布局：手动导入与恢复

本文适用于开发实验构建，不是正式安装器或发布说明。installed 布局仍使用 `sourceSnapshotVerified=false` 的实验包，不能作为发布候选。当前没有标准安装器、旧 ZIP 更新桥接、开始菜单/注册表登记或真实卸载器；这些能力在后续 D/E 阶段单独交付。

## 目录

- [布局](#布局)
- [导入前检查](#导入前检查)
- [手动导入](#手动导入)
- [中断与恢复](#中断与恢复)
- [当前边界](#当前边界)

## 布局

installed 模式把程序和用户数据分开：

```text
P  程序根，例如 C:\Program Files\EduWork
W  可写根，默认 %LOCALAPPDATA%\EduWork\eduwork
   W\config       用户配置
   W\data         会话、附件、浏览器凭据、日志和更新状态
```

P 里的 `resources/`、`RELEASE-MANIFEST.json` 和 `config/` 只作为程序资源或模板。迁移成功后，旧便携程序被移到同卷的 `program.handoff-<uuid>`，原路径不再存在；新客户端从 P 启动，读写 W。

## 导入前检查

1. 确认 P 和 W 不重叠，W 必须位于 `%LOCALAPPDATA%` 下的独立目录。
2. 退出旧客户端及其 Host：Electron 主程序、`EduWork-Updater.exe` 和 `resources/runtime/node.exe` 都会阻止迁移。
3. 先备份旧便携目录。迁移会移动旧程序目录，且不会自动把已经写入 W 的新数据回滚。
4. 旧程序中的内部工作区（例如 `P\workspace-internal`）目前会被安全拒绝；外部工作区路径按原样保留。
5. 目标 W 必须是新目录或空目录，并且必须等于客户端普通启动读取的默认 W（`%LOCALAPPDATA%\EduWork\<distribution>`）。已有用户数据的 W 不会被覆盖或合并；默认 W 冲突时停止并人工处理，不能改用一个客户端不会读取的目录继续导入。隔离实验若使用自定义 W，客户端测试必须同时设置 `EDUWORK_DESKTOP_TEST_DATA_ROOT`；这只是测试覆盖变量，不是用户配置。

## 手动导入

先执行 dry-run，确认来源、目标、W、文件数、跳过项和空间预检：

```powershell
node dsh-electron/scripts/migrate-portable-to-installed.mjs `
  --source "D:\old\EduWork\program" `
  --target-root "C:\Apps\EduWork" `
  --writable-root "$env:LOCALAPPDATA\EduWork\eduwork" `
  --dry-run
```

确认后去掉 `--dry-run`：

```powershell
node dsh-electron/scripts/migrate-portable-to-installed.mjs `
  --source "D:\old\EduWork\program" `
  --target-root "C:\Apps\EduWork" `
  --writable-root "$env:LOCALAPPDATA\EduWork\eduwork"
```

命令只使用这三个路径；不要先启动 installed 客户端让它创建空 W，否则该 W 会被当作已有目标而拒绝。`--writable-root` 必须等于客户端普通启动实际读取的 W，默认是 `%LOCALAPPDATA%\EduWork\<distribution>`（公版为 `eduwork`）。迁移器只使用这个目标，不会修改客户端的数据根配置；换一个目录导入不会让普通客户端改读新目录。迁移会：

- 取得来源和目标 W 的互斥量；
- 校验来源和目标身份、旧进程、更新事务、内部工作区和空间；
- 把来源原子移到同卷 handoff；
- 复制到目标卷 staging，逐文件校验 SHA-256；
- 原子激活 W 并写回执；旧来源保留在 handoff。

成功时回执 `.eduwork-migration-receipt.json` 的 `state` 为 `activated`；完成客户端验收后才可能更新为 `verified`。回执记录来源 handoff、文件哈希和跳过项，不能删除或手工改写。

## 中断与恢复

- 进程崩溃、复制失败或校验失败后，不要删除 `.handoff.json`、handoff 目录或 staging。
- 用完全相同的三个路径重跑原命令；迁移器会读取 journal 并恢复或继续。`--dry-run` 只返回恢复计划，不修改文件。
- 如果恢复因 `EBUSY` 失败，说明仍有进程占用 handoff 路径（通常是旧客户端或 Host）。关闭所有旧客户端和 Host 后重试；此时 W 不会创建，journal/handoff 会保留为恢复依据。
- 如果 W 已经激活而来源仍在 handoff，说明迁移已提交；不要把旧路径当作当前数据，也不要覆盖 W。按回执中的 `source.handoffRoot` 保留来源。
- 如果目标 W 已有数据，迁移会拒绝而不是覆盖。此时应停止并人工处理：确认该 W 是否就是客户端会读取的数据根，备份后决定保留、移走或合并哪一份；不要仅改用一个客户端不会读取的新目录继续导入。

## 当前边界

- 仅验证官方 0.4.9 便携源到开发 installed 包的跨构建迁移；不是同版本安装包之间的升级。普通 installed 启动固定读取默认 W；自定义 W 只用于隔离测试（`EDUWORK_DESKTOP_TEST_DATA_ROOT`）。
- 外部工作区路径保留；内部工作区迁出和引用重写未实现。
- 真实 Host 的 OS 级退出超时/挂起、完整旧 UI 从 handoff 路径重启未验收；已用同 runtime Host 和原路径启动失败做替代场景。
- 标准安装器、旧 ZIP 更新桥接、真实卸载器/快捷方式/注册表、Toast 未实现；当前只有命令行手动导入。
- 真实登录、真实模型、官方插件管理器安装/移除和 TXT 附件内容打开不在本步骤范围内。
