#!/usr/bin/env python3
"""扫描公式密集型 OCR Markdown，输出需人工确认的候选位置。"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


RULES = [
    (
        "operator-glued",
        "MATH_OCR_SYMBOL",
        "高",
        re.compile(
            r"\\(?:sin|cos|tan|cot|sec|csc|arctan|arcsin|arccos|ln|log|exp)"
            r"(?:x|y|z|t|u|v|w|F|G|H|theta|lambda|alpha|beta|gamma|phi|psi)\b"
        ),
        "标准算子可能与变量粘连成未定义命令",
    ),
    (
        "spaced-operator",
        "MATH_OCR_SYMBOL",
        "中",
        re.compile(r"\\(?:operatorname\*?|mathrm)\{(?:[A-Za-z]\s+){2,}[A-Za-z](?:\s+[A-Za-z])*\}"),
        "算子或短语可能被 OCR 拆成逐字母空格",
    ),
    (
        "split-support",
        "MATH_OCR_SYMBOL",
        "高",
        re.compile(r"\\(?:text|mathrm|operatorname)\{sup\}\s*p\b", re.IGNORECASE),
        "支集算子 supp 可能被拆成 sup p",
    ),
    (
        "distribution-space-font",
        "MATH_OCR_SYMBOL",
        "中",
        re.compile(r"\\mathbb\{D\}(?:\s*\^\s*\{?\\?prime\}?)?"),
        "分布空间 D 的花体可能被识别成黑板粗体",
    ),
    (
        "accented-digit",
        "MATH_OCR_SYMBOL",
        "高",
        re.compile(r"\\(?:tilde|hat|bar|dot|ddot)\s*\{?\d\}?"),
        "带重音的数字通常来自变量形近误识",
    ),
    (
        "epsilon-index-as-digits",
        "MATH_OCR_SYMBOL",
        "中",
        re.compile(r"\bK_\{?8[0Oo]\}?"),
        "邻域或紧集下标 80/8O 可能来自 epsilon_0",
    ),
    (
        "plain-real-space",
        "MATH_OCR_SYMBOL",
        "低",
        re.compile(r"(?<!\\mathbf\{)(?<!\\mathbb\{)(?<!\\mathrm\{)(?<![A-Za-z\\])R\s*\^\s*\{?(?:[1-9n])\}?"),
        "实数空间 R^n 可能丢失黑板粗体；若 R 表示环则保留",
    ),
    (
        "support-as-complement",
        "MATH_SEMANTICS",
        "高",
        re.compile(r"\\operatorname\{supp\}[^\n=]*=[^\n]*(?:\\neq|!=)\s*0[^\n]*\}\s*\^\s*\{?c\}?"),
        "支集疑似被写成非零点集的补集，需检查闭包和补集符号",
    ),
    (
        "laplacian-triangle",
        "MATH_OCR_SYMBOL",
        "中",
        re.compile(r"\\triangle\s*=\s*\\sum"),
        "Laplacian 的大写 Delta 可能被识别成 triangle 命令",
    ),
    (
        "notin-corruption",
        "MATH_OCR_SYMBOL",
        "高",
        re.compile(r"\\(?:bar|overline)\{\\in\}|\\mathrm\{[^}]*bar[^}]*e[^}]*\}"),
        "不属于号可能被识别成带横线的属于号或字母残片",
    ),
    (
        "pandoc-bracket",
        "UNICODE_LATEX",
        "中",
        re.compile(r"\{\[\}|\{\]\}|\\text(?:less|greater|bar)"),
        "存在 Pandoc/HTML 转义残留",
    ),
    (
        "escaped-script",
        "UNICODE_LATEX",
        "中",
        re.compile(r"\\_[{]|\^\{\}\{|\\\{[A-Za-z0-9]+\\_"),
        "上下标或集合可能保留 Markdown 转义",
    ),
    (
        "unicode-math",
        "UNICODE_LATEX",
        "低",
        re.compile(r"[∞≤≥∑∏∫∂∇∈∉→←↔±∁ℒℝℕ]"),
        "Unicode 数学符号与 LaTeX 可能混用",
    ),
    (
        "weak-lp-comma-split",
        "MATH_OCR_STRUCTURE",
        "中",
        re.compile(r"L\s*\^\s*\{\s*p\s*\}\s*,\s*\\infty", re.IGNORECASE),
        "弱 L^p/Lorentz 空间的逗号疑似逃出上标花括号",
    ),
    (
        "split-roman",
        "TEXT_OCR",
        "低",
        re.compile(r"\(i\s+i(?:\s+i)?\)", re.IGNORECASE),
        "罗马编号可能被拆开",
    ),
    (
        "repeated-artifact",
        "OCR_ARTIFACT",
        "中",
        re.compile(r"(?<!\d)([01Il])\1{7,}(?!\d)"),
        "长重复字符可能来自图像、页眉或扫描噪声",
    ),
    (
        "heading-number-residue",
        "HEADING_STRUCTURE",
        "低",
        re.compile(r"^#{1,6}\s*(?:专题|第\s*\d+\s*[章节篇]|§+\s*\d+|Chapter\s+\d+)", re.IGNORECASE),
        "标题可能保留原书编号，需检查是否与渲染编号重复",
    ),
    (
        "text-symbol-in-math",
        "INLINE_MATH",
        "低",
        re.compile(r"(?<!\\)\$\s*[①-⑳]+\s*\$"),
        "圈号等正文符号可能被放入数学模式",
    ),
    (
        "adjacent-inline-math",
        "MATH_DELIMITER",
        "中",
        re.compile(r"(?<!\$)\$(?!\$)[^$\n]{1,100}\$(?!\$)\s+(?<!\$)\$(?!\$)[^$\n]{1,100}\$(?!\$)"),
        "由空白分隔的相邻数学片段可能属于同一公式",
    ),
    (
        "block-environment-in-inline-math",
        "MATH_OCR_STRUCTURE",
        "中",
        re.compile(r"(?<!\$)\$(?!\$)[^$\n]*\\begin\{(?:cases|aligned|array|matrix|pmatrix|bmatrix|vmatrix)\}"),
        "二维 LaTeX 环境可能被单美元行内数学包围",
    ),
    (
        "repeated-english-word",
        "TEXT_OCR",
        "低",
        re.compile(r"\b([A-Za-z]{2,})\s+\1\b", re.IGNORECASE),
        "相邻英文单词重复，可能来自 OCR 拼接",
    ),
]

BEGIN_RE = re.compile(r"\\begin\{([^}]+)\}")
END_RE = re.compile(r"\\end\{([^}]+)\}")
UNESCAPED_DOLLAR_RE = re.compile(r"(?<!\\)\$")


def issue(line: int, column: int, rule: str, category: str, severity: str, message: str, excerpt: str) -> dict:
    return {
        "line": line,
        "column": column,
        "rule": rule,
        "category": category,
        "severity": severity,
        "message": message,
        "excerpt": excerpt.rstrip("\n")[:240],
    }


def scan(path: Path) -> tuple[list[dict], dict]:
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    findings: list[dict] = []
    env_stack: list[tuple[str, int]] = []
    display_open_line: int | None = None
    total_dollars = 0
    total_left = 0
    total_right = 0

    for number, text in enumerate(lines, start=1):
        for rule_id, category, severity, pattern, message in RULES:
            for match in pattern.finditer(text):
                findings.append(issue(number, match.start() + 1, rule_id, category, severity, message, text))

        dollars = list(UNESCAPED_DOLLAR_RE.finditer(text))
        total_dollars += len(dollars)
        if len(dollars) % 2 == 1:
            findings.append(
                issue(number, dollars[-1].start() + 1, "odd-dollar-line", "MATH_DELIMITER", "高", "本行含奇数个未转义美元符号", text)
            )

        single_dollars = [
            match
            for match in dollars
            if (match.start() == 0 or text[match.start() - 1] != "$")
            and (match.end() >= len(text) or text[match.end()] != "$")
        ]
        for opening, closing in zip(single_dollars[0::2], single_dollars[1::2]):
            content = text[opening.end() : closing.start()]
            if re.fullmatch(r"\s*[A-Za-z][A-Za-z' -]{3,}\s*", content):
                findings.append(
                    issue(
                        number,
                        opening.start() + 1,
                        "plain-words-in-inline-math",
                        "INLINE_MATH",
                        "低",
                        "纯英文词或短语可能误入行内数学模式",
                        text,
                    )
                )

        double_count = len(re.findall(r"(?<!\\)\$\$", text))
        if double_count % 2 == 1:
            if display_open_line is None:
                display_open_line = number
            else:
                display_open_line = None

        begins = [(m.start(), "begin", m.group(1)) for m in BEGIN_RE.finditer(text)]
        ends = [(m.start(), "end", m.group(1)) for m in END_RE.finditer(text)]
        for column, kind, env in sorted(begins + ends):
            if kind == "begin":
                env_stack.append((env, number))
            elif not env_stack:
                findings.append(issue(number, column + 1, "orphan-end", "LATEX_ENVIRONMENT", "高", f"发现无对应 begin 的 end{{{env}}}", text))
            else:
                expected, begin_line = env_stack.pop()
                if expected != env:
                    findings.append(
                        issue(
                            number,
                            column + 1,
                            "environment-mismatch",
                            "LATEX_ENVIRONMENT",
                            "高",
                            f"环境从第 {begin_line} 行 begin{{{expected}}} 开始，却由 end{{{env}}} 关闭",
                            text,
                        )
                    )

        left_count = len(re.findall(r"\\left(?:\b|[\[\]().|{}])", text))
        right_count = len(re.findall(r"\\right(?:\b|[\[\]().|{}])", text))
        total_left += left_count
        total_right += right_count
        if left_count != right_count and (left_count or right_count):
            findings.append(issue(number, 1, "line-left-right", "MATH_DELIMITER", "中", "本行的 \\left 与 \\right 数量不同，需结合多行公式检查", text))

    joined = "".join(lines)
    if "\\mathcal{Q}" in joined and "\\Omega" in joined:
        first_q_line = next(number for number, text in enumerate(lines, start=1) if "\\mathcal{Q}" in text)
        findings.append(
            issue(
                first_q_line,
                lines[first_q_line - 1].find("\\mathcal{Q}") + 1,
                "domain-symbol-inconsistency",
                "MATH_OCR_SYMBOL",
                "中",
                "全文同时出现 \\mathcal{Q} 与 \\Omega；若二者指同一开集，需全局核对形近误识",
                lines[first_q_line - 1],
            )
        )

    if total_dollars % 2 == 1:
        findings.append(issue(len(lines), 1, "global-dollar-imbalance", "MATH_DELIMITER", "阻断", "全文未转义美元符号总数为奇数", ""))
    if display_open_line is not None:
        findings.append(issue(display_open_line, 1, "unclosed-display-math", "MATH_DELIMITER", "阻断", "由此开始的 $$ 显示数学未闭合", lines[display_open_line - 1]))
    for env, begin_line in env_stack:
        findings.append(issue(begin_line, 1, "unclosed-environment", "LATEX_ENVIRONMENT", "阻断", f"begin{{{env}}} 未闭合", lines[begin_line - 1]))
    if total_left != total_right:
        findings.append(issue(len(lines), 1, "global-left-right", "MATH_DELIMITER", "高", f"全文 \\left={total_left}，\\right={total_right}", ""))

    findings.sort(key=lambda item: (item["line"], item["column"], item["rule"]))
    summary = {
        "path": str(path.resolve()),
        "lines": len(lines),
        "findings": len(findings),
        "by_category": dict(sorted(Counter(item["category"] for item in findings).items())),
        "by_rule": dict(sorted(Counter(item["rule"] for item in findings).items())),
    }
    return findings, summary


def render_markdown(findings: list[dict], summary: dict) -> str:
    output = [
        "# OCR Markdown 候选扫描",
        "",
        f"- 文件：`{summary['path']}`",
        f"- 总行数：{summary['lines']}",
        f"- 目标行段：{summary['target_range']}",
        f"- 候选数：{summary['findings']}",
        "",
    ]
    for item in findings:
        output.extend(
            [
                f"- `{item['line']}:{item['column']}` `{item['category']}` `{item['rule']}` `{item['severity']}`：{item['message']}",
                f"  - `{item['excerpt'].replace('`', 'ˋ')}`",
            ]
        )
    return "\n".join(output) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="待扫描的 Markdown 绝对或相对路径")
    parser.add_argument("--format", choices=("json", "markdown"), default="markdown")
    parser.add_argument("--output", type=Path, help="输出文件；省略时写入标准输出")
    parser.add_argument("--start-line", type=int, default=1, help="仅输出从该行开始的候选，默认 1")
    parser.add_argument("--end-line", type=int, help="仅输出到该行结束的候选，默认文件末行")
    args = parser.parse_args()

    if not args.input.is_file():
        parser.error(f"输入文件不存在：{args.input}")

    findings, summary = scan(args.input)
    end_line = args.end_line if args.end_line is not None else summary["lines"]
    if args.start_line < 1 or end_line < args.start_line or end_line > summary["lines"]:
        parser.error(f"无效行段：{args.start_line}-{end_line}；文件总行数 {summary['lines']}")
    findings = [item for item in findings if args.start_line <= item["line"] <= end_line]
    summary["target_range"] = f"{args.start_line}-{end_line}"
    summary["findings"] = len(findings)
    summary["by_category"] = dict(sorted(Counter(item["category"] for item in findings).items()))
    summary["by_rule"] = dict(sorted(Counter(item["rule"] for item in findings).items()))
    if args.format == "json":
        rendered = json.dumps({"summary": summary, "findings": findings}, ensure_ascii=False, indent=2) + "\n"
    else:
        rendered = render_markdown(findings, summary)

    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
