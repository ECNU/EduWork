---
name: artifact-presentations
description: 使用 DSH 官方 Office 工作流创建、读取、编辑和检查 PowerPoint 演示文稿，支持旧 PPT 转换及 PPTX、PDF 交付。
---

# PowerPoint 演示文稿接入

创作前阅读[共同规范](../shared/references/common.md)和[演示创作规范](../shared/references/presentations.md)，与 Studio 共用内容设计要求。

宿主会在本说明前加载随包的官方 `office-pptx` 流程及真实资源目录。创建、定向编辑、讲者备注、结构检查及渲染均遵循该流程，使用已配置的依赖，不查找或安装另一套运行时。

- 旧 `.ppt` 可通过 `office_presentation` 的 inspect 读取；编辑前先 convert 为新的 `.pptx`。
- 示例：`office_presentation({"action":"convert","input_path":"汇报.ppt","output_path":"汇报-可编辑.pptx"})`；输出路径为 `.pdf` 则从该实际演示文稿导出 PDF。
- 保留讲者备注、页面顺序及未要求修改的内容。检查真正生成的页面，不用重新拼出的 HTML 代替实际 PPTX。
- create/inspect/validate 继续作为 Studio 的确定性模板适配接口；自由设计或编辑现有 PPTX 使用前面的官方工作流。strict 验证仅用于模板回归，不对普通外部文稿强制主题规范。

所有工具路径使用工作区相对路径，输出必须是新文件。复用已有工作区写入授权，拒绝后不换执行路径绕过，也不反复要求“一次允许”或 Full Access。原文件保留，旧 PPT 转换不承诺宏及动画完全保真。普通文件通过 present 展示；Studio 成果使用 knowledge_studio_create_artifact，导出复用官方校验和转换能力。
