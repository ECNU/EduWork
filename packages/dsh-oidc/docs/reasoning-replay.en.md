# Reasoning replay compatibility

**English** | [简体中文](reasoning-replay.md)

DeepSeek Chat Completions requires the complete `reasoning_content` when tools are supplied in thinking mode; see the [official guide](https://api-docs.deepseek.com/guides/thinking_mode/). This is not a universal OpenAI-compatible field convention. The adapter follows each model's `compat.requiresReasoningContentOnAssistantMessages` setting.

pi-ai 0.85.1 preserves the original response field in replay metadata. A response using `reasoning` or `reasoning_text` is replayed under that alias. If the model also requires `reasoning_content`, pi-ai adds an empty canonical field. A strict gateway treating these fields as aliases can reject the pair with `duplicate field reasoning`. Retrying unchanged history repeats the conflict.

For affected models, the shared enterprise adapter normalizes those two plain-text aliases to `reasoning_content` before dispatch, preserving the full text. It does not clear reasoning or disable thinking. Only matching provider/model messages with version-2 pi-ai Chat Completions replay metadata are changed in the outgoing copy. Stored sessions, other API signatures and structured encrypted reasoning are untouched. Models explicitly disabling the compatibility requirement retain their original fields.

`test/provider.test.js` checks synthetic history through real pi-ai HTTP serialization, all three field spellings, immutable history, route/API boundaries, and the unmodified adapter's conflicting baseline. No institution account or real model request is required.

This fix belongs to the plugin source. A product must consume a new plugin package containing it; UI/configuration changes or unchanged npm locks do not upgrade an installed adapter. Follow the plugin publication process and update product dependency locks before shipping. Never overwrite published packages or rewrite user session files.
