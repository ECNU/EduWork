# 图片数量上限、损坏会话隔离与客户端入口容错

DSH 0.2.1-rc.3 在三处会让一个局部问题变成整体不可用：

- **图片数量上限**：LiteLLM 等网关按模型限制单次请求的图片数，超出时返回 `supports at most 10 image inputs; got 11`。pi-ai 把它当作普通错误，含图较多的长会话之后每一轮都失败。
- **损坏的导入会话**：导入的会话如果头部 id 或 cwd 与存储路径不一致，`dsh-session-persistence-jsonl` 抛出普通错误，整个会话目录列不出来，健康的会话也打不开。
- **客户端入口**：网页启动时任一客户端入口激活失败都会让启动整体失败，一个出错的第三方插件就让窗口白屏。

桌面装配在复制 npm Runtime 后，通过 `scripts/patch-runtime-resilience-runtime.mjs` 修改复制品：

| 包 | 文件 | 改动 |
|---|---|---|
| `@deepseek-ai/dsh-llm-pi-ai` | `lib/index.js` | 在 `mapStopReason` 中识别图片数量上限错误，映射为 `IMAGE_OFFLOAD_REQUIRED` 并给出超出张数；随包的 `compaction-image-offload` 据此把最早的图片换成文字占位后重试 |
| `@deepseek-ai/dsh-session-persistence-jsonl` | `lib/index.js` | 三处会话身份校验改抛 `SessionPersistenceCorruptionError`，由已有的目录边界跳过该会话；每个文件只警告一次，说明原文件保留 |
| `@deepseek-ai/dsh-web-frontend` | `dist/assets/index-*.js` | `@deepseek-ai/` 自有入口失败仍让启动失败；其他入口失败时跳过、记录到控制台，并显示可点击关闭的提示 |

每一步都要求包版本为 0.2.1-rc.3，并校验修改前文件的 SHA-256；锚点不唯一时组装失败。pi-ai 同时接受原始文件和经 `prompt_cache_key` 补丁修改后的文件，因此这一步排在其他运行时补丁之后。`assembly.json.runtimePatches` 记录每个文件的补丁标识、版本和修改前后的 SHA-256。原始 npm 缓存保持不变。

**升级内核时必须检查**：上游是否已识别网关的图片数量错误、是否已在会话目录中隔离身份不符的会话、网页启动是否已容忍非自有入口失败。已修复的项删除对应适配和测试；未修复的项重新审查新版文件的锚点后更新版本和哈希，不能放宽文件校验。

验证：

```powershell
$env:EDUWORK_TEST_RUNTIME = '<prepared-runtime-directory>'
node --test scripts/test/runtime-resilience.test.mjs
```

测试确认：图片数量错误映射为卸图重试，其他错误不变；自有入口失败仍拒绝启动，第三方入口失败只提示；原版后端在身份不符的导入会话上列目录失败，修改后健康会话照常列出、只警告一次、原文件字节不变，手动移回正确路径后可正常打开；取消和文件系统错误照常抛出；输入哈希不符或重复修改时拒绝。
