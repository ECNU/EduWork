---
name: math-paper-structure
version: 4.2
description: >
  数学研究论文的内容结构分析。触发条件：用户上传或粘贴数学论文（PDF/Markdown/纯文本），
  并要求进行以下任意一种操作——章节结构梳理、定理/引理/定义提取、证明框架构建、
  证明依赖关系分析、证明完整性审查、生成结构报告。
  关键词触发："结构分析"、"证明框架"、"定理提取"、"依赖树"、"引理关系"、
  "证明骨架"、"章节地图"、"proof structure"、"structural analysis"。

  【本 skill 不做的事】
  - 用通俗语言重新解释定理含义（→ 论文解读模块）
  - 分析论文中的图片/Figure 内容（→ 图片分析模块）
  - 文献检索与引用推荐（→ 文献检索模块）
  - 验证数学证明的正确性（超出 AI 结构分析能力范围）
  - 解读依赖路径的数学意义（→ 内容分析模块）

  【对外输出接口】
  本 skill 的 JSON 是标准只读接口，各模块消费字段如下：

  - skill_literature_search：
      paper.title / paper_summary / paper.arxiv_id / paper.authors / paper.year
      main_theorems[].statement / related_work[].result_summary
      completeness_check.external_deps

  - skill_paper_deep_read：
      section_map / main_theorems / entities[] / proof_framework
      completeness_check / uncertain_log

  - skill_pathway_proof：
      entities[].dependencies / entities[].cited_by
      entities[].uncertain_dependencies / entities[].external_refs
      entities[].shared_node / entities[].auto_labeled
      completeness_check.isolated_results / completeness_check.circular_deps
      proof_framework.dependency_tree

  - skill_reference_manager：
      paper.title / paper.authors / paper.year / paper.venue
      paper.arxiv_id / paper.paper_type / paper_summary
      main_theorems[].statement / related_work[]

  外部模块不得修改原始 JSON，如需标注请写入各自模块的独立输出。
---

# Math Paper Structural Analysis v4.2

## 概述

本 skill 对数学研究论文进行**纯结构性分析**，不生成新数学内容，不推断或猜测。

**执行流程（四步，v4.1 的五步合并为四步）**：
```
论文原文
   │
   ▼
[S1] 结构速览与章节地图
   │ 输出：元信息 + section_map + 复杂度估计 + 主定理预清单
   ▼
[S2] 数学实体抽取
   │ 输出：所有实体的结构化 JSON ← 对外接口标准
   ▼
[S3+4] 证明框架构建 + 完整性审查（单次扫描，合并执行）
   │ 输出：依赖树 + 证明策略 + 时间线 + 完整性报告
   ▼
[S5] 输出交付物
      输出：.md 结构报告 + .json 结构化数据
```

---

## 被其他模块调用时的执行规范

当其他模块（skill_paper_deep_read / skill_literature_search / skill_reference_manager）
需要为某篇新论文生成 JSON 时，按以下规范执行：

**调用入口**：用户已提供论文全文（PDF / 粘贴文本 / arXiv 链接）

**执行范围**：
- 默认执行 Skill 1 + Skill 2 + Skill 5（生成 JSON 后立即停止）
- 不执行 Skill 3+4（由调用方按需触发）
- 调用方如需完整报告，可额外触发 Skill 3+4

**调用后输出**：
- 生成 `<slug>_structure.json`（必须）
- 在终端输出：「✅ skill_base 已完成 JSON 生成：`<slug>_structure.json`，
    共提取 N 个实体，移交 `<调用方模块名>` 继续处理」

调用方无需重复执行 Skill 1–5，直接读取 JSON 继续自身流程。

---

## 硬性约束（全局，无例外）

以下约束适用于所有子 skill 的所有输出。**输出前逐条自检**。

### C1 — LaTeX 符号强制要求

所有数学符号必须用 LaTeX，禁止任何纯文本近似：

