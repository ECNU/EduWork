---
name: artifact-spreadsheets
description: 使用 DSH 官方 Office 工作流读取、创建、编辑和检查 Excel 工作簿，支持旧 XLS 转换、公式重算和 XLSX、PDF 交付。
---

# Excel 工作簿接入

创作前阅读[共同规范](../shared/references/common.md)和[表格创作规范](../shared/references/spreadsheets.md)，与 Studio 共用内容设计要求。

宿主会在本说明前加载随包的官方 `office-xlsx` 流程及真实资源目录。按其说明使用配置好的 Python、openpyxl、校验脚本和 LibreOffice Kit；保留单元格类型、公式、样式及无关工作表。没有官方资源的旧宿主仍可使用确定性工具，不安装替代运行时。

- 旧 `.xls` 可直接通过 `office_spreadsheet` 的 inspect 读取；编辑前先 convert 为新的 `.xlsx`，不要改后缀伪装转换。
- `office_spreadsheet({"action":"convert","input_path":"数据.xls","output_path":"数据-可编辑.xlsx"})` 使用官方 Kit。输出为 `.pdf` 时按工作簿打印设置导出。
- 公式需要新计算结果时，使用 `recalculate`，例如 `{"action":"recalculate","input_path":"数据.xlsx","output_path":"数据-重算.xlsx"}`；重开文件分别核对公式和缓存值，不把公式替换成常数。
- create/edit/inspect/validate 作为 Studio 和简单规格的兼容接口保留；灵活的数据分析和格式编辑按官方工作流执行。不能把 DataFrame 覆盖导出视作保留整个原工作簿。

所有工具路径使用工作区相对路径，输出必须是新文件。复用已有工作区写入授权，拒绝后不换路径绕过；不反复索要“一次允许”或 Full Access。原文件保留。普通交付用 present；Studio 成果使用 knowledge_studio_create_artifact，校验和格式转换复用同一官方组件。
