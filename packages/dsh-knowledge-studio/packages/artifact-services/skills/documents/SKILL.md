---
name: artifact-documents
description: 使用 DSH 官方 Office 工作流创建、读取、编辑和检查 Word 文档，支持旧版 DOC 转换及 DOCX、PDF 交付。报告、通知、方案、会议纪要和表格均适用。
---

# Word 文档接入

创作前阅读[共同规范](../shared/references/common.md)和[文档创作规范](../shared/references/documents.md)，与 Studio 共用内容设计要求。

宿主会在本说明前加载随包的官方 `office-docx` 完整流程及其真实资源目录。按官方流程使用已配置的 Python、python-docx、校验脚本和 LibreOffice Kit；不再将文档创作局限于固定 JSON 模板。若宿主没有提供官方流程，仍可使用下述确定性工具；缺失的转换能力应如实报告，不查找或安装替代运行时。

## 旧版 DOC

- 收到真正的旧版 `.doc` 时，不要因 python-docx 不能直接打开它就认定无法处理。
- 只读取内容：调用 `office_document({"action":"inspect","input_path":"资料.doc"})`，工具会用官方 Kit 转换临时副本并读取，保留原文件。
- 编辑：先调用 `office_document({"action":"convert","input_path":"资料.doc","output_path":"资料-可编辑.docx"})`，再按官方流程检查段落、表格、页眉页脚和格式，编辑并另存为新的 DOCX。
- 导出 PDF：调用同一工具的 `convert`，输出路径以 `.pdf` 结尾，或者使用官方流程给出的 Kit CLI。
- 不能将后缀改名当作转换。Kit 接受真正的 OLE DOC；HTML、RTF 伪装的 DOC、加密或损坏文件需要根据实际错误处理。编辑交付为 DOCX，不承诺回存 DOC 或保留宏。

## 工作区与 Studio

已有工作区写入授权时直接完成该范围内的操作，不重复问“一次允许”，也不要求 Full Access。脚本、转换和工具均遵守宿主现有权限；拒绝后不得换执行路径绕过。

`office_document` 的 create/edit/inspect/validate 保留为 Studio 和简单规格的兼容接口；工具参数使用工作区相对路径，输出必须是新文件。复杂排版、精确格式编辑优先按前面的官方工作流处理。原文件保留，结构校验和视觉校验分别据实报告。

普通文件使用 `present` 展示已保存的最终文件；用户要求 Studio 成果时使用 `knowledge_studio_create_artifact`。Studio 使用相同校验器与转换器，PDF 从实际导出的 Office 文件生成。