| ❌ 禁止 | ✅ 正确 |
|---|---|
| `K1,3` / `K1,k+1` / `2K2` | `$K_{1,3}$` / `$K_{1,k+1}$` / `$2K_2$` |
| `C4` / `C5` | `$C_4$` / `$C_5$` |
| `indsat(n,H)` / `indsat*(n,H)` | `$\text{indsat}(n,H)$` / `$\text{indsat}^*(n,H)$` |
| `n >= 7` / `n <= k` | `$n \geqslant 7$` / `$n \leqslant k$` |

行内公式用 `$...$`，独立公式用 `$$...$$`。

### C2 — 定理陈述必须逐字引用

记录任何 **定义/引理/命题/定理/推论/构造/Claim** 的陈述时，必须从论文中**逐字复制原文**，禁止意译、总结或简化。陈述跨多行则全部复制。

> ⚠️ **Skill 1 边界**：Skill 1 阶段只记录定理标签和一句话作用，**不写完整陈述**。完整陈述在 Skill 2 中提取。

Skill 1 章节总结中允许事实性意译（说明"这节做了什么"），但定理/引理的编号标签和节标题本身仍须逐字。

**图片中的构造**：若构造仅出现在 Figure 中，写 `（完整结构见原文 Figure X，由图片分析模块处理）`。

### C3 — 不确定性必须显式标记

以下情况在行内写 `[UNCERTAIN: <原因>]`，不猜测：
- 陈述在原文中被截断或模糊
- 依赖关系为推断（无明确引用句）→ 写入 `uncertain_dependencies`
- 引用了外部文献但本文未重新证明 → 改用 `[EXTERNAL: 文献标签]`

| 支撑程度 | 处理方式 |
|---|---|
| 有明确引用句（"by Lemma 2.3"） | 写入 `dependencies`，无需标注 |
| 上下文暗示，无明确引用句 | 写入 `uncertain_dependencies`，标 `[UNCERTAIN: 上下文推断]` |
| 完全无上下文支撑 | 不写任何依赖字段，在 `uncertain_log` 中记录 |

> ⚠️ 质量信号：有 20+ 实体的论文若输出中完全没有 `[UNCERTAIN]`，几乎肯定存在幻觉。

### C4 — 禁止捏造依赖关系

无明确文本依据（"X 的证明使用了 Y"）不写依赖，遵照 C3 的优先级表处理。

### C5 — 多条款陈述禁止省略

定理/引理/命题/构造含多个编号条款时，必须完整列出所有条款，每条独立成行，不得用 `...` 省略。

### C6 — 多证明变体必须分别记录

同一定理/引理存在多个证明时，在 `proof_methods` 中用 `proof_variant: 1/2/...` 区分，每个变体单独记录方法、关键工具和位置。

### C7 — 子节必须独立列入 section_map【v4.2 新增】

任何有编号的子节（如 §5.1、§1.3、§4.2）若**包含命名的定理/引理/构造/定义**，必须在 section_map 中**独立列出**，不得合并到父节。

示例：论文有 §5 和 §5.1 两层，§5.1 含 Proposition 5.6，则 §5 和 §5.1 各自独立列出。

### C8 — related_work 必须从参考文献列表提取真实作者和年份【v4.2 新增】

`related_work` 条目的 `authors` 和 `year` 字段必须从论文末尾参考文献列表中提取实际值。禁止留空、写 `null` 或写"未具名"。如原文确实未提供某字段，写 `[UNCERTAIN: 原文未注明]`。

**related_work 收录范围**：以下引用均须纳入 `related_work[]`，不得遗漏：
1. 论文"相关工作"节中对比的外部结论
2. 正文证明中作为**核心工具**直接引用的外部定理（原文写明"by [X]"、"using [X]"且该结论直接参与推导）
3. 摘要或引言中明确提及的背景工作

仅作为脚注说明或补充说明引用的文献（如"see [X] for more details"）不强制纳入，但建议收录。

