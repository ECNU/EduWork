# 独立开发与配置

从本模块的 manifest 和依赖锁准备开发环境。测试使用隔离目录和合成数据。

## 干净安装

在新 checkout 的 `EduWork/packages/dsh-memory` 中使用 Node.js 22.13+，不要复制旧 node_modules，也不要设置 MEMORY_RUNTIME 指向其他安装。依次运行：

```sh
npm ci
npm run build
npm test
node scripts/check-session-contract.mjs .
node scripts/check-prompt-contract.mjs .
node scripts/check-query-contract.mjs .
```

本仓没有 `check` npm script；上面三项是 Session 授权/来源、系统提示词、历史检索契约检查。锁文件属于开发环境，不随 npm 包发布；使用者的 DSH Host 仍须满足 package.json 的精确 peer 版本。

完整打包、Host、Web 和依赖审计验证：

```sh
npx playwright install chromium
npm run verify
```

已有 Edge 时可在 PowerShell 设置 `$env:MEMORY_BROWSER_CHANNEL='msedge'`，不必下载 Chromium。验证仅操作 artifacts 下的合成 Profile，不调用真实模型。`verify` 会生成同版本 tgz；已有冻结包时必须在另一个 checkout 执行，避免覆盖。产物报告位于 `artifacts/verification.json`。

另有已准备好的 DSH Runtime 时，使用 `npm run verify:runtime -- <runtime-root>`。该路径应包含 package.json 和 node_modules。脚本仅链接读取 Runtime，在新的 stage 中验证实际解析路径，构建工具来自当前 checkout。此流程与干净 npm ci 是两项不同证据，不能互相替代。

## macOS 验证计划

Memory 包本身是 JavaScript，不携带 .node 动态库。DSH 0.1.5-rc.1 的 storage-sqlite 和 session-query-sqlite 均使用 Node 内置 `node:sqlite`，不是独立 better-sqlite3 扩展，因此这条存储路径没有额外的插件原生 ABI 重编译步骤。仍须使用包含 node:sqlite/FTS5 的受支持 Node Host，不能据此推断任意 Electron 内嵌 Node 都兼容。

macOS 尚未实测。发布 mac 产品前应分别验证 arm64/x64 的原生 Node 与 npm ci、SQLite 建库/重开/FTS5、上述三个契约、Host/Web、用户目录路径及权限。不要复制 Windows node_modules；完整 DSH 中的 PTY、FFI 等原生依赖由主产品另外核对架构、签名及打包，不属于 Memory 存储后端的通过证据。

## 配置片段

先通过 README 的安装命令启用插件 bundle。若要在所选 Profile 的 Cordis patch 中覆盖已有 Memory 实例配置，可使用以下片段（不要重复 insert）：

```yaml
- id: local-memory
  config:
    enabled: true
    use_memories: true
    generate_memories: true
    search_prior_chats: true
    disable_on_external_context: true
    max_records: 400
    max_unused_days: 30
```

实例 ID 必须匹配现有组合；上例是独立 bundle 的默认 ID。已有用户设置可能覆盖初始插件配置，应通过“设置 → 个性化”和 `/memories` 核对实际状态。安装/组合修改后运行 `dsh --profile web --dump-config` 并重启所选 Profile。

`disable_on_external_context: true` 表示默认不从工具辅助聊天自动生成记忆，不代表禁止来源引用。明确用户请求仍受整体/会话授权策略约束。容量 16–10,000；保留记录及 importance=3 记录免于自动淘汰，全部受保护时新增失败。

存储路径与域路由见根目录 cordis.patch.yml。不要为迁移随意更改域名、实例 ID 或数据库路径。Memory 导出不包含原始聊天及遗忘标记；插件不负责整体用户目录迁移，也不加密数据库。检索内容可能随当前模型上下文发送给所选服务商。有关限制见 README 和 SECURITY.md。
