# 能力场景示例（第一批）

> 本文件是提案 PR 内的副本；输入样例与后续更新以插件仓库 [LouisUltra/dsh-verymath](https://github.com/LouisUltra/dsh-verymath) 为准。

> 每个示例都按「谁在什么情况下用 / 用户怎么说 / 需要什么输入 / 最后得到什么 / 运行条件和验证情况」组织。
> 提示词可以直接复制到 EduWork 或任何 DSH 会话里使用；示例里的输入文件都在 [`examples/`](https://github.com/LouisUltra/dsh-verymath/blob/main/docs/examples/) 下（或给出公开链接）。
> 产物落在会话工作区，可以继续处理。

## 目录

- [1. 论文阅读与依赖图](#1-论文阅读与依赖图)
- [2. 双语术语库](#2-双语术语库)
- [3. OCR 后校对](#3-ocr-后校对)
- [4. 数值优化（二次规划）](#4-数值优化二次规划)
- [其余能力的示例计划](#其余能力的示例计划)

---

## 1. 论文阅读与依赖图

**技能与工具**：`math-paper-reading`（`skill_base` 结构提取 + `skill_pathway_proof` 依赖路径）、`verymath_paper_validate`、`verymath_paper_graph`

### 谁在什么情况下使用

研究生拿到一篇数学预印本，想先摸清结构再决定读哪部分：需要知道第 1 节里有哪几个定义、主定理依赖哪些引理、每个结论在原文的哪一页。

### 用户怎么说

```text
帮我读 papers/maynard/fulltext.txt（arXiv 1311.4600）的第 1 节，
把里面的定义提取成结构 JSON 并用工具校验。
```

### 需要什么输入

- `papers/maynard/fulltext.txt`：论文全文（公开预印本 arXiv:1311.4600，可自行下载；仓库 `examples/maynard-fulltext.txt` 是同源的纯文本）
- 无其他依赖

### 最后得到什么

- `<slug>_structure.json`：符合 math-paper-reading v4.2 契约的结构产物（`paper` / `section_map` / `main_theorems` / `entities` / `completeness_check`）
- 校验结论：`verymath_paper_validate` 报告的实体数、主定理数、依赖完整性
- 接着追问一句「画出 Theorem 1.2 的依赖关系，标明每个节点对应的原文位置」，得到 Mermaid 或 ASCII 形式的定理依赖图

**怎么判断完成**：JSON 能通过校验（无未知实体类型、无悬空依赖）；依赖图里的每一条边都能在 `entities[].dependencies` 里找到对应记录；图上的节点位置能回查到原文。

### 运行条件和验证情况

- 不需要 Python、不需要联网（论文文本已在工作区）
- 实测：macOS（Apple Silicon），DSH 0.2.0-rc.2 + EduWork 0.4.3，真实模型（未在本机复测 Windows）
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：产出 `maynard_s1_structure.json`，标题 `Small gaps between primes`，6 个实体（2 个 `DEFINITION`、4 个 `THEOREM`），`verymath_paper_validate` 校验通过（依赖根为「Admissible sets」定义）；把论文里非契约类型的猜想写进 `scope_note` 而不是硬塞成实体。

---

## 2. 双语术语库

**技能与工具**：`math-glossary`、`verymath_glossary_build` / `verymath_glossary_query` / `verymath_glossary_upsert`、`verymath_python_check`

### 谁在什么情况下使用

学生或教师在做中英双语材料：先把一份课程词汇表变成结构化的术语库，之后读英文论文时随时查中文译法，遇到新词顺手补进库。

### 用户怎么说

```text
从 source.csv 构建一份中英数学术语表，输出 glossary/glossary.json；
然后查「同调」对应的英文；
再追加一个词条 fibration / 纤维化（名词，代数拓扑）；
最后告诉我表里现在有多少条。
```

### 需要什么输入

- `source.csv`：英文/中文/词性/子领域四列的小样例（见 [`examples/source.csv`](https://github.com/LouisUltra/dsh-verymath/blob/main/docs/examples/source.csv)）
- 本机 Python 3（构建需要；查询和存词不需要）

### 最后得到什么

- `glossary/glossary.json`：符合 math-glossary 合同的术语库（条目排序、`term_id` 唯一、`idx` 连续）
- 查询结果：`同调` → `homology`
- 追加后的条目数

**怎么判断完成**：`glossary.json` 里 `homology / 同调` 和 `fibration / 纤维化` 都在；条目数等于初始行数加新增条数；查询能按中文、英文、前缀、子领域命中。

### 运行条件和验证情况

- 构建需要 `python3` + `PyYAML`（`verymath_python_check` 会先探测并给安装提示）；纯查询与存词不需要 Python
- 实测：macOS（Apple Silicon）
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：`glossary.json` 产出 4 条（`homology/同调`、`homotopy group/同伦群`、`fiber bundle/纤维丛`、`fibration/纤维化`），`idx` 连续 1–4、`term_id` 唯一；查询「同调」命中 `homology`；`fibration` 由 upsert 工具写入且自动维持排序。

---

## 3. OCR 后校对

**技能与工具**：`after-ocr`、`verymath_ocr_scan`

### 谁在什么情况下使用

把扫描版讲义/论文 OCR 成 Markdown 之后：公式密集的页面常出现胶连算符、字体误识、美元符号失衡，需要先定位可疑处再逐段人工确认。

### 用户怎么说

```text
帮我扫一下 ocr/bad_scan.md，找出 OCR 识别可能出错的地方，
给出行号和问题类型，再给出逐行修订建议。
```

### 需要什么输入

- `ocr/bad_scan.md`：一份故意包含典型 OCR 错误的 Markdown（见 [`examples/bad_scan.md`](https://github.com/LouisUltra/dsh-verymath/blob/main/docs/examples/bad_scan.md)）
- 本机 Python 3（扫描脚本是纯标准库）

### 最后得到什么

- 候选问题清单：行号 + 规则类型（如 `distribution-space-font`、`epsilon-index-as-digits`、`odd-dollar-line`、`global-dollar-imbalance`、`environment-mismatch`）
- 逐行修订建议（按 after-ocr 的审校纪律，候选不等同于确认错误）

**怎么判断完成**：每条候选都能在对应行号找到原文；修订稿的公式环境配对、美元符号平衡；没有把候选当结论直接改写原文。

### 运行条件和验证情况

- 需要 `python3`（纯标准库，无需第三方包）
- 实测：macOS（Apple Silicon）
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：10 行样本，扫描器给出 5 条候选，逐行通读再补出 3 处（行 3 的行内数学粘连、行 5 的裸公式、行 9 的 `align` 缺 `$$` 包裹），共 8 处，并列出 4 个待人工确认点（`\mathbb{D}` vs `\mathcal{D}`、下标、单复数、环境名）；审查只出记录，源文件哈希未变。

---

## 4. 数值优化（二次规划）

**技能与工具**：`osqp-solver`、`verymath_osqp_check` / `verymath_osqp_solve`

### 谁在什么情况下使用

做优化作业或论文实验时，手里有一个小规模二次规划，想确认它是否可解、最优解是多少，并且需要独立于求解器的验证。

### 用户怎么说

```text
osqp/qp.json 是一个小型二次规划问题。
先检查 OSQP 环境，再求解它，报告最优解 x、目标值和求解状态，并说明验证是否通过。
```

### 需要什么输入

- `osqp/qp.json`：JSON 契约的 QP 问题（`P` / `q` / `A` / `l` / `u`，见 [`examples/qp.json`](https://github.com/LouisUltra/dsh-verymath/blob/main/docs/examples/qp.json)）
- 本机 Python 3 + `osqp`（主版本 1.x）+ `numpy` / `scipy`

### 最后得到什么

- 环境探测结果（`osqp` 版本是否满足 `>=1,<2` 的门）
- 求解结果：最优解 `x`、目标值、状态分类（`solved` / `solved_inaccurate` / `primal_infeasible` 等）
- 独立验证：脚本内置的 KKT 条件与不可行证书检查结论

**怎么判断完成**：状态分类为 `solved`；独立验证块检查通过（原始/对偶残差、互补性、对偶可行性在阈值内）；解向量与该问题的解析解一致。

### 运行条件和验证情况

- 需要 `python3` + `osqp`（`pip install 'osqp>=1,<2'`）、`numpy`、`scipy`；缺依赖时工具返回结构化安装提示而不是崩溃
- 实测：macOS（Apple Silicon），OSQP 1.1.3
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：状态 `solved`（`accepted=true`），`x = [0.249941, 0.749823]`，对偶变量 `y = -2.750536`，重算目标值 `1.874351`；独立验证 `passed=true`（互补性残差 0、平稳性 9.5e-4、原始界违反 2.4e-4，均在阈值内），与解析解 `x* = (0.25, 0.75)`、`f* = 1.875` 一致。

---

## 其余能力的示例计划

同一套五点结构会补齐下列能力（技能/工具对应关系一并标明）：

| 能力 | 技能 | 工具 | 状态 |
| --- | --- | --- | --- |
| 混合整数规划建模 | `mixed-integer-programming` | — | 待补（需 PuLP + CBC） |
| 最小二乘与回归 | `least-squares` | — | 待补（需 numpy/scipy） |
| 不变量计算 | `invariant-computation` | — | 待补（按需装计算环境） |
| 图论论文深读 | `graph-theory-paper-reading` | — | 待补（需 TeX 出报告） |
| 数学论文写作 | `paper-writing` | — | 待补 |
| Beamer 幻灯片 | `math-beamer` | `verymath_beamer_check` | 待补（需 TeX Live） |
| Lean 形式化 | `lean-formalization`、`lean-setup` | `verymath_lean_detect_sorry` | 待补（patch 扫描无需 Lean） |
| 研究工作流 | `discover-math-problems`、`proof-blueprint-review`、`open-problem-research-pipeline` | `verymath_research_gate` | 待补 |
| Sage 文档查询 | — | `verymath_sage_check` / `verymath_sage_search` | 待补（语料单独分发） |
| MATLAB 执行 | `matlab-runner` | 经 MathWorks 官方 MCP server | 待补（需 MATLAB + license） |