**论文无独立相关工作节时的处理**：引用散落在正文各处时，按以下优先级扫描全文补全 `related_work[]`：
- 第一优先：摘要和引言中被命名的外部结论（如"X proved that..."形式）
- 第二优先：正文证明中被 `[X]` 标注且原文明确写"by [X]"/"using [X]"的外部定理
- 第三优先：与本文核心参数定义直接相关的已有结论（如本文 $\text{indsat}$ 的定义来源）

**自检信号**：若论文共引用 $N$ 篇文献，`related_work[]` 条目数少于 $N/3$，应重新扫描正文确认是否有遗漏。

### C9 — 节内主定理 role 判断规则【v4.2 新增】

`role` 字段的判断依据是**论文原文的明确语句**，不是全局结构猜测：
- 原文明确说 "main result of this section" / "we prove the following theorem" → `"role": "main"`
- 该结论仅作为辅助工具服务于另一定理 → `"role": "supporting"`
- 该结论直接从另一定理推出 → `"role": "corollary"`

即使某定理在全局看属于支撑性，若它是本节的核心贡献，仍标 `"main"`。

**Corollary 纳入 `main_theorems[]` 的判断规则**：满足以下任意一条，Corollary 应写入 `main_theorems[]`（`role: "corollary"`），不得仅留在 `entities[]`：
- 论文摘要或 §1.x 概述中明确列出该 Corollary 为贡献之一
- 该 Corollary 给出本节核心定量结论（精确公式、精确值），而其来源定理只给出充要刻画或定性结论
- MD 报告的主定理预清单中已列入该 Corollary

不满足以上条件的 Corollary 仅保留在 `entities[]` 中即可。

---

## Skill 1 — 论文结构速览与章节地图

全流程第一步。通读全文，**按实际节顺序**（不跳过任何一节）生成章节地图。

### 输出格式

#### 元信息块
```
标题：
作者：
来源（期刊/会议）：
年份：
arXiv 编号（如有，否则留空）：
语言：EN / CN / 其他
分析日期：YYYY-MM-DD
```

#### 论文类型（可多选，注明判断依据）
纯证明型 | 计算辅助型（含 computer search/穷举表格） | 构造型（主要贡献是构造） | 综述/调查型

#### 复杂度估计
```
结构元素估计数：约 X 个（定理/引理/定义合计）
证明方向数：X 个
计算机搜索参数范围：（如有）
skill-2 耗时预估：低(<10) / 中(10-30) / 高(30-50) / 极高(>50)
```
> 极高复杂度时：分批执行 Skill 2，每批处理一个主节，每批头部标注 `[BATCH X/N]`。

#### 章节地图总览表
| 节编号 | 标题 | 节类型 | 核心动作（一句话） |
|---|---|---|---|
| §X | ... | ... | ... |

节类型选项：引言 / 相关工作 / 预备知识 / 主要结果 / 构造节 / 证明节 / 计算/实验 / 讨论 / 结论 / 附录（可标复合类型）

> **⚠️ "主要结果"判断边界**：节类型"主要结果"仅用于**本文新证明**的结论所在节。若某节内容全部来自外部文献（如标题含"Previous Results"、"Background"的节），应标为"相关工作"或"预备知识"，不得标为"主要结果"。若节内同时含外部结论和本文证明（如本文 Proof of Observation），可标复合类型。MD 与 JSON 中的 `section_type` 必须一致。

#### 主定理预清单（Skill 1 末尾必须输出）

列出全文所有预期的主定理/主推论标签，格式：

```
主定理预清单（约束性）：Theorem X.X, Corollary X.X, ...
```

> ⚠️ **硬性约束（预清单锁定规则）**：预清单一旦在 Skill 1 输出，即视为 `main_theorems[]` 的**完整约束列表**。Skill 2 和 Skill 5 必须确保：
> - `main_theorems[]` 的条目数和标签集合**与预清单完全一致**
> - 预清单中的每个标签必须在 MD §2 中有完整条目（包含逐字陈述、位置、证明方法、地位说明）
> - **不得**以"仅在 §3.5 推论表中出现"代替 §2 完整条目
> - 若 Skill 2 执行后发现预清单有误，必须**明确修订预清单**，不得静默降级某条目

