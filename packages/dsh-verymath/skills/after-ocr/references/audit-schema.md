# 审校日志与覆盖规范

## 文件头

```markdown
# <文档标识> 审校日志

- Markdown：`绝对路径`
- 原始 PDF：`绝对路径` 或 `未找到`
- SHA-256：`哈希`
- 总行数：`数字`
- 审查者：`名称`
```

## 单条记录

```markdown
### <文档标识>-<序号>

- 位置：`绝对路径:行号`；原始 PDF 页码
- 类别：`固定类别`
- 严重度：阻断 / 高 / 中 / 低
- 置信度：高 / 中 / 低
- 当前内容：足以定位的短片段
- 问题：具体错误与判断依据
- 建议修复：可执行的 Markdown/LaTeX 修改
- 证据：原始扫描件 / 上下文一致性 / LaTeX 语法 / 排版规范 / 数学推导
- 状态：已修复 / 待修复 / 需确认
```

固定类别：

- `MATH_DELIMITER`
- `LATEX_ENVIRONMENT`
- `MATH_OCR_SYMBOL`
- `MATH_OCR_STRUCTURE`
- `MATH_SEMANTICS`
- `INLINE_MATH`
- `HEADING_STRUCTURE`
- `MARKDOWN_LAYOUT`
- `TEXT_OCR`
- `UNICODE_LATEX`
- `OCR_ARTIFACT`
- `REFERENCE_NUMBERING`
- `IMAGE_TABLE`

遇到日志或外部工具使用细分类时，优先映射到固定类别：

- `MATH_TEXT_BOUNDARY`、`OCR_TEXT_IN_MATH` → `INLINE_MATH`
- `STRUCTURE_HEADING` → `HEADING_STRUCTURE`
- `CODE_OCR` → 代码文字误识用 `TEXT_OCR`，代码块/伪代码版式损坏用 `MARKDOWN_LAYOUT`
- `LATEX_SYNTAX` → 公式二维结构损坏用 `MATH_OCR_STRUCTURE`，环境配对损坏用 `LATEX_ENVIRONMENT`
- `MARKDOWN_MATH` → `MATH_DELIMITER`

同一错误模式连续出现时，可用一条区间记录聚合，必须列出起止行、代表片段和受影响模式。相隔较远、修法不同或数学语义不同的实例分开记录。

## 覆盖确认

```markdown
## 覆盖确认

- 已审查行段：`1-...`，连续列出
- 已到达末行：是/否
- 对照原件页段：列出范围
- 未解决限制：无，或具体说明
- 问题总数：`数字`
- 已修复：`数字`
- 需确认：`数字`
```

限定区间或抽样审查使用：

```markdown
## 覆盖确认

- 任务目标行段：`起始-结束`
- 已审查行段：`起始-结束`，连续/缺口说明
- 目标行段完整覆盖：是/否
- 源文件已到达末行：是/否；源文件总行数 `数字`
- 对照原件页段：列出范围
- 未解决限制：无，或具体说明
- 问题总数：`数字`
- 已修复：`数字`
- 需确认：`数字`
```

## 双审合并

1. 保留两轮原始日志。
2. 按文件路径和行号建立候选组。
3. 合并同一错误的重复描述，保留两轮证据和置信度。
4. 分开记录同一行上的不同错误。
5. 对冲突修复方案核对扫描原件或数学上下文。
6. 统计两轮交集、单轮发现和最终确认数。
