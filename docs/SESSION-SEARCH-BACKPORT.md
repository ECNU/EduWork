# 活跃会话落盘与搜索一致性

DSH 0.2.0-rc.2 的 SQLite 搜索会在读取历史会话前后核对持久化快照。活跃会话的内容由内存快照覆盖，但其自动落盘仍会改变持久化 revision，导致无关的历史搜索重新读取，持续写入时最终失败。

桌面装配在复制 npm Runtime 后，通过 `scripts/patch-session-search-runtime.mjs` 回补这一处一致性判断：对观察开始时已活跃的会话，忽略持久化 revision 的变化。仍检查会话集合、头信息、持久化服务绑定及活跃集合；非活跃会话仍要求 revision 一致。没有提高重试次数、改写用户会话或改变 SQLite 模式。

修复对应上游 `packages/session-query/session-query-sqlite/src/index.ts` 的 `_observeStable` / `samePersistenceSnapshots`，在锁定 npm 包的 `lib/index.js` 应用三个对应替换。上游为 MIT 许可，来源与许可保留在原包中。输入 SHA-256 必须匹配审查过的文件；`assembly.json.runtimePatches` 记录补丁标识、包版本及修改前后的 SHA-256。原始 npm 缓存保持不变。

升级内核时先检查上游是否已有等价修复，有则删除此补丁；否则重新审查源差异和测试，不能直接放宽文件校验。此处锁定的是一份需要改写的代码文件，不是插件的兼容版本范围。

验证使用锁定 npm Runtime 和合成会话：

```powershell
$env:EDUWORK_TEST_RUNTIME = '<prepared-runtime-directory>'
node --test scripts/test/session-search-runtime.test.mjs
```

测试直接运行包内查询引擎，包含原版失败对照、跨会话和会话内搜索、冷会话 revision 变化、活跃会话头变化、持久化记录删除及活跃会话退出。桌面候选检查在 Windows/macOS 上运行相同测试。