#### 每节详细总结（内联格式）

对每个节/子节（含所有 §X.Y 层级），用以下单一格式输出（不区分节类型，不切换模板）：

```
§X.Y  [标题]
节类型：[类型]
核心动作：<1句，说明本节做了什么>
关键标签：<本节所有命名结论的编号，仅列标签>
主要构造：<Construction X.X：一句描述>（如有）
关键引用：<本节引用的外部文献标签>（如有）
skill2_action：正常提取 / 无需处理 / 提取 proof_variant:2
```

**相关工作节 JSON 映射**：若本节为"相关工作"类型，将提取的"核心对比结果"逐条写入 JSON 的 `related_work[]` 数组，格式：
```json
{ "ref": "[编号]", "authors": "...", "year": ..., "result_summary": "..." }
```

> 禁止：推断作者意图、评价证明优劣、写出定理完整陈述（C2 Skill 1 边界）。

---

## Skill 2 — 数学实体抽取

按节顺序扫描论文，提取所有命名结构元素，每个实体输出为符合 Schema 的 JSON 对象。

**提取对象类型**：
DEFINITION / LEMMA / PROPOSITION / THEOREM / COROLLARY / CONSTRUCTION / CLAIM / OBSERVATION / REMARK

**CLAIM 处理**：证明内部无编号局部断言，用 `Claim-[父标签]-[序号]` 自动命名（如 `Claim-Theorem3.4-1`），标注 `"auto_labeled": true`。

**多条款处理（C5）**：含 (1)(2)(3)... 的定理/引理，statement 字段中各条款用 `\n` 分隔，完整列出。

**极高复杂度（>50实体）**：分批执行，每批一个主节，批次头部注明 `[BATCH X/N — §Y]`。

### 分批合并协议（强制代码执行）

由于 Batch 数量可能较多，且合并 `cited_by` 和计算 `shared_node` 属于精确的图遍历算法，**严禁大模型通过文本生成来手工遍历或拼接 JSON**。必须调用本地代码工具执行合并。

**DSH 宿主首选（@eduwork/dsh-verymath 插件）**：直接调用 `verymath_paper_graph` 工具，传 `path`（主 `<slug>_structure.json`）与 `extraPaths`（各批次文件）；工具自动完成按 label 去重合并、`cited_by` 反向索引重建、`shared_node` 计算、环检测，并返回合并回执（不回显超长 JSON）。工具不可用时才回退到下面的 Python 脚本流程。

**回退流程（无 verymath 插件的宿主）**：
1. **生成合并脚本**：生成并使用 Bash 运行一个临时 Python 脚本（如 `merge_batches.py`）。
2. **脚本必须包含以下严谨逻辑**：
   - 读取当前工作目录下所有批次的暂存 JSON 文件（或解析全部 entities）。
   - **去重合并**：按 `label` 字段合并所有批次的 `entities[]` 数组。
   - **重建反向索引 (cited_by)**：遍历所有实体的 `dependencies` 字段，若 A 的 dependencies 包含 B，则在 B 的 `cited_by` 数组中追加 A（确保去重）。
   - **计算核心枢纽 (shared_node)**：遍历更新后的 `entities`，若某实体的 `cited_by` 数组长度 ≥ 2，**且** `cited_by` 中包含至少一个 `type` 值为 `THEOREM` 的实体，则将该实体的 `shared_node` 字段设为 `true`，否则设为 `false`。
   - **写入结果**：将完整的 `entities` 数组写入目标文件 `<slug>_structure.json` 中，并在根节点追加 `"merge_status": "complete"`。
