# 可选会话批注

[English](ANNOTATIONS_EN.md)

社区插件 [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation)（MIT）支持选中助手回复、保存多条批注，并随问题发送。

在 EduWork 官方插件管理器选择「添加插件」，填写 `@changfenhuang/dsh-annotation@1.4.11`，安装后按提示重载。插件装入当前用户 Profile，按需启用。

选中文字 →「批注」→ 输入评论并保存 → 输入问题后发送。输入框旁显示待发送批注数量，回复中的 `Annotation N` 对应原文与评论。

停用和卸载使用同一插件管理器。先发送或另存需要保留的待发批注；已发送批注属于会话消息，停用后展示可能恢复为普通文本。

此候选使用 DSH `0.2.0-rc.2` 验证。1.4.11 的按钮位置、消息闪动和重复实例有[开发补丁与回归测试](../third_party/dsh-annotation/README.md)，需单独应用；默认 npm 安装不包含这些修正。修正版桌面验收尚未完成。
