#!/usr/bin/env python3
"""按文件与行号合并多轮 after-ocr 审校日志。"""

from __future__ import annotations

import argparse
import re
from collections import Counter, defaultdict
from pathlib import Path


BLOCK_RE = re.compile(r"^###\s+([^\n]+)\n(.*?)(?=^#{2,3}\s|\Z)", re.MULTILINE | re.DOTALL)
FIELD_RE = re.compile(r"^- ([^：:\n]+)[：:](.*)$", re.MULTILINE)
LOCATION_RE = re.compile(r"`(.+?):(\d+)`")
LINE_ONLY_RE = re.compile(r"(?:行\s*`?(\d+)|\bL(\d+))", re.IGNORECASE)
PLAIN_LINE_RE = re.compile(r"\s*`?(\d+)")
PASS_RE = re.compile(r"-([A-Za-z0-9]+)-\d+$")
HEADER_MARKDOWN_RE = re.compile(r"^- (?:源 |主审 |OCR )?Markdown[：:]\s*`([^`]+)`", re.MULTILINE)
INLINE_META_RE = re.compile(
    r"^- 类别：`?([^`；\n]+)`?；严重度：([^；\n]+)；置信度：([^；\n]+)", re.MULTILINE
)

CATEGORY_ALIASES = {
    "TEXT_OCR": "TEXT_OCR",
    "MATH_OCR_SYMBOL": "MATH_OCR_SYMBOL",
    "MATH_OCR_STRUCTURE": "MATH_OCR_STRUCTURE",
    "MATH_DELIMITER": "MATH_DELIMITER",
    "INLINE_MATH": "INLINE_MATH",
    "LATEX_ENVIRONMENT": "LATEX_ENVIRONMENT",
    "MATH_SEMANTICS": "MATH_SEMANTICS",
    "MARKDOWN_LAYOUT": "MARKDOWN_LAYOUT",
    "HEADING_STRUCTURE": "HEADING_STRUCTURE",
    "REFERENCE_NUMBERING": "REFERENCE_NUMBERING",
    "IMAGE_TABLE": "IMAGE_TABLE",
    "OCR_ARTIFACT": "OCR_ARTIFACT",
    "UNICODE_LATEX": "UNICODE_LATEX",
    "OCR_TEXT_IN_MATH": "INLINE_MATH",
    "OCR_TEXT": "TEXT_OCR",
    "UNICODE_MATH": "UNICODE_LATEX",
    "LATEX_ARRAY": "LATEX_ENVIRONMENT",
    "LATEX_DELIMITER": "MATH_DELIMITER",
    "MATH_FONT": "MATH_OCR_SYMBOL",
    "MATH_MODE": "INLINE_MATH",
    "MATH_OCR_DELIMITER": "MATH_DELIMITER",
    "MATH_SUBSCRIPT": "MATH_OCR_SYMBOL",
    "OCR_MATH_SYMBOL": "MATH_OCR_SYMBOL",
    "LATEX_TEXT": "INLINE_MATH",
    "LATEX_FUNCTION_ARGUMENT": "MATH_OCR_STRUCTURE",
    "LATEX_MATH_MODE": "INLINE_MATH",
    "STRUCTURE_MISSING": "HEADING_STRUCTURE",
    "OCR_OMISSION": "TEXT_OCR",
    "REFERENCE_OCR": "REFERENCE_NUMBERING",
    "OCR_REFERENCE": "REFERENCE_NUMBERING",
    "CITATION_OCR": "REFERENCE_NUMBERING",
    "EQUATION_NUMBERING": "REFERENCE_NUMBERING",
    "LATEX_SUBSCRIPT": "MATH_OCR_SYMBOL",
    "LATEX_PARENTHESIS": "MATH_DELIMITER",
    "MATH_OCR_SEMANTIC": "MATH_SEMANTICS",
    "LATEX_PUNCTUATION": "MATH_DELIMITER",
    "OCR_PUNCTUATION_IN_MATH": "MATH_OCR_SYMBOL",
    "OCR_DUPLICATE_TEXT": "OCR_ARTIFACT",
    "LATEX_SET_BUILDER": "MATH_OCR_STRUCTURE",
    "OCR_PUNCTUATION": "TEXT_OCR",
    "LATEX_AMBIGUOUS": "MATH_OCR_STRUCTURE",
    "LATEX_FORMULA": "MATH_OCR_STRUCTURE",
    "LATEX_SUBSTACK": "MATH_OCR_STRUCTURE",
    "OCR_GRAMMAR": "TEXT_OCR",
    "MATH_OPERATOR": "MATH_OCR_SYMBOL",
    "OCR_TRUNCATION": "TEXT_OCR",
    "TEXT_LAYOUT": "MARKDOWN_LAYOUT",
    "LATEX_FORMAT": "LATEX_ENVIRONMENT",
    "MARKDOWN_STRUCTURE": "MARKDOWN_LAYOUT",
    "MARKDOWN_TABLE": "IMAGE_TABLE",
    "MARKDOWN_FORMAT": "MARKDOWN_LAYOUT",
    "TEXT_OCR_GARBAGE": "OCR_ARTIFACT",
    "HEADER_FOOTER_OCR": "OCR_ARTIFACT",
    "MATH_OCR_OMISSION": "MATH_OCR_STRUCTURE",
    "MARKDOWN_OCR": "MARKDOWN_LAYOUT",
    "LATEX_COMMAND": "MATH_OCR_SYMBOL",
    "FORMULA_STRUCTURE": "MATH_OCR_STRUCTURE",
    "FORMULA_REFERENCE": "REFERENCE_NUMBERING",
    "STRUCTURE": "HEADING_STRUCTURE",
    "CROSS_REF": "REFERENCE_NUMBERING",
    "MATH_TEXT_BOUNDARY": "INLINE_MATH",
    "OCR_RESIDUE": "OCR_ARTIFACT",
    "FRONT_MATTER": "OCR_ARTIFACT",
    "TOC": "HEADING_STRUCTURE",
    "OCR_TEXT": "TEXT_OCR",
    "MATH_SYMBOL": "MATH_OCR_SYMBOL",
    "正文 OCR": "TEXT_OCR",
    "数学符号 OCR": "MATH_OCR_SYMBOL",
    "正文/公式边界 OCR": "INLINE_MATH",
    "公式文本 OCR": "INLINE_MATH",
    "公式结构 OCR": "MATH_OCR_STRUCTURE",
    "公式 OCR": "MATH_OCR_STRUCTURE",
    "数学定界符 OCR": "MATH_DELIMITER",
    "标题结构 OCR": "HEADING_STRUCTURE",
    "练习结构 OCR": "HEADING_STRUCTURE",
    "公式正文混排": "INLINE_MATH",
    "正文": "TEXT_OCR",
    "MATH_FORMULA": "MATH_OCR_STRUCTURE",
    "MATH_NOTATION": "MATH_OCR_SYMBOL",
    "MATH_DOMAIN": "MATH_OCR_SYMBOL",
    "MATH_INDEX": "MATH_OCR_SYMBOL",
    "LATEX_NOTATION": "MATH_OCR_SYMBOL",
    "OCR_GARBLED": "OCR_ARTIFACT",
    "MATH_RANGE": "MATH_OCR_SYMBOL",
    "LATEX_ENV": "LATEX_ENVIRONMENT",
    "MATH_SPACE": "MATH_DELIMITER",
    "MATH_LIMIT": "MATH_OCR_STRUCTURE",
    "MATH_RELATION": "MATH_OCR_SYMBOL",
    "MATH_TEXT": "INLINE_MATH",
    "MATH_CONSTANT": "MATH_OCR_SYMBOL",
    "MATH_EXPONENT": "MATH_OCR_SYMBOL",
    "INDEX": "REFERENCE_NUMBERING",
    "OCR_SYMBOL": "MATH_OCR_SYMBOL",
    "LIST_STRUCTURE": "MARKDOWN_LAYOUT",
    "CROSS_REFERENCE": "REFERENCE_NUMBERING",
    "MATH_ARGUMENT": "MATH_OCR_STRUCTURE",
    "STRUCTURE_MARKDOWN": "MARKDOWN_LAYOUT",
    "MATH_PUNCTUATION": "MATH_DELIMITER",
    "LATEX_STRUCTURE": "LATEX_ENVIRONMENT",
    "MATH_BRACKET": "MATH_DELIMITER",
    "PUNCTUATION": "TEXT_OCR",
    "MATH_SIGN": "MATH_OCR_SYMBOL",
    "MATH_STATEMENT": "MATH_SEMANTICS",
    "MATH_LOGIC": "MATH_SEMANTICS",
    "MATH_INTERPOLATION": "MATH_SEMANTICS",
    "MATH_ARROW": "MATH_OCR_SYMBOL",
    "MATH_SET": "MATH_OCR_SYMBOL",
    "VARIABLE": "MATH_OCR_SYMBOL",
    "TEXT_LOGIC": "TEXT_OCR",
    "MATH_NORM": "MATH_SEMANTICS",
    "MATH_ORDER": "MATH_SEMANTICS",
    "MATH_ESTIMATE": "MATH_SEMANTICS",
    "DOMAIN": "MATH_OCR_SYMBOL",
    "OCR_INDEX": "REFERENCE_NUMBERING",
    "MATH_DEFINITION": "MATH_SEMANTICS",
    "MATH_VARIABLE": "MATH_OCR_SYMBOL",
    "INDEX_FORMAT": "REFERENCE_NUMBERING",
    "INDEX_NOTATION": "REFERENCE_NUMBERING",
    "STRUCTURE_HEADING": "HEADING_STRUCTURE",
    "集合": "MATH_OCR_SYMBOL",
    "引号": "TEXT_OCR",
    "Unicode": "UNICODE_LATEX",
    "TABLE_OR_MATRIX": "IMAGE_TABLE",
    "LATEX_SYNTAX": "MATH_OCR_STRUCTURE",
    "MARKDOWN_MATH": "MATH_DELIMITER",
    "LAYOUT_DUPLICATION": "OCR_ARTIFACT",
    "CODE_OCR": "MARKDOWN_LAYOUT",
    "MATH_ALGORITHM_INCONSISTENCY": "MATH_SEMANTICS",
}