3. **静默执行**：在终端执行该脚本（如 `python3 merge_batches.py`）。大模型在对话框中仅需回复“✅ 已通过 Python 脚本完成 JSON 实体合并与图索引重建”，**绝对禁止**将合并后的超长 JSON 打印在输出对话中。

**补充要求**：
- 脚本应使用 Python 内置的 `json` 模块进行读写，确保 UTF-8 编码。
- 若某个批次的 JSON 文件不存在或格式错误，脚本应打印错误信息并退出（`sys.exit(1)`），大模型需根据错误信息重新生成缺失的批次。
- 合并完成后，**可选**生成一份简短的统计报告（例如 `总实体数：42，共享节点：5`），但**不得**在终端输出完整的 JSON 内容。
---

## Skill 2 结束：实体列表锁定点 🔒

Skill 2（含分批合并）完成后，**立即执行以下锁定操作，再进入 Skill 3+4**：

```
[ENTITY LOCK]
实体总数：N 个
主定理：<逐一列出 label>
锁定时间：YYYY-MM-DD HH:MM
```

**锁定的含义**：

- `entities[]` 的内容从此刻起固定，Skill 3+4 和 Skill 5 只能**读取**，不得新增或删除实体
- MD 报告的 §3 各子表和 JSON 的 `entities[]` 均以锁定列表为唯一数据源
- 如果 Skill 3+4 过程中发现 Skill 2 遗漏了某个实体，必须**返回 Skill 2 补提取、重新锁定**，不得在 Skill 3+4 阶段静默补入

**分开生成 MD 和 JSON 时的执行顺序**：

```
Skill 2 完成
    ↓
[ENTITY LOCK]（锁定实体列表）
    ↓
Skill 3+4（基于锁定列表构建证明框架）
    ↓
先生成 JSON（entities[] 写入锁定列表）
    ↓
再生成 MD（§3 各表直接从 JSON entities[] 读取，不重新扫描原文）
    ↓
5c 一致性检查（此时两份文件同源，检查应全部通过）
```

> ⚠️ 禁止在 MD 和 JSON 分开生成阶段各自独立扫描原文提取实体——这是造成两份文件不一致的根本原因。JSON 生成在前，MD §3 的数据来自 JSON，不来自原文。

---

## Skill 3+4 — 证明框架构建与完整性审查（合并，单次扫描）

**基于 Skill 2 实体列表**，完成以下工作（无需重读原文正文）：

### 3a. 定理关系图（多主定理时必须输出）
说明各主定理之间的依赖或独立关系，共享基础引理用 `*` 标注。

### 3b. 依赖树（ASCII 缩进，带类型标注）
```
[THEOREM] 主定理
├── [LEMMA] X（直接引用）
│   └── [DEFINITION] Y *（共享节点）
├── [CONSTRUCTION] Z
└── ([Claim-主定理-1])
```

### 3c. 结构化证明策略
按方向分别说明（充分性/必要性/上界/下界）：
```
[方向]：策略 | 关键工具（引用标签）| 分类/构造对象（如有）
```

### 3d. 证明时间线

| 步骤 | 标签 | 建立的性质（逐字） | 方法（具体） | 证明位置 | 被使用于 |
|---|---|---|---|---|---|
| 最终 | 主定理 | \<逐字结论\> | — | — | — |

### 3e. 证明策略摘要（意译，2–4句，此处允许意译）

### 4a. 依赖链完整性（每条一行）
```
✅ A → B：找到明确引用句
⚠️ C → D：上下文推断，已标 [UNCERTAIN]
❌ E → F：被引用但依赖来源缺失
```

### 4b. 外部文献依赖清单
自包含度：高 / 中 / 低
每条 `[EXTERNAL]` 一行，说明对主定理的影响程度。

### 4c. 孤立结论 & 循环依赖
各一行结论，或写"无"。

> **重要边界**：循环依赖检测的结论是「结构层面的循环引用」，
> 不等于「证明是循环论证」。是否构成逻辑谬误，由内容分析模块或人工判断。
> Skill 4 的输出仅为：「发现 A → B → A 的引用路径，建议人工核查是否为笔误或别名」。

