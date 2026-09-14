# Upstream provenance

## DSH 0.1.5-rc.1

官方 Sidebar 可用时，本包不再注册交付文件事件视图。最终文件通过官方
`present` / `deliverables/presented` 显示，Markdown、HTML、PDF、图片和代码
由官方 `ui-sidebar-documentpreview` 处理。本包仅补充 Shared Office 与
音视频预览、产品工具卡片、文件导入和本机打开能力。

下述 0.1.2 派生实现只保留给没有官方 Sidebar 的旧版装配，不能据此在
0.1.5 的配置中禁用官方 `ui-deliverables`。Studio 和对话里的 Office
仍调用同一 Shared 查看器，不二次排版。

## 旧版兼容实现

- Package: `@deepseek-ai/dsh-client-ui-deliverables@0.1.2-rc.1`
- Repository: `https://github.com/deepseek-ai/deepseek-harness`
- Commit: `a66e4702047846cdaa10c66c9d3df3951f5ea70d`
- License: MIT（见 `NOTICE`）

本包派生并替换锁定版本的 DSH 产物展示插件。它完整保留上游从成功
`write`、`edit` 和可变更型 `str_replace_editor` 调用参数提取路径、按 Turn
去重产物、把最终回复中的文件引用绑定到真实产物的语义；产品差异仅限：

1. 重新绑定包身份；
2. 使用带类型图标的文件卡片；
3. 增加预览、打开、在文件夹中显示和复制路径操作；
4. 产品工具可通过 DSH `presentCall.locations` 补充结构化产物事实；
5. 通过桌面 Native 边界提供会话工作区内的右侧预览抽屉；预览打开期间
   以低优先级临时占用官方 `details` 单槽，关闭后注销并恢复官方工具详情；
6. 开发构建的 PPTX 阅读复用 Shared Office 查看器，与 Studio 使用相同
   固定页面、页码和整体缩放；展开阅读属于这一预览边界，不改变正文布局。

本包不修改 DSH checkout，也不从模型文本猜测文件路径。DSH 提供等价的
产物呈现与预览扩展 Slot 后，应删除本派生包并恢复官方插件。