def normalize_category(raw: str) -> str:
    if raw in CATEGORY_ALIASES:
        return CATEGORY_ALIASES[raw]
    if "语义" in raw or "定义" in raw:
        return "MATH_SEMANTICS"
    if "定界" in raw or "公式边界" in raw:
        return "MATH_DELIMITER"
    if "正文粘连" in raw or "公式文本" in raw or "文本入公式" in raw:
        return "INLINE_MATH"
    if any(token in raw for token in ("矩阵结构", "二维", "公式结构", "数学公式", "练习公式", "公式")):
        return "MATH_OCR_STRUCTURE"
    if any(token in raw for token in ("下标", "数学符号", "数学函数", "数学记号", "数学字体", "算子", "几何符号", "变量")):
        return "MATH_OCR_SYMBOL"
    if any(token in raw for token in ("索引", "引用", "编号")):
        return "REFERENCE_NUMBERING"
    if "标题" in raw or "章节" in raw:
        return "HEADING_STRUCTURE"
    if "图" in raw or "表格" in raw:
        return "IMAGE_TABLE"
    if any(token in raw for token in ("残留", "页眉", "页脚", "版式", "重复", "截断")):
        return "OCR_ARTIFACT"
    if any(token in raw for token in ("代码", "伪代码", "列表", "段落", "格式", "结构", "HTML", "版面")):
        return "MARKDOWN_LAYOUT"
    if any(token in raw for token in ("正文", "标点", "断词", "字符")):
        return "TEXT_OCR"
    if "OCR" in raw:
        return "TEXT_OCR"
    return raw


