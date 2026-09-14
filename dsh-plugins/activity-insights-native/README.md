# DSH 本机使用概览

[English](README_EN.md)

基于 DSH 官方 `sessionQuery` 的本机只读使用概览插件。它提供个人概览页，展示会话数、活跃天数与连续活跃、供应商实际返回的 Token 用量、模型和推理档位、常用工具及 Skills。

## 数据边界

- 在 `$DSH_HOME/derived/activity-insights/v3/` 保存按会话生成的本机统计摘要；摘要只含计数、日期、模型/工具/Skill 名称、DSH 运行耗时及会话 revision/cursor，不含任何对话正文。旧 schema 不兼容时自动重建，不覆盖旧文件。
- 首次打开逐个会话建立摘要并显示真实进度。后续先通过 DSH 标准 `listSnapshots()` 读取轻量 revision：未变化的会话直接复用摘要，变化的会话通过 Session Observation 只折叠 cursor 后的新增事件，并同步读取官方投影。
- 不上传分析数据。
- 不返回对话正文、系统提示词、工具参数、工具结果、文件路径或工作区名称。
- Token 只统计 `assistant/message.data.usage` 中模型服务实际返回的数据，同时显示覆盖率；不会对缺失的历史用量做估算。
- Skills 使用量来自 DSH 标准 `tool/call` 事件：工具名为 `skill`，Skill 名称只从 JSON 参数的 `name` 字段提取。原始工具参数不进入投影缓存，也不通过正文关键词猜测。
- 365 天热力图按容器宽度自适应压缩，今天始终在可见区最右侧，不依赖默认滚动位置。
- 页面采用 Codex 风格的信息层级：头像居中展示，不重复显示已有账户区提供的姓名、机构和连接状态；累计 Token 数、峰值 Token 数、最长聊天时长、当前连续天数和最长连续天数保持同一行，年度热力图包含月份与强度图例。热力图下方只保留一个简洁的使用概览，不再展示常用工具和常用 Skills 排行；底层仍保留无正文统计，便于协议兼容和后续演进。
- “最长聊天时长”复用 DSH 官方 `sessionStats` 投影，按每个会话的 `llmMs + toolMs` 计算模型与工具实际运行时长，不把关闭窗口、隔日续聊或闲置等待计入时长。
- 企业身份中的 `other` 视为后端通用占位符，不作为用户身份文本展示；其他真实身份值保持原样。
- fork / subagent 日志中的继承事件按 `seedLength` 排除，避免重复计数。
- 会话通过 DSH Session Query 的只读 Observation 打开并在折叠后立即释放；持久化 revision 用于跳过未变化的冷会话。整次统计有 30 秒边界，个别不可读取会话会被跳过并在页面说明。

## 组合方式

Host 和 Web UI 在同一包中，既能用于桌面，也能用于纯 Web DSH。插件只硬依赖 `sessionQuery`；存在标准 `sessionPersistence` 时启用持久化增量索引，否则退化为只读 Session Observation。若组合中存在 `enterpriseAccounts` 服务，会在不建立依赖关系的前提下读取当前用户名和机构信息，缺失时显示“本机使用概览”。

```yaml
- insert:
    - id: local-activity-insights
      name: '@chatecnu-work/dsh-activity-insights-native'
```

可选配置：

```yaml
config:
  cacheMs: 60000
  concurrency: 2
  requestTimeoutMs: 30000
  profileTimeoutMs: 3000
  cacheNamespace: my-product
```

`cacheMs` 约束在 10 秒至 10 分钟之间；`concurrency` 约束在 1 至 4 之间；`requestTimeoutMs` 约束在 5 秒至 2 分钟之间；可选企业账号装饰的 `profileTimeoutMs` 约束在 0.5 至 10 秒之间。`cacheNamespace` 用于隔离共用一个 DSH Home 的不同产品装配，仅接受安全的文件名片段。
