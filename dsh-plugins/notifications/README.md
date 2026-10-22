# 插件通知

[English](README_EN.md)

提供面向业务插件的来源注册、去重、更新、撤回和点击分派。与 Agent 通知共用托盘、系统通知和桌宠展示，不依赖桌宠运行。

EduWork 装配时加载本插件。业务插件用 Cordis 可选注入 `notifications`，前端可选注入 `notificationActions`；没有展示适配器时不宣称桌面投递成功。

接入字段、生命周期、账号隔离和示例见 [插件通知协议](../../docs/PLUGIN_NOTIFICATIONS.md)。不要通过本服务代替 Agent 授权或保存业务数据。

每个插件来源使用独立的有界 FIFO 队列；同一来源的账号共享容量，溢出不影响 Agent 或其他来源，也不改变业务数据。Windows 继续使用托盘气泡，Toast 接入随安装方式改造推进。容量、并发调用和平台点击限制见协议文档。
