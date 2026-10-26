# 临时侧边聊天

**简体中文** | [English](README_EN.md)

从原会话的一条用户消息或已完成的助手回答开启临时侧聊，在原生右侧栏使用同一套聊天组件。侧聊通过标准 seed fork 继承来源历史作为模型上下文，UI 层隐藏继承的消息，只展示侧聊新增的内容。

侧聊关闭后停止会话并丢弃其消息与草稿；切换主会话、收起、隐藏窗口和长时间不活动不会结束会话。刷新或窗口退出时请求关闭；异常终止时残留会话随 Host 退出释放。显式要求改写的工作文件和外部操作不会随关闭撤销。

每个主会话各自保留一个侧聊，切换主会话时恢复对应的消息、草稿和批注。不支持转正、侧聊内再分叉、子代理、定时任务和长期后台工作。工具仍遵守新会话的权限，生成仍遵守全局并发规则。

## 架构

本插件是纯 cordis 插件，不需要 Runtime 补丁或实验构建流水线。

- **Host 端** (`src/index.js` + `src/service.js`)：通过 `agents.create({ seed })` 标准 API 创建 seeded session，`/api/eduwork/side-chat` 管理创建、所有权和关闭
- **客户端** (`src/client/`)：注册侧栏 tab、资源协议、消息操作按钮，通过 DOM 隐藏继承消息
- **边界** (`src/boundary.js`)：system prompt 约束和工具拦截

## 本地开发

```sh
npm ci
npm run build
npm test
```

上述命令在本包目录执行。产品行为见[侧边聊天提案](../../docs/proposals/side-chat/README.md)。
