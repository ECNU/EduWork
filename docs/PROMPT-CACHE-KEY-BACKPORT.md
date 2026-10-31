# 非 OpenAI 端点不发送 prompt_cache_key

DSH 0.2.1-rc.2 和 rc.3 通过 pi-ai 调用 OpenAI 兼容接口。pi-ai 的 Responses 协议（`openai-responses`）只要缓存保留不是 `none` 就会发送 `prompt_cache_key`；Chat Completions 协议在缓存保留为 `long` 且端点被判定为支持长缓存时也会发送。litellm 等网关把请求转发给 GLM、DeepSeek 等后端时不会过滤这个 OpenAI 私有参数，于是每个模型都返回 400：`Unsupported parameter(s): prompt_cache_key`。用户换模型也无效（2026-10-19 用户反馈，`glm-5.3-flash` 等）。

桌面装配在复制 npm Runtime 后，通过 `scripts/patch-prompt-cache-key-runtime.mjs` 修改 `@deepseek-ai/dsh-llm-pi-ai` 的 `lib/index.js`：在 `profileOptions` 里注入 pi-ai 的 `onPayload` 钩子，当 baseUrl 不是 `api.openai.com` 时，从请求体中删除 `prompt_cache_key` 和 `prompt_cache_retention`。如果提供方配置里明确写了 `cacheRetention`，就不注入钩子，完全保留上游行为。其他参数和请求头都不改。

对应上游源码是 `packages/llm/llm-pi-ai/src/adapter.ts` 的 `profileOptions`。输入 SHA-256 必须和审查过的文件一致；`assembly.json.runtimePatches` 会记录补丁标识、包版本以及修改前后的 SHA-256。原始 npm 缓存保持不变。

**升级内核时必须检查**：上游 deepseek-harness 或 pi-ai 是否已经不再向非 OpenAI 端点发送 `prompt_cache_key`（看 pi-ai `dist/api/openai-responses.js` 和 `openai-completions.js` 里组装 `prompt_cache_key` 的条件，以及 adapter 有没有类似过滤）。如果上游已修复，删除此补丁、测试和工作流条目；如果没有，重新审查新版 `lib/index.js` 的补丁位置后更新哈希和 `reviewedVersions`，不能直接放宽文件校验。也可以考虑给上游提 PR。

验证：

```powershell
$env:EDUWORK_TEST_RUNTIME = '<prepared-runtime-directory>'
node --test scripts/test/prompt-cache-key-runtime.test.mjs
```

测试确认：输入哈希不符时拒绝修改；不会重复打补丁；原始 npm 文件没有被改动；非 OpenAI 端点会删除这两个参数；OpenAI 端点、本来就不带这个参数的请求、以及明确配置了 `cacheRetention` 的提供方都保持原样。
