# 插件通知

[English](README_EN.md)

提供面向业务插件的来源注册、去重、更新、撤回和点击分派。与 Agent 通知共用托盘、系统通知和桌宠展示，不依赖桌宠运行。

EduWork 装配时加载本插件。业务插件用 Cordis 可选注入 `notifications`，前端可选注入 `notificationActions`；没有展示适配器时不宣称桌面投递成功。

接入字段、生命周期、账号隔离和示例见 [插件通知协议](../../docs/PLUGIN_NOTIFICATIONS.md)。不要通过本服务代替 Agent 授权或保存业务数据。
