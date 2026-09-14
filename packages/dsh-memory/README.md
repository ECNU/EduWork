# DSH Memory

包名：`@eduwork/dsh-memory`。基于 DSH 原生插件机制的本地记忆与跨会话检索，支持 Web 和桌面组合，机构无关。[English](README_EN.md)

- 在任务之间保留有用背景，按需检索过往对话。
- 在设置中查看、编辑、保留或删除记忆。
- 记忆保存在本机，可独立导入和导出。

## 安装

版本 **0.1.1** 要求 Node.js 22.13+，目标基底为 DSH `0.1.5-rc.1`；Host 的 DSH 包必须版本一致，不能混入 alpha 或旧 rc。插件稳定版本号不代表上游已脱离 rc。安装精确版本：

```sh
dsh plugin --profile web add @eduwork/dsh-memory@0.1.1
dsh --profile web --dump-config
dsh --profile web
```

旧版 `@eduwork/dsh-memory@0.1.0` 对应 DSH `0.1.2-rc.1`，安装 0.1.1 前须先升级 Host，不要在同一 Profile 同时加载两个版本。包中包含预构建客户端、Host、TYPERT 和 bundle，用户无需编译。安装后重启相应 Profile。

## 使用

“设置 → 个性化”提供整体开关和过往对话检索开关，二者默认开启。工具辅助聊天自动写入默认关闭，明确要求记住的事实仍可保留来源引用。管理弹窗每页 10 条，支持搜索、修改、保留、普通删除和“遗忘且不再自动记住”。单条删除/遗忘可在 Host 未重启的 30 秒内撤销。

默认最多 400 条语义记忆（可配置为 16–10,000）；新增时可自动清理 30 天未使用的普通记录，容量满时按重要性、使用次数和时间淘汰。用户保留和模型关键记忆不参与自动淘汰；全部受保护时拒绝新增。遗忘标记仅存哈希，当前无总量上限，改写较大的同义事实仍可能绕过词法匹配。

保存/检索由当前模型按需调用工具完成。本版没有独立后台提炼与 consolidation 作业。跨会话检索复用 DSH 官方 Session Query / SQLite FTS5，原始会话仍由官方 JSONL 保存。

支持命令 `/memories on|off|reset` 和 `/memories use|generate|search on|off|inherit`；工具为 `memory_remember`、`memory_recall`、`memory_forget`、`memory_search_threads`、`memory_open_thread`。管理界面支持单次编辑撤销；删除全部记忆不可撤销，也会移除遗忘标记，但不删除原始会话。

## 数据与升级

保留 `local_memory` 域 v1、`records/session_policies/tombstones` 三表、`memories` 设置、`localMemories` 服务及 `memory.sqlite3/session-query-memory.sqlite3` 文件名。导出为 `dsh-local-memory` v2，含语义正文、来源及用户保留状态，不含原始 Session 或遗忘标记，因此导入不会转移防止重新记住的名单。导入上限为 8 MB / 10,000 行，并受记忆容量限制。

升级已有 Memory 安装时先备份数据，使用同一 DSH_HOME/数据库路径，并替换旧包实例，不要新旧包同时加载。已有桌面组合已声明存储和插件行时只更新其包名，不重复叠加新 bundle。

保留既有实例 ID（独立 bundle 为 `local-memory` / `local-memory-sqlite`）；npm 包名不属于 SQLite 存储单元标识。公开导出保留 `./core`、`./spec`、`./typert`、`./remote`、`./client` 和 `./package.json`。

语义检索采用支持中日韩文本的词法匹配及近期性、重要性、使用次数信号。历史检索返回带 `dsh-session:` 引用的有界摘录，不返回全部会话库。

DSH Session V3 与 Memory 域和导出版本相互独立。旧会话读取和受支持的日志迁移由官方 DSH 负责；本插件不改写原始会话文件，也不提供用户目录整体导入流程。

## 开发与发布

`npm ci` → `npm run build` → `npm test`。构建不依赖主产品仓库、私有 wrapper 或上游源码 checkout。独立 Host/Web 验证使用被忽略的 `artifacts/` 下的新建 Profile，不使用日常 DSH_HOME。

`npm run verify` 验证实际打包产物。可先运行 `npx playwright install chromium` 安装测试浏览器；使用已安装 Edge 时设置 `MEMORY_BROWSER_CHANNEL=msedge`（PowerShell：`$env:MEMORY_BROWSER_CHANNEL='msedge'`）。使用单独准备的 Runtime 时，运行 `npm run verify:runtime -- <runtime-root>`，在独立 stage 验证依赖解析并执行完整验证及三项契约检查，不修改共享 Runtime。仅设置 `MEMORY_RUNTIME` 不会重定向所有测试的静态导入。报告记录真实 Host 版本，测试仅用合成数据；依赖审计范围是本仓开发锁，不替代外部 Runtime 审计。干净安装检查及配置示例见 [开发说明](docs/development.md)。

模块构建与 npm 发布通过 EduWork 的统一工作流管理，详见[包维护说明](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES.md)。

MIT；见 LICENSE、NOTICE 与 SECURITY.md。

源码、Issue 与 PR 统一在 [EduWork](https://github.com/ecnu/EduWork/tree/main/packages/dsh-memory)。开发命令在 `EduWork/packages/dsh-memory` 中执行，npm 安装保持独立；发布流程见[包维护说明](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES.md)。
