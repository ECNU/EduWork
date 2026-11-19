# Capability examples — sample inputs

[中文](README.md)

Input files referenced by [`capability-examples.md`](../capability-examples.md).

| File | Used by | Notes |
| --- | --- | --- |
| `source.csv` | Example 2 (bilingual glossary) | Four-row term list (English / Chinese / part of speech / subfield) |
| `bad_scan.md` | Example 3 (OCR proofreading) | Ten lines of deliberately corrupted OCR Markdown |
| `qp.json` | Example 4 (quadratic program) | Small QP in the JSON contract |
| `knapsack.json` | Example 5 (mixed-integer programming) | Five-item 0-1 knapsack |
| `points.csv` | Example 6 (least squares) | Twenty noisy linear observations |
| `matrix.json` | Example 7 (invariants) | 3×3 real symmetric matrix |
| `claims.md` | Example 9 (writing ledger) | Three draft claims, one with no supporting evidence |
| `broken-proof.lean` | Example 11 (Lean patch acceptance) | Patch containing `sorry`/`admit`/`axiom` |
| `research-ws/` | Example 12 (research gates) | Minimal research workspace (`GOALS.yaml` plus one workstream) |

## 两篇论文不在本仓库分发 / The two papers are not redistributed here

Examples 1 and 8 use the public preprints arXiv:1311.4600 (Maynard) and arXiv:2012.11459
(Recoloring graphs of treewidth 2). arXiv sets redistribution terms per paper and most do not
allow third-party repositories to redistribute the full text, so this repository stores only the
recipe, not the text. Download them locally when reproducing:

```sh
mkdir -p papers/maynard paper
curl -sL -o papers/maynard/maynard.pdf https://arxiv.org/pdf/1311.4600
pdftotext -layout papers/maynard/maynard.pdf papers/maynard/fulltext.txt
curl -sL -o paper/treewidth.pdf https://arxiv.org/pdf/2012.11459
pdftotext -layout paper/treewidth.pdf paper/paper-treewidth.txt
```

`pdftotext` comes from poppler (macOS: `brew install poppler`; Debian/Ubuntu: `apt install poppler-utils`).
The converted text is for local analysis only — do not commit it back.

## 中文

本目录是 [`capability-examples.md`](../capability-examples.md) 中各个场景使用的输入样例。
示例 1 与示例 8 使用的两篇预印本全文不随本仓库分发（arXiv 的再分发条款由各篇自行设定），
按上面的命令在本地下载并转换即可；转换出的文本仅供本地分析，不要提交回仓库。