### 4d. 完整性审查摘要（3–5句）

---

## Skill 5 — 输出交付物

> **paper_summary 生成时机**：`paper_summary` 字段由 Skill 5 在整合全文后生成（意译，≤3句），
> 基于 Skill 1 的研究问题描述 + Skill 3 的证明策略摘要合成。
> 这是 Skill 5 唯一允许生成的"新内容"，因为 Skill 1/3 均已产出原材料。

生成两份文件：

### 5a. Markdown 报告（`<slug>_structure_analysis.md`）

```markdown
# [论文标题] — 结构分析报告
**skill 版本**：4.2 | **分析日期**：YYYY-MM-DD

## 1. 元信息与章节地图
[Skill 1 完整输出]

## 2. 主定理
[每个主定理：标签 + 逐字陈述 + 证明方法 + 在论文中的地位]

## 3. 所有结构元素
### 3.1 定义
| 标签 | 陈述（逐字引用） | 位置 | 被哪些结论使用 | 备注 |

### 3.2 引理
| 标签 | 陈述（逐字引用，含全部条款） | 位置 | 依赖关系 | 被哪些结论使用 | 证明方法 |

### 3.3 命题
| 标签 | 陈述（逐字引用） | 位置 | 依赖关系 | 被哪些结论使用 | 证明方法 |

### 3.4 定理
| 标签 | 陈述（逐字引用，含全部条款） | 位置 | 依赖关系 | 证明方法 |

### 3.5 推论
| 标签 | 陈述（逐字引用） | 位置 | 来源 |

### 3.6 构造
| 标签 | 陈述（逐字引用，图片构造注明 Figure 编号） | 位置 | 被哪些结论使用 |

### 3.7 Claim（证明内部局部断言）
| 标签 | 所属父结论 | 陈述（逐字引用） | 位置 | 在证明中的角色 |

### 3.8 观察与注记
| 标签 | 类型 | 陈述（逐字引用） | 位置 | 被哪些结论使用 |

### 3.9 数值表格（如有）
| 表格标签 | 标题（逐字） | 数据来源 | 位置 |
完整数值：（原样复制所有行列）

## 4. 证明框架
[Skill 3+4 的 3a–3e 输出]

## 5. 完整性审查报告
[Skill 3+4 的 4a–4d 输出]

## 6. [UNCERTAIN] 日志
| 标签位置 | 不确定原因 | 严重程度（LOW/HIGH） |
（如果没有，写"无"）

## 7. 用户注释
### 7.1 总体备注
（用户在此处添加注释）
### 7.2 单条实体修订
（格式：**[标签]** 修订内容）
```

### 5b. JSON 文件（`<slug>_structure.json`）

**v4.2 精简写法**：空数组 `[]` 和 `null` 字段可省略（减少 token），但 Schema 结构保持兼容，下游解析器遇到缺失字段应视为默认值（`null` / `[]` / `false`）。

