# 示例输入样例

[English](README_EN.md)

本目录是 [`docs/capability-examples.md`](../capability-examples.md) 里各场景用到的输入文件。

| 文件 | 用于 | 说明 |
| --- | --- | --- |
| `source.csv` | 示例 2（双语术语库） | 四行词表样例（英文/中文/词性/子领域） |
| `bad_scan.md` | 示例 3（OCR 后校对） | 故意包含典型 OCR 错误的 10 行 Markdown |
| `qp.json` | 示例 4（二次规划） | JSON 契约的小型 QP |
| `knapsack.json` | 示例 5（混合整数规划） | 5 物品 0-1 背包 |
| `points.csv` | 示例 6（最小二乘） | 20 组带噪声的线性观测 |
| `matrix.json` | 示例 7（不变量） | 3×3 实对称矩阵 |
| `claims.md` | 示例 9（论文写作台账） | 三条断言草稿（含一条无证据的"实验观察"） |
| `broken-proof.lean` | 示例 11（Lean 补丁验收） | 含 `sorry`/`admit`/`axiom` 的示例补丁 |
| `research-ws/` | 示例 12（研究工作流闸门） | 最小研究工作区（GOALS.yaml + 一个工作流） |

## 两篇论文不在本仓库内分发

示例 1（Maynard, arXiv:1311.4600）和示例 8（Recoloring graphs of treewidth 2, arXiv:2012.11459）
使用公开预印本的正文。arXiv 论文的再分发许可由各作者设定，多数不授权第三方仓库再分发全文，
因此本仓库只保存从 arXiv 下载的**方法**，不保存正文。复现时自行下载：

```sh
mkdir -p papers/maynard paper
curl -sL -o papers/maynard/maynard.pdf https://arxiv.org/pdf/1311.4600
pdftotext -layout papers/maynard/maynard.pdf papers/maynard/fulltext.txt
curl -sL -o paper/treewidth.pdf https://arxiv.org/pdf/2012.11459
pdftotext -layout paper/treewidth.pdf paper/paper-treewidth.txt
```

`pdftotext` 来自 poppler（macOS: `brew install poppler`；Debian/Ubuntu: `apt install poppler-utils`）。
转换出的文本仅供本地分析使用，不要提交回仓库。
