---
name: artifact-spreadsheets
description: 使用共享成果组件的 office_spreadsheet 工具创建、检查、编辑和验证 Excel XLSX 工作簿。当用户要制作或修改表格、查看工作簿结构与单元格数据、批量写入数据、检查公式引用和文件完整性，或交付可由 Excel、WPS 与 LibreOffice 打开的 .xlsx 文件时使用。不用于旧版 .xls、启用宏的 .xlsm、Google Sheets 在线协作或必须驱动本机 Excel 界面的任务。
---

# 电子表格

创作前阅读[共同规范](../shared/references/common.md)和[本类创作规范](../shared/references/spreadsheets.md)。这些文件同时用于 Studio 生成；此处只补充工具操作。

只操作当前授权项目内的 `.xlsx` 文件。工作流与表格设计由本 Skill 负责；确定性文件读写交给 `office_spreadsheet` 工具。路径一律使用项目相对路径，不构造 Python 或 shell 命令。

## 工作流

1. 明确最终文件名、工作表、列、数据类型、公式和格式要求。仅在缺少会显著改变结果的信息时追问。
2. 写入前先调用 `office_spreadsheet` 的 `inspect` 检查已有工作簿。不要凭文件名猜测结构。
3. 新建文件时准备 JSON 规格并调用 `create`；修改文件时准备操作列表并调用 `edit`。除非用户明确要求覆盖，编辑时输出到新文件。
4. 调用 `validate`。工具报告中 `valid` 为 `true` 才能报告结构验证通过。
5. 再次调用 `inspect` 读取关键工作表和单元格，确认写入结果。openpyxl 不计算公式，只能保留公式并检查明显的引用错误；不要声称已经核对公式计算值。
6. 只根据工具返回的 JSON 报告结果，并向用户提供 `relativePath`。

## 工具契约

调用 `office_spreadsheet`，参数为 `action`、按需提供 `input_path`、`output_path` 和直接对象形式的 `spec`（旧版 `spec_json` 字符串仍兼容，二者只传一个）。路径必须在当前项目内且使用相对路径；写操作由 DSH 权限层统一确认，产物会进入预览链路。私有 Python、依赖与脚本路径由插件管理，Agent 不应自行寻找或安装。

底层报告退出码含义为：

- `0`：成功。
- `2`：参数或 JSON 规格无效。
- `3`：输入文件不存在。
- `4`：工作簿无法读取。
- `5`：输出文件无法写入。
- `6`：工作簿验证失败。
- `10`：缺少 openpyxl。

## JSON 规格

创建规格：

```json
{
  "properties": {"title": "成绩汇总", "creator": "Workspace"},
  "sheets": [
    {
      "name": "成绩",
      "rows": [["姓名", "分数"], ["张三", 95], ["李四", 88]],
      "header": true,
      "freeze_panes": "A2",
      "auto_filter": true,
      "column_widths": {"A": 18, "B": 12}
    }
  ]
}
```

编辑规格按顺序执行操作：

```json
{
  "operations": [
    {"op": "set", "sheet": "成绩", "cell": "B2", "value": 96},
    {"op": "append_rows", "sheet": "成绩", "rows": [["王五", 91]]},
    {"op": "rename_sheet", "sheet": "成绩", "name": "期末成绩"}
  ]
}
```

还支持 `create_sheet` 和 `delete_sheet`。值只能是字符串、数字、布尔值或 `null`；公式以 `=` 开头的字符串写入。需要日期格式时先写 ISO 日期字符串，不要猜测本地日期格式。

## 依赖与边界

- Office 依赖和运行环境由宿主配置。报告缺失依赖，不自行安装、升级或更换宿主运行时。
- 不读取或写入项目外路径，不展开 `~`，不写用户 Home，不访问网络和凭据。
- 不处理宏、外部数据连接、数据透视表刷新和 Excel 自动化。修改包含高级 Excel 特性的文件可能丢失不受 openpyxl 支持的扩展；先保留原文件并向用户说明。
- 不把“能够用 openpyxl 打开”等同于视觉排版已经正确。视觉预览或版式复核由上层受管能力完成。

## 字面量与公式

普通字符串沿用历史规则：以 `=` 开头会作为公式。需要准确保留来源文本时使用 `{ "type": "text", "value": "=原文" }`；公式可显式写作 `{ "type": "formula", "value": "=SUM(A1:A2)" }`。创建、单元格修改和追加行均支持。验证公式结构不会计算公式结果。