```json
{
  "paper": {
    "title": "string",
    "authors": ["string"],
    "venue": "string",
    "year": 2024,
    "arxiv_id": "string | null",
    "source_file": "string | null（论文原文的本地路径或 arXiv URL；若原文仅存在于当次对话上下文中写 null）",
    "language": "EN | CN | other",
    "analysis_date": "YYYY-MM-DD",
    "skill_version": "4.2",
    "paper_type": ["纯证明型 | 计算辅助型 | 构造型 | 综述型"],
    "complexity_estimate": {
      "entity_count_estimate": 0,
      "proof_directions": 0,
      "skill2_effort": "low | medium | high | very_high"
    }
  },
  "section_map": [{
    "section": "§X.Y",
    "title": "string",
    "section_type": "引言 | 相关工作 | 预备知识 | 主要结果 | 构造节 | 证明节 | 计算/实验 | 讨论 | 结论 | 附录（可用 + 连接复合类型，须与 MD 节总结中一致）",
    "core_action": "string",
    "key_labels": ["string"],
    "skill2_action": "正常提取 | 无需处理 | 提取 proof_variant:2（JSON 中只写这三个枚举值之一，不得附加括号注释；注释仅允许出现在 MD 节总结的同名字段后）",
    "appendix": false
  }],
  "related_work": [{
    "ref": "[N]",
    "authors": "string（必填，从参考文献列表提取，C8）",
    "year": 0,
    "result_summary": "string"
  }],
  "paper_summary": "string（意译，≤3句）",
  "main_theorems": [{
    "label": "string",
    "short_title": "string",
    "statement": "string（逐字，多条款用 \\n 分隔）",
    "location": { "section": "string", "page": "string" },
    "proof_methods": [{
      "proof_variant": 1,
      "method": "string",
      "detail": "string",
      "location": "string"
    }],
    "role": "main | supporting | corollary"
  }],
  "theorem_relations": "string（多主定理时说明关系及共享引理）",
  "entities": [{
    "type": "DEFINITION | LEMMA | PROPOSITION | THEOREM | COROLLARY | CONSTRUCTION | CLAIM | OBSERVATION | REMARK",
    "label": "string",
    "statement": "string（逐字）",
    "location": { "section": "string", "page": "string" },
    "dependencies": ["string"],
    "uncertain_dependencies": ["string [UNCERTAIN: 原因]"],
    "cited_by": ["string"],
    "external_refs": ["string"],
    "proof_methods": [{
      "proof_variant": 1,
      "method": "string",
      "detail": "string",
      "location": "string"
    }],
    "parent_result": "string | null",
    "role_in_parent": "string | null",
    "shared_node": false,
    "auto_labeled": false
  }],
  "tables": [{
    "label": "string",
    "title": "string（逐字）",
    "data_source": "computer_search | formula | mixed",
    "location": { "section": "string", "page": "string" },
    "rows": [{ "parameter": "string", "value": "string", "source": "string", "open": false }],
    "open_values": [],
    "conjectured_values": []
  }],
  "proof_framework": {
    "center_theorem": "string",
    "theorem_relation_map": "string（ASCII，共享节点用 * 标注）",
    "dependency_tree": "string（ASCII 缩进树，含类型标注）",
    "proof_strategies": [{
      "direction": "充分性 | 必要性 | 上界 | 下界 | string",
      "proof_variant": 1,
      "method": "string",
      "object_constructed": "string | null",
      "case_split": "string | null",
      "key_tools": ["string"]
    }],
    "timeline": [{
      "step": 1,
      "label": "string",
      "establishes": "string（逐字）",
      "method": "string（具体）",
      "location": "string",
      "used_by": ["string"]
    }],
    "strategy_summary": "string（意译，≤4句）",
    "backquery_requests": [{ "label": "string", "reason": "string", "skill4_conclusion": "string" }]
  },
  "completeness_check": {
    "dependency_integrity": [{ "edge": "A → B", "status": "ok | missing | external", "note": "string" }],
    "self_containment": "high | medium | low",
    "external_deps": [{ "label": "string", "ref": "string", "impact": "string" }],
    "isolated_results": [{ "label": "string", "possible_reasons": ["string"] }],
    "circular_deps": [],
    "backquery_results": [{ "label": "string", "status": "ok | warning | missing", "note": "string" }],
    "summary": "string（3–5句）"
  },
  "uncertain_log": [{ "location": "string", "reason": "string", "severity": "LOW | HIGH" }],
  "source_warning": "string | null（source_file 为 null 时写：'原文未持久化，L3 回查需用户在新会话中重新提供'）",
  "merge_status": "complete | partial: batch X/N（分批时使用，合并完成后改为 complete）",
  "user_notes": "",
  "user_edits": {}
}
```

---

### 5c. 交付物一致性检查（生成两份文件后必须执行）

