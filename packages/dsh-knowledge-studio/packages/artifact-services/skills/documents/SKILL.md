---
name: artifact-documents
description: 使用共享成果组件的 office_document 工具创建、检查、编辑和验证 Word DOCX 文档。当用户要制作或修改报告、通知、方案、会议纪要等 .docx 文件，需要读取文档结构与文字，或交付可由 Word、WPS 与 LibreOffice 打开的文档时使用。不用于旧版 .doc、启用宏的 .docm、实时协同、修订留痕或必须驱动本机 Word 界面的任务。
---

# Word 文档

创作前阅读[共同规范](../shared/references/common.md)和[本类创作规范](../shared/references/documents.md)。这些文件同时用于 Studio 生成；此处只补充工具操作。

只操作当前授权项目内的 `.docx` 文件。工作流和内容判断由本 Skill 负责；确定性文件读写交给 `office_document` 工具。路径一律使用项目相对路径，不构造 Python 或 shell 命令。

## 工作流

1. 明确文档用途、读者、结构、文件名和格式要求。只在缺失会显著改变结果的信息时追问。
2. 修改已有文档前，调用 `office_document` 的 `inspect`；不要凭文件名猜测内容。
3. 新建文档时准备 JSON 规格并调用 `create`；修改时调用 `edit`。除非用户明确要求覆盖，编辑时输出到新文件。
4. 调用 `validate`。工具报告中 `valid` 为 `true` 才能报告结构验证通过。
5. 再次调用 `inspect`，核对标题、段落、表格和图片计数。结构验证不等于视觉排版验证；未经真实渲染时不要声称版式已经确认。
6. 只根据工具返回的 JSON 报告结果，并向用户提供 `relativePath`。

## 工具契约

调用 `office_document`，参数为 `action`、按需提供 `input_path`、`output_path` 和直接对象形式的 `spec`（旧版 `spec_json` 字符串仍兼容，二者只传一个）。路径必须在当前项目内且使用相对路径；写操作由 DSH 权限层统一确认，产物会进入预览链路。私有 Python、依赖与脚本路径由插件管理，Agent 不应自行寻找或安装。

底层报告退出码含义为：

- `0`：成功。
- `2`：参数或 JSON 规格无效。
- `3`：输入文件不存在。
- `4`：文档无法读取。
- `5`：输出文件无法写入。
- `6`：文档验证失败。
- `10`：缺少 python-docx。

## 创建规格

```json
{
  "properties": {"title": "会议纪要", "author": "Workspace"},
  "defaults": {"font": "Aptos", "east_asia_font": "微软雅黑", "font_size_pt": 11},
  "page": {"orientation": "portrait", "margins_cm": {"top": 2.54, "right": 2.54, "bottom": 2.54, "left": 2.54}},
  "blocks": [
    {"type": "title", "text": "会议纪要"},
    {"type": "heading", "level": 1, "text": "一、会议信息"},
    {"type": "paragraph", "runs": [{"text": "时间：", "bold": true}, {"text": "2026 年 7 月 26 日"}]},
    {"type": "list", "ordered": false, "items": ["第一项决议", {"text": "第二项决议", "level": 1, "bold": true}]},
    {"type": "table", "header": true, "rows": [["责任人", "事项"], ["张三", "整理材料"]]}
  ]
}
```

`blocks` 支持 `title`、`heading`、`paragraph`、`list`、`table`、`image` 和 `page_break`。`paragraph` 可用 `text`，或用 `runs` 指定 `bold`、`italic`、`underline`、`color`、`font_size_pt`。`list.items` 的对象既可用 `text` 配合上述格式字段，也可用 `runs`；另可指定 0–2 的 `level`。`image.path` 必须是项目内 PNG/JPEG，可指定 `width_cm` 和 `caption`。

## 编辑规格

```json
{
  "operations": [
    {"op": "replace_text", "find": "待定", "replace": "2026 年 7 月 26 日"},
    {"op": "set_properties", "properties": {"title": "定稿会议纪要"}},
    {"op": "append_blocks", "blocks": [{"type": "paragraph", "text": "以上内容经确认。"}]}
  ]
}
```

`replace_text` 仅替换单个纯文本 run 内的匹配，以保留现有格式；跨 run 匹配会标记为 `cross_run_matches_skipped`，含制表符、换行、绘图、域等富内容的 run 会标记为 `rich_content_matches_skipped`，两者都不得宣称已替换。

## 依赖与边界

- Office 依赖和运行环境由宿主配置。报告缺失依赖，不自行安装、升级或更换宿主运行时。
- 不读取或写入项目外路径，不展开 `~`，不写用户 Home，不访问网络和凭据。
- DOCX 容器最大 256 MiB，展开内容最大 512 MiB；项目图片最大 32 MiB、4000 万像素。超过边界时缩小素材或拆分文档，不绕过保护。
- 不处理 `.doc`、`.docm`、宏、修订留痕、批注和外部链接资源。对含复杂 Word 特性的文档，先保留原文件并说明 python-docx 可能不保留不受支持的扩展。
- 脚本完成的是 OOXML 结构检查，不是 Word/WPS 真实渲染。
