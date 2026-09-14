# Agent 预设界面适配

[English](README_EN.md)

复用官方预设控制器、预设列表、通用设置和新会话标签。极简模式与创造模式在关闭时仍显示，用户可通过开关启用；实际可用状态由原生 Agent Presets 服务决定。

开关写入 `chatecnu-brand.enabledOptionalPresets`，Host 同步随发行包提供的预设根目录。界面不维护另一套预设执行逻辑。