MD 和 JSON 是同一次分析的两种呈现，内容必须一致。以 JSON 为数据源、MD 为可读报告，冲突时以 JSON 为准并同步修正 MD。

**必须逐项核对的字段**：

| 检查项 | JSON 字段 | MD 对应位置 | 一致性要求 |
|---|---|---|---|
| 主定理列表 | `main_theorems[].label` | §2 主定理列表 + 主定理预清单 | 条目数和标签**三方完全一致**（预清单 = MD §2 条目列表 = JSON `main_theorems[]`）；任何一方不足均为严重错误，**Corollary 类条目不得以"仅出现在推论表"代替完整的 §2 条目和 JSON 记录** |
| 主定理陈述 | `main_theorems[].statement` | §2 每条主定理的逐字陈述 | 字符级一致（LaTeX 等价写法除外） |
| 节类型 | `section_map[].section_type` | 逐节详细总结的"节类型"行 | 完全一致，含复合类型的顺序 |
| 实体总数 | `entities[]` 长度 | §3 各子表的行数之和 | 合计相等 |
| UNCERTAIN 条目 | `uncertain_log[]` | §6 [UNCERTAIN] 日志表 | 条目一一对应，不多不少 |
| 外部依赖 | `completeness_check.external_deps[]` | §5.3 外部文献依赖清单 | 标签和 ref 一一对应 |
| 孤立结论 | `completeness_check.isolated_results[]` | §5.4 孤立结论 | 一一对应 |

**MD 允许有、JSON 不需要的内容**（不视为不一致）：
- 节总结的叙述性段落（研究问题、背景动机等）
- `skill2_action` 字段后的括号注释
- 用户注释区（§7）

**发现不一致时**：优先修正 MD 与 JSON 对齐；若确认是 JSON 有误，同步修正 JSON 并在 `uncertain_log` 中记录修改原因。

---

## 输出前验证清单

### 格式与约束
- [ ] 所有数学符号已用 LaTeX，无裸符号（C1）
- [ ] 所有实体陈述为逐字引用，非意译（C2，Skill 2 起）
- [ ] 多条款定理全部条款完整列出，无 `...` 省略（C5）
- [ ] CLAIM 已提取；无编号 CLAIM 已自动标签并标注 `auto_labeled: true`（C3）
- [ ] 推断依赖已写入 `uncertain_dependencies`，标 `[UNCERTAIN]`（C3/C4）
- [ ] 外部文献依赖已标 `[EXTERNAL]`（C3）
- [ ] 有 20+ 实体的论文存在至少一条 `[UNCERTAIN]`（质量信号）

### 结构完整性
- [ ] section_map 覆盖全部节，**含所有含命名结论的子节 §X.Y**（C7）
- [ ] related_work 每条均有真实 authors 和 year，无"未具名"（C8）
- [ ] 每个主定理的 role 按 C9 规则判断，非机械标 supporting
- [ ] 依赖树节点数 ≥ 主定理直接引用的引理数
- [ ] 多主定理时已给出定理关系图（3a）

### 交付物
- [ ] .md 和 .json 两份文件已生成
- [ ] JSON `skill_version` 字段值为 `"4.2"`
- [ ] `user_notes` 和 `user_edits` 字段已保留（更新时不覆盖）
- [ ] JSON 中所有 `location.page` 为字符串类型（允许范围如 `"3–4"`）
- [ ] 已执行 5c 一致性检查：main_theorems 列表、section_type、UNCERTAIN 条目、外部依赖、孤立结论均在 MD 与 JSON 中一一对应
- [ ] **预清单三方一致性**：逐条核对"预清单条目 ↔ MD §2 完整条目 ↔ JSON `main_theorems[]`"，三者标签集合完全相同；发现缺项立即补入，不得降级到推论表了事
- [ ] related_work 条目数已与 $N/3$（总引用数的三分之一）比对，不足时已重新扫描正文（C8）