def parse_log(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    header_match = HEADER_MARKDOWN_RE.search(text)
    header_markdown = header_match.group(1) if header_match else ""
    records: list[dict] = []
    for match in BLOCK_RE.finditer(text):
        record_id = match.group(1).strip()
        if "覆盖确认" in record_id or "问题记录" in record_id:
            continue
        body = match.group(2)
        fields = {key.strip(): value.strip() for key, value in FIELD_RE.findall(body)}
        inline_meta = INLINE_META_RE.search(body)
        if inline_meta:
            fields["类别"] = inline_meta.group(1).strip()
            fields["严重度"] = inline_meta.group(2).strip()
            fields["置信度"] = inline_meta.group(3).strip()
        location_value = fields.get("位置", fields.get("行号", ""))
        location_match = LOCATION_RE.search(location_value)
        if location_match:
            source_path = location_match.group(1)
            line = int(location_match.group(2))
            if header_markdown and not Path(source_path).is_absolute() and Path(source_path).name == Path(header_markdown).name:
                source_path = header_markdown
        elif header_markdown and (line_match := LINE_ONLY_RE.search(location_value)):
            source_path = header_markdown
            line = int(line_match.group(1) or line_match.group(2))
        elif header_markdown and (plain_line_match := PLAIN_LINE_RE.match(location_value)):
            source_path = header_markdown
            line = int(plain_line_match.group(1))
        else:
            source_path = str(path)
            line = 10**12 + len(records)
        pass_match = PASS_RE.search(record_id)
        raw_category_value = fields.get("类别", "未分类")
        backticked_category = re.match(r"`([^`]+)`", raw_category_value)
        raw_category_full = (
            backticked_category.group(1)
            if backticked_category
            else re.split(r"[；;]", raw_category_value, maxsplit=1)[0]
        ).strip("` ")
        raw_category = raw_category_full if raw_category_full in CATEGORY_ALIASES else re.split(r"/", raw_category_full, maxsplit=1)[0].strip()
        records.append(
            {
                "id": record_id,
                "pass": pass_match.group(1) if pass_match else path.stem,
                "source_path": source_path,
                "line": line,
                "raw_category": raw_category,
                "category": normalize_category(raw_category),
                "severity": fields.get("严重度", fields.get("严重程度", fields.get("严重级别", "未记录"))),
                "confidence": fields.get("置信度", "未记录"),
                "current": fields.get("当前内容", fields.get("当前", "")),
                "problem": fields.get("问题", fields.get("说明", "")),
                "suggestion": fields.get("建议修复", fields.get("建议", "")),
                "evidence": fields.get("证据", ""),
                "log": str(path.resolve()),
            }
        )
    return records


def render(records: list[dict], inputs: list[Path]) -> str:
    groups: dict[tuple[str, int], list[dict]] = defaultdict(list)
    for record in records:
        groups[(record["source_path"], record["line"])].append(record)

    overlaps = 0
    pass_only = Counter()
    categories = Counter(record["category"] for record in records)
    for grouped in groups.values():
        passes = {record["pass"] for record in grouped}
        if len(passes) > 1:
            overlaps += 1
        elif passes:
            pass_only[next(iter(passes))] += 1

    output = [
        "# after-ocr 多轮日志合并",
        "",
        "## 摘要",
        "",
        f"- 输入日志：{len(inputs)}",
        f"- 原始问题记录：{len(records)}",
        f"- 按文件与行号归并后的位置：{len(groups)}",
        f"- 多轮共同命中的位置：{overlaps}",
        f"- 多轮共同命中率：{overlaps / len(groups):.1%}" if groups else "- 多轮共同命中率：0.0%",
        f"- 单轮命中位置：{sum(pass_only.values())}",
    ]
    for pass_name, count in sorted(pass_only.items()):
        output.append(f"  - 仅 `{pass_name}` 轮命中：{count}")
    output.extend(["", "### 类别计数", ""])
    for category, count in categories.most_common():
        output.append(f"- `{category}`：{count}")

    output.extend(["", "## 逐位置记录", ""])
    for index, ((source_path, line), grouped) in enumerate(sorted(groups.items()), start=1):
        output.extend(
            [
                f"### M-{index:04d}",
                "",
                f"- 位置：`{source_path}:{line}`",
                f"- 命中轮次：{', '.join(sorted({record['pass'] for record in grouped}))}",
                f"- 原始编号：{', '.join(record['id'] for record in grouped)}",
                f"- 类别：{', '.join(sorted({record['category'] for record in grouped}))}",
                "",
            ]
        )
        for record in grouped:
            output.extend(
                [
                    f"#### {record['id']}",
                    "",
                    f"- 严重度/置信度：{record['severity']} / {record['confidence']}",
                    f"- 当前内容：{record['current']}",
                    f"- 原始类别：{record['raw_category']}",
                    f"- 问题：{record['problem']}",
                    f"- 建议修复：{record['suggestion']}",
                    f"- 证据：{record['evidence']}",
                    "",
                ]
            )
    return "\n".join(output).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("logs", nargs="+", type=Path, help="两份或多份审校日志")
    parser.add_argument("--output", type=Path, help="输出 Markdown；省略时写入标准输出")
    args = parser.parse_args()

    for path in args.logs:
        if not path.is_file():
            parser.error(f"日志不存在：{path}")

    records = [record for path in args.logs for record in parse_log(path)]
    rendered = render(records, args.logs)
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
