# 思考内容回传兼容

**简体中文** | [English](reasoning-replay.en.md)

DeepSeek Chat Completions 的思考模式在请求带有工具时要求完整回传 `reasoning_content`，见[官方说明](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/)。这不是所有 OpenAI 兼容服务共同遵循的字段约定，插件按模型的 `compat.requiresReasoningContentOnAssistantMessages` 配置决定是否采用这一规则。

## 修复的情况

pi-ai 0.85.1 会把服务端响应中的原始字段名记录为 replay metadata。某次响应使用 `reasoning` 或 `reasoning_text` 时，历史回传会继续使用该别名；若模型又要求 `reasoning_content`，pi-ai 会补入一个空的 `reasoning_content`。将这些字段视为同义词的严格网关因此可能报告 `duplicate field reasoning`。重试相同历史仍会生成冲突请求。

公共企业适配层在发送前将这两种纯文本别名统一为 `reasoning_content`，完整保留思考文本，不靠清空内容或关闭思考模式规避问题。只转换当前 provider/model 的、版本为 2 的 pi-ai Chat Completions replay metadata；不修改持久会话，不转换其他 API 的签名或结构化加密思考数据。显式关闭该兼容项的模型继续使用原有字段。

## 验证与交付

`test/provider.test.js` 包含合成消息与真实 pi-ai HTTP 编码检查：三种响应字段、旧历史不可变、不同模型/API 的范围限制，以及未修复适配器同时发出两个字段的基线。测试不需要机构账号，不向真实模型上传对话。

该修复在插件源码中维护。产品必须使用包含修复的新插件包后才能生效；只修改产品 UI 或配置文件、只更新本地源码、沿用旧 npm 锁，均不会自动更新已安装客户端。发布前需要按独立插件版本流程同步 npm 包和产品依赖锁，不改写已发布包，也不修改用户会话文件。
