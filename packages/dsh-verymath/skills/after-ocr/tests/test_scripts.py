#!/usr/bin/env python3
"""after-ocr 辅助脚本的最小回归测试。"""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载模块：{path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


scanner = load_module("after_ocr_scanner", ROOT / "scripts" / "scan_markdown_ocr.py")
merger = load_module("after_ocr_merger", ROOT / "scripts" / "merge_audit_logs.py")


class ScannerTests(unittest.TestCase):
    def test_detects_core_candidate_rules(self):
        source = """# 示例
$$ \\sinx + \\operatorname*{m a x} + \\text{sup} p + \\mathbb{D} + \\tilde{7} + K_{80} \\
\\begin{aligned} a &= b \\end{array}
called $tangent space$
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.md"
            path.write_text(source, encoding="utf-8")
            findings, summary = scanner.scan(path)

        rules = {item["rule"] for item in findings}
        self.assertIn("operator-glued", rules)
        self.assertIn("spaced-operator", rules)
        self.assertIn("split-support", rules)
        self.assertIn("distribution-space-font", rules)
        self.assertIn("accented-digit", rules)
        self.assertIn("epsilon-index-as-digits", rules)
        self.assertIn("plain-words-in-inline-math", rules)
        self.assertIn("environment-mismatch", rules)
        self.assertIn("unclosed-display-math", rules)
        self.assertEqual(summary["lines"], 4)


class MergerTests(unittest.TestCase):
    def test_preserves_canonical_category_and_merges_same_position(self):
        template = """# 审校日志

- Markdown：`/tmp/source.md`

### AO-X-{pass_name}-001

- 位置：`/tmp/source.md:12`
- 类别：`MATH_OCR_SYMBOL`
- 严重度：中
- 置信度：高
- 当前内容：`x`
- 问题：符号错误
- 建议修复：改为 `y`
- 证据：上下文一致性
"""
        with tempfile.TemporaryDirectory() as directory:
            first = Path(directory) / "a.md"
            second = Path(directory) / "b.md"
            first.write_text(template.format(pass_name="A"), encoding="utf-8")
            second.write_text(template.format(pass_name="B"), encoding="utf-8")
            records = merger.parse_log(first) + merger.parse_log(second)
            rendered = merger.render(records, [first, second])

        self.assertEqual([record["category"] for record in records], ["MATH_OCR_SYMBOL"] * 2)
        self.assertIn("多轮共同命中的位置：1", rendered)
        self.assertIn("`MATH_OCR_SYMBOL`：2", rendered)


if __name__ == "__main__":
    unittest.main()
