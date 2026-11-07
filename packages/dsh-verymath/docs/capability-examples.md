# 能力场景示例（14 项）

> 每个示例都按「谁在什么情况下用 / 用户怎么说 / 需要什么输入 / 最后得到什么 / 运行条件和验证情况」组织，
> 提示词可以直接复制到 EduWork 或任何 DSH 会话里使用。
> 输入样例见 [`docs/examples/`](examples/)：小样例随插件仓库分发；两篇论文正文按该目录
> [`README.md`](examples/README.md) 自行从 arXiv 下载（本仓库不分发全文）。
> 产物落在会话工作区，可以继续处理。

## 目录

- [1. 论文阅读与依赖图](#1-论文阅读与依赖图)
- [2. 双语术语库](#2-双语术语库)
- [3. OCR 后校对](#3-ocr-后校对)
- [4. 数值优化（二次规划）](#4-数值优化二次规划)
- [5. 混合整数规划（0-1 背包）](#5-混合整数规划0-1-背包)
- [6. 最小二乘与回归](#6-最小二乘与回归)
- [7. 不变量计算](#7-不变量计算)
- [8. 图论论文深读](#8-图论论文深读)
- [9. 数学论文写作（断言-证据台账）](#9-数学论文写作断言-证据台账)
- [10. Beamer 幻灯片](#10-beamer-幻灯片)
- [11. Lean 形式化（补丁验收）](#11-lean-形式化补丁验收)
- [12. 研究工作流闸门](#12-研究工作流闸门)
- [13. SageMath 文档查询（反幻觉）](#13-sagemath-文档查询反幻觉)
- [14. MATLAB 执行](#14-matlab-执行)
- [能力与技能/工具对应表](#能力与技能工具对应表)

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

- `papers/maynard/fulltext.txt`：论文全文（公开预印本 arXiv:1311.4600）。仓库不分发正文，按 [`examples/README.md`](examples/README.md) 里的两条命令自行下载并转成文本
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

- `source.csv`：英文/中文/词性/子领域四列的小样例（见 [`examples/source.csv`](examples/source.csv)）
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

- `ocr/bad_scan.md`：一份故意包含典型 OCR 错误的 Markdown（见 [`examples/bad_scan.md`](examples/bad_scan.md)）
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

- `osqp/qp.json`：JSON 契约的 QP 问题（`P` / `q` / `A` / `l` / `u`，见 [`examples/qp.json`](examples/qp.json)）
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

---

## 5. 混合整数规划（0-1 背包）

**技能与工具**：`mixed-integer-programming`（PuLP + CBC）

### 谁在什么情况下使用

课程作业或建模练习里遇到组合优化：一组物品、一个容量、要最大化价值，需要模型、最优解和最优性证据。

### 用户怎么说

```text
knapsack.json 是一个 0-1 背包问题。用 MILP 建模求解，报告选了哪些物品、总重量、
总价值、最优性状态，并说明如何验证这个解。
```

### 需要什么输入

- `knapsack.json`：5 个物品的（名称、重量、价值）与容量 15（见 [`examples/knapsack.json`](examples/knapsack.json)）
- 本机 Python 3 + `pulp`（内置 CBC，开源免许可）

### 最后得到什么

- 建模代码（`solve_knapsack.py`）与求解输出
- 结论表：选中物品、总重量、总价值、最优性状态
- 验证方法说明（CBC 的 MIP gap、容量松弛检查）

**怎么判断完成**：状态为 `Optimal` 且 MIP gap = 0；总重量不超过容量；任选一个未选物品加入都会超重（局部最优性检查）；目标值可由选中物品价值手工复算。

### 运行条件和验证情况

- 需要 `python3` + `pulp`；缺依赖时先 `verymath_python_check`
- 实测：macOS（Apple Silicon），PuLP 2.8.0 + CBC
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：状态 `Optimal`（gap = 0），选中 A/B/C/D、E 未选，总重量 14/15，总价值 **20**；模型同时给出「剩余 1、任何未选物品都装不下」的容量检查。

---

## 6. 最小二乘与回归

**技能与工具**：`least-squares`（numpy / scipy，12 级工具降级链）

### 谁在什么情况下使用

实验数据要拟合趋势：拿到 20 组观测，想得到斜率、截距、置信区间和残差诊断，判断线性模型是否站得住。

### 用户怎么说

```text
points.csv 是 20 组 (x, y) 观测。用最小二乘拟合线性模型 y = a·x + b，
报告 a、b 和拟合质量，并说明残差检查结果。
```

### 需要什么输入

- `points.csv`：两列 `x,y`，20 行（见 [`examples/points.csv`](examples/points.csv)）
- 本机 Python 3 + `numpy` / `scipy`

### 最后得到什么

- 拟合脚本（`fit.py`）、结果表（`fit_output.txt` / `fit_results.md`）
- 参数估计：a、b 及其标准误、t 值、p 值、95% 置信区间
- 拟合质量与残差诊断：R²、调整 R²、RMSE、F 检验、条件数、Durbin-Watson

**怎么判断完成**：三种实现（`numpy.linalg.lstsq`、`scipy.stats.linregress`、`scipy.optimize.curve_fit`）结果一致；残差无系统性趋势；条件数在安全范围。

### 运行条件和验证情况

- 需要 `python3` + `numpy` + `scipy`；缺库走技能内置降级链
- 实测：macOS（Apple Silicon），numpy 2.5.4 / scipy 1.18.1
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：a = 2.455857（SE 0.029332）、b = 1.347086（SE 0.351370），R² = 0.997439，RMSE = 0.7564，cond(X) = 25.02，Durbin-Watson = 1.791（无自相关迹象）；`lstsq` / `linregress` / `curve_fit` 三条路径结果一致到 6 位小数。

---

## 7. 不变量计算

**技能与工具**：`invariant-computation`（按能力路由到计算环境，结果附证据报告）

### 谁在什么情况下使用

线性代数或代数课程里要算一个矩阵的秩、行列式、特征值，并且需要能自证的验算过程（不只是报数字）。

### 用户怎么说

```text
matrix.json 里是一个 3×3 实对称矩阵。计算它的秩、行列式、特征值，
并说明这些量的含义和验算方法。
```

### 需要什么输入

- `matrix.json`：3×3 实对称矩阵（见 [`examples/matrix.json`](examples/matrix.json)）
- 本机 Python 3 + `numpy`（`sympy` 可选，用于符号验算）

### 最后得到什么

- 数值结果：秩、行列式、特征值、条件数
- 验算：特征多项式展开、Σλ = trace、Πλ = det 的交叉核对
- 每个量的含义说明

**怎么判断完成**：`Πλ = det`、`Σλ = trace` 成立；数值秩与理论秩一致；结果与符号展开（若可用）相符。

### 运行条件和验证情况

- 需要 `python3` + `numpy`；无 `sympy` 时改用纯 Python 分数做精确验算
- 实测：macOS（Apple Silicon），numpy 2.5.4（本机无 sympy，验算走纯 Python）
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：秩 3、det = 8、特征值 {1, 2, 4}、cond = 4；用特征多项式 `(2−λ)(λ²−5λ+4)` 手算复核一致（det = 1·2·4 = 8）。

---

## 8. 图论论文深读

**技能与工具**：`graph-theory-paper-reading`（六维深读 + 证明树 LaTeX 报告）、`verymath_paper_graph`

### 谁在什么情况下使用

读讨论班要讲的图论论文：需要理清主定理依赖哪些引理、每条依赖在原文哪里，并且要一份能直接讲的双语报告。

### 用户怎么说

```text
用图论论文深读的方式读 paper/paper-treewidth.txt（arXiv 2012.11459，
Recoloring graphs of treewidth 2）。梳理主定理和关键引理的依赖关系，
输出一份 LaTeX 报告并编译成 PDF。
```

### 需要什么输入

- `paper/paper-treewidth.txt`：论文纯文本（公开预印本 arXiv:2012.11459）。按 [`examples/README.md`](examples/README.md) 自行下载转换，仓库不分发正文
- TeX Live（XeLaTeX + `forest`）

### 最后得到什么

- 深读报告 PDF（12 页）
- 各主定理/关键引理的证明树 PDF（`*_tree_thm1.pdf`、`*_tree_lem4.pdf`）
- 依赖关系与原文定位

**怎么判断完成**：报告能编译出 PDF 且无缺字/缺引用；每条依赖边能回查到原文的引理编号；证明树与正文里的引用方向一致。

### 运行条件和验证情况

- 需要 XeLaTeX + `forest`（`verymath_beamer_check` 可顺带探测 TeX 工具链）
- 实测：macOS（Apple Silicon），TeX Live 2025；产出 12 页报告 + 2 份证明树，编译无错误
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：生成 `paper-treewidth_reading.pdf`（420 KB，12 页）与 `paper-treewidth_tree_thm1.pdf`、`paper-treewidth_tree_lem4.pdf`；编译日志无缺字、无 undefined reference。

---

## 9. 数学论文写作（断言-证据台账）

**技能与工具**：`paper-writing`（骨架 + 断言-证据台账 + 义务审计）

### 谁在什么情况下使用

准备写一篇小论文或课程报告，手里只有几条断言和印象中的参考文献，需要先分清哪条有据、哪条要补证明、哪条是过度声称。

### 用户怎么说

```text
claims.md 是我准备写的一篇短文的三条断言。帮我搭一个可溯源的论文骨架，
为每条断言建立证据台账，标出哪条证据不足、需要补什么。
```

### 需要什么输入

- `claims.md`：三条断言（含作者自填的来源线索，其中一条是"本地实验观察，待核实"）（见 [`examples/claims.md`](examples/claims.md)）

### 最后得到什么

- `skeleton.md`：论文骨架
- `ledger.md`：断言-证据台账（每条断言拆成陈述/来源/实验行，标注 supported / citation-needed / needs-proof / needs-experiment / overclaimed / unsupported）
- `references.bib` 与 `refcheck/`：参考文献与核验记录

**怎么判断完成**：每条断言都有状态与处置建议；标为 `unsupported`/`overclaimed` 的条目给出具体改法；没有来源的"实验观察"被要求补实验或删除。

### 运行条件和验证情况

- 无外部依赖（纯方法论 + 文件产物）
- 实测：macOS（Apple Silicon）
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：三条断言拆成 8 行台账。真抓到问题：C1 的"Jerrum 1976"实际应为 Jerrum 1995（RSA 7:157–165），且更合适的引用是 Dyer–Flaxman–Frieze–Vigoda 2006 / Cereceda–van den Heuvel–Johnson 2009；C2 的"O(n²)"在 t=5 时已被线性上界取代（DM 344:112553, 2021），被标为 overclaimed；"本地实验观察"因工作区无实验文件被标为 needs-experiment。

---

## 10. Beamer 幻灯片

**技能与工具**：`math-beamer`（23 模板包 + 4 闸门流程）、`verymath_beamer_check`

### 谁在什么情况下使用

组会要讲一个主题，需要 6 页左右、能直接编译的数学 Beamer，而不是从零调版式。

### 用户怎么说

```text
帮我做一份 6 页左右的数学组会 Beamer 幻灯片，主题是「稀疏图上的重着色：
从 Jerrum 定理到 treewidth 2」，先检查 TeX 环境，然后生成并编译出 PDF。
```

### 需要什么输入

- 主题与篇幅；无外部文件（如需插图再提供）

### 最后得到什么

- `main.tex` + 编译产物 `main.pdf`
- `build-report.md`：环境探测（latexmk / xelatex）与编译记录

**怎么判断完成**：`verymath_beamer_check` 报可用；PDF 页数符合要求；编译日志无缺字、无未定义引用；版式未溢出。

### 运行条件和验证情况

- 需要 TeX Live（`latexmk`、`xelatex`、`forest`、`ctex` 供中文模板）
- 实测：macOS（Apple Silicon），TeX Live 2025；产出 6 页 PDF
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：`verymath_beamer_check` 报 latexmk / xelatex / forest / ctex 全部可用；`main.pdf` 6 页，编译无错误。

---

## 11. Lean 形式化（补丁验收）

**技能与工具**：`lean-formalization`、`lean-setup`、`verymath_lean_detect_sorry`

### 谁在什么情况下使用

收到或准备提交一份 Lean 补丁，要在没有完整工具链的机器上先做安全审查：有没有 `sorry`/`admit`/新增 `axiom`，能不能作为终版提交。

### 用户怎么说

```text
broken-proof.lean 是我准备提交的 Lean 补丁。按验收纪律检查它能否提交：
扫描禁用词，并说明哪些地方必须修。
```

### 需要什么输入

- `broken-proof.lean`：含 `sorry`、`admit`、`axiom` 的示例补丁（见 [`examples/broken-proof.lean`](examples/broken-proof.lean)）
- 无需 Lean 工具链（纯文本扫描）；编译验证另需 elan + mathlib

### 最后得到什么

- 禁用词清单（行号 + 类型）
- 是否可接受的判定与最小修复补丁
- 编译验证的诚实说明（未跑就写未跑）

**怎么判断完成**：三个禁用词全部定位到行；新增 `axiom` 被判定为致命（引入 `False` 会让整个文件不一致）；给出的修复补丁是标准证明（`rfl` / `simp`）。

### 运行条件和验证情况

- 扫描：`python3`；编译验证：Lean 工具链（本机未装，如实标注）
- 实测：macOS（Apple Silicon），仅扫描路径
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：检出 3 处禁用词——第 4 行 `sorry`、第 7 行 `admit`、第 9 行 `axiom shortcut : False`；明确判定"新增 `False` 公理使文件不一致，不可接受"，并给出 `rfl` / `simp` 的最小修复；编译验证如实报为未执行（工作区无 Lake 项目、无 `lean-toolchain`）。

---

## 12. 研究工作流闸门

**技能与工具**：`discover-math-problems`、`proof-blueprint-review`、`open-problem-research-pipeline`、`verymath_research_gate`

### 谁在什么情况下使用

做一个多阶段研究工作流（目标 → 工作流 → 最终报告），要在宣布"完成"之前确认：目标是否批准、每个工作流的报告与独立评审是否齐、哪些可以进入最终渲染。

### 用户怎么说

```text
这是一个研究项目工作区（project/ 和 workstreams/）。检查它的三道完成闸门：
目标是否批准、工作流是否完成、哪些已可最终渲染。报告每道闸门的问题清单。
```

### 需要什么输入

- 工作区目录：`project/GOALS.yaml`、`workstreams/<id>/report.md`、`status.yaml`、`reviews/*.json`（见 [`examples/research-ws/`](examples/research-ws)）

### 最后得到什么

- 三道闸门的逐项结论与问题清单
- 哪些工作流 render-ready

**怎么判断完成**：三道闸门各自给出 PASSED / NOT PASSED 与原因；报告缺章节、缺独立评审、存在未解决阻断评审等都会列为问题。

### 运行条件和验证情况

- 无外部依赖（纯文件契约校验）
- 实测：macOS（Apple Silicon）
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：`workstream_completion` PASSED（report.md 三节齐全）、`final_render` PASSED（`ws-lsa` render-ready）；`goal_approval` 在**不带 goalId** 的聚合调用下曾报工具侧错误 `value is not lossless JSON`——这是本插件 0.3.2 修复的一个真实缺陷（`details` 里残留 undefined），带 `goalId=g1` 时可正常返回 PASSED。

---

## 13. SageMath 文档查询（反幻觉）

**技能与工具**：`verymath_sage_check`、`verymath_sage_search`（SageMath 技能本体为 GPLv3，未收录；此处是干净房间重实现的查询能力）

### 谁在什么情况下使用

要写 Sage 代码但记不准 API：先查官方文档确认方法名与用法，而不是凭记忆编造。

### 用户怎么说

```text
我想用 SageMath 算椭圆曲线的秩。先检查 Sage 环境是否可用，
然后查官方文档里 rank 相关的正确用法，把 API 名称和示例代码给我（不要凭记忆编造）。
```

### 需要什么输入

- SageMath 文档语料（默认 `~/.verymath/sagemath-corpus`，可用 `VERYMATH_SAGE_CORPUS` 覆盖）：
  取自 SageMath 官方 Sphinx 参考手册（SageMath 10.9.beta9，CC BY-SA 3.0），共 3196 篇纯文本 +
  一份 `reference_manifest.jsonl`；只收录文档文本，不含 SageMath 源码
- 可选：`sage` 可执行文件（设置 `SAGE_PYTHON` 指向该文件，例如
  `~/.verymath/miniforge/envs/sage/bin/sage`）；只查文档不需要它

### 最后得到什么

- 环境探测结果（语料是否可用、语料篇数、二进制是否找到）
- 与查询相关的文档路径、符号/方法列表与摘录

**怎么判断完成**：返回的 API 名称能在语料里找到原文出处；不出现"凭记忆"的签名；二进制缺失时如实降级为仅查询。

### 运行条件和验证情况

- 语料 3196 篇；`sage` 二进制需用户自装（miniforge `sage=10.9`），并设置 `SAGE_PYTHON` 才能被探测到
- 实测：macOS（Apple Silicon），语料可用；未设 `SAGE_PYTHON` 时工具如实报告"binary not found"，设置后可检出
- Windows：Sage 需 WSL，未实测

**实测记录**（用上面的提示词原样跑）：语料可用（3196 篇，79 个顶层领域），检索命中椭圆曲线 `rank` 相关文档并给出 `ell_rational_field` / `ell_number_field` 路径；未设 `SAGE_PYTHON` 时工具如实报二进制缺失，设置后检出。本插件**只做事文档查询**，不提供 Sage 代码执行能力；执行需用户自己的 Sage 环境。

---

## 14. MATLAB 执行

**技能与工具**：`matlab-runner`（经 MathWorks 官方 MCP server，5 个 `mcp__matlab__*` 工具）

### 谁在什么情况下使用

需要 MATLAB 专属结果（工具箱函数、`cond`/`rank` 等数值行为）并且要能引用 MATLAB 自己的输出，而不是用 numpy 近似替代。

### 用户怎么说

```text
用 MATLAB 算矩阵 [2 1 0; 1 3 1; 0 1 2] 的秩、行列式和条件数，
把 MATLAB 的输出原样报告，并列出这台机器上可用的工具箱。
```

### 需要什么输入

- 本机 MATLAB + license（示例用 R2025b）
- MathWorks 官方 `matlab-mcp-server`，经 `dsh-mcp-client` 配置为 5 个 `mcp__matlab__*` 工具

### 最后得到什么

- MATLAB 的真实输出（`rank`、`det`、`cond`）
- `detect_matlab_toolboxes` 的工具箱清单
- 结论与交叉验算说明

**怎么判断完成**：输出确由 MATLAB 打印（而非模型记忆）；数值与理论值一致；工具箱清单来自 `detect_matlab_toolboxes`。

### 运行条件和验证情况

- 需要 MATLAB + license + MCP server；无 MATLAB 时工具报 `MCP_UNAVAILABLE`
- 实测：macOS（Apple Silicon），R2025b Update 7（Optimization + Symbolic）
- Windows：未实测

**实测记录**（用上面的提示词原样跑）：MATLAB 返回 rank 3、det 8、cond 4，与对称正定矩阵特征值 {1, 2, 4} 交叉一致（det = 1·2·4，cond = 4/1）；工具箱清单由 `detect_matlab_toolboxes` 给出。这一项需要本机 MATLAB + license + MathWorks MCP server，**无法在无 MATLAB 的环境或 CI 中复现**。

---

## 能力与技能/工具对应表

| 能力 | 技能 | 模型工具 | 外部依赖 | 示例状态 |
| --- | --- | --- | --- | --- |
| 论文阅读与依赖图 | `math-paper-reading` | `verymath_paper_validate`、`verymath_paper_graph` | — | ✅ 已实测 |
| 双语术语库 | `math-glossary` | `verymath_glossary_build/query/upsert`、`verymath_python_check` | Python 3 + PyYAML（构建） | ✅ 已实测 |
| OCR 后校对 | `after-ocr` | `verymath_ocr_scan` | Python 3 | ✅ 已实测 |
| 数值优化（QP） | `osqp-solver` | `verymath_osqp_check/solve` | Python + osqp/numpy/scipy | ✅ 已实测 |
| 混合整数规划 | `mixed-integer-programming` | — | Python + PuLP/CBC | ✅ 已实测 |
| 最小二乘与回归 | `least-squares` | — | Python + numpy/scipy | ✅ 已实测 |
| 不变量计算 | `invariant-computation` | — | Python + numpy（sympy 可选） | ✅ 已实测 |
| 图论论文深读 | `graph-theory-paper-reading` | `verymath_paper_graph` | TeX Live + forest | ✅ 已实测 |
| 数学论文写作 | `paper-writing` | — | — | ✅ 已实测 |
| Beamer 幻灯片 | `math-beamer` | `verymath_beamer_check` | TeX Live | ✅ 已实测 |
| Lean 形式化 | `lean-formalization`、`lean-setup` | `verymath_lean_detect_sorry` | 扫描无需；编译需 Lean | ✅ 已实测（扫描） |
| 研究工作流 | `discover-math-problems`、`proof-blueprint-review`、`open-problem-research-pipeline` | `verymath_research_gate` | — | ✅ 已实测 |
| Sage 文档查询 | —（干净房间 TS 实现） | `verymath_sage_check/search` | 语料；执行需 sage | ✅ 已实测 |
| MATLAB 执行 | `matlab-runner` | 经 MathWorks 官方 MCP server | MATLAB + license | ✅ 已实测 |

全部 14 项能力在 macOS（Apple Silicon）+ DSH 0.2.0-rc.2 上实跑过；Windows 全部未实测。
