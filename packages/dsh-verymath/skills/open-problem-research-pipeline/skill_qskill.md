---
name: qskill
description: 最终的组合大skill。对用户输入的数学公开问题，依次调用 literature-search、literature-analysis、literature-proof-framework，输出完整的文献调研—方法分析—证明框架三合一报告。
---

# QSkill — 完整问题分析管线

## 功能

对用户输入的**一个或多个数学公开问题**，自动依次调用三个子skill：
1. **literature-search**（skill1）— 文献调研：搜索问题研究现状
2. **literature-analysis**（skill2）— 方法分析：提取各文献的方法、技术、思想
3. **literature-proof-framework**（skill3）— 证明框架构建：基于现有方法构建多个可行的证明方案

最终输出一个**完整的三合一报告**（PDF），包含上述所有子skill的输出，并保存到 `outputs/qs_reports/` 下。

## 状态边界

- 文献事实必须带可核验来源；旧资料不能单独证明问题的当前状态。
- 方法分析只覆盖已读取的证据，不能从标题或摘要重建证明细节。
- 证明框架属于候选路线；未闭合 proof obligations 时不得声称得到证明。
- “新问题”“新方法”和“可行”均为待核验标签，除非已完成对应检索或验证。

## 触发方式

用户输入 `qskill: <数学问题描述>` 即可调用。

### 多问题处理

如果用户输入多个问题，需明确说明（如"两个问题"、"问题1：... 问题2：..."），对每个问题**独立执行**完整的 skill1→skill2→skill3 管线。

## 工作流程

### Phase 0：输入解析

- 判断用户输入是**单个问题**还是**多个问题**
- 如果是多个问题，分割为独立的问题列表
- 对每个问题，生成唯一 slug（英文缩写，CamelCase）

### Phase 1：调用 skill1 — 文献调研

对每个问题：

1. **问题精确化确认**（skill1 Step 0）：
   - 快速联网搜索最匹配的已知数学问题
   - 如果问题不明确，向用户展示精确表述并确认
   - 如果问题已明确，直接继续

2. 执行 skill1 完整流程（Step 1-5）：
   - 分析问题 → 联网搜索 → 信息整理 → 输出报告
   - 保存到 `outputs/literature_reports/<slug>_文献调研报告_<date>.json`

3. 将 skill1 的 JSON 输出摘要嵌入最终报告

### Phase 2：调用 skill2 — 方法分析

对每个问题：

1. 读取 skill1 输出的 `<slug>_文献调研报告_<date>.json`
2. 执行 skill2 完整流程（Step 1-6）：
   - 提取方法 → 方法分类 → 演化图谱 → 输出报告
   - 保存到 `outputs/literature_analysis_reports/<slug>_方法分析报告_<date>.json`

3. 将 skill2 的 JSON 输出摘要嵌入最终报告

### Phase 3：调用 skill3 — 证明框架构建

对每个问题：

1. 读取 skill2 输出的 `<slug>_方法分析报告_<date>.json`
2. 执行 skill3 完整流程（Step 1-6）：
   - 方法评估 → 框架构建 → 对比推荐 → 输出报告
   - 保存到 `outputs/literature_proof_reports/<slug>_证明框架报告_<date>.json`

3. 将 skill3 的 JSON 输出摘要嵌入最终报告

### Phase 4：组装最终报告

对每个问题，将 Phases 1-3 的输出汇总为一个章节。

#### 单问题报告结构

```
# [问题名称] — 完整分析报告

## 第一章：文献调研（来自 literature-search）
- 问题概述
- 当前状态
- 已知结果
- 关键文献
- 综合评述

## 第二章：方法分析（来自 literature-analysis）
- 方法分类总览
- 逐篇方法分析
- 方法演化图谱
- 跨方法关系

## 第三章：证明框架（来自 literature-proof-framework）
- 方法可行性评估
- 证明框架列表（每个含逻辑链条）
- 框架对比与推荐
```

#### 多问题报告结构

```
# 多问题完整分析报告

## 问题一：[名称]
  [章节1-3同上]

## 问题二：[名称]
  [章节1-3同上]
```

### Phase 5：输出 PDF 并保存

1. 使用 `python3 <package-root>/skills/qskill/md2pdf.py <md文件路径>` 将 Markdown 报告转换为 PDF
2. 该脚本使用 pdflatex（需系统预装）编译，需 ctex 宏包（TeX Live 中文支持）
3. 如果 pdflatex 不可用，回退到仅保存 Markdown 源文件
4. 保存到 `outputs/qs_reports/`

**文件命名**：
```
<问题英文缩写（CamelCase）>_完整分析报告_<YYYY-MM-DD>.pdf    （单问题）
MultiProblem_完整分析报告_<YYYY-MM-DD>.pdf                   （多问题）
```

同时保存对应的 Markdown 源文件：
```
<问题英文缩写（CamelCase）>_完整分析报告_<YYYY-MM-DD>.md
```

### 输出产物清单

| 文件 | 用途 |
|------|------|
| `outputs/qs_reports/<slug>_完整分析报告_<YYYY-MM-DD>.md` | Markdown 源文件（可嵌入其他skill） |
| `outputs/qs_reports/<slug>_完整分析报告_<YYYY-MM-DD>.pdf` | PDF 文档（直接阅读） |
| `outputs/literature_reports/<slug>_文献调研报告_<YYYY-MM-DD>.json` | skill1 中间产物 |
| `outputs/literature_analysis_reports/<slug>_方法分析报告_<YYYY-MM-DD>.json` | skill2 中间产物 |
| `outputs/literature_proof_reports/<slug>_证明框架报告_<YYYY-MM-DD>.json` | skill3 中间产物 |

## skill1 的"问题精确化确认"说明

在调用 skill1 的 Step 0 时，需注意：
- 如果用户输入的问题本身就是精确的数学猜想名（如 "P vs NP"、"孪生素数猜想"、"Vizing猜想"），**直接跳过确认步骤**
- 如果用户输入描述模糊（如 "那个关于素数的猜想"、"图论中乘积的问题"），则需要联网搜索找出最匹配的问题，展示给用户确认
- 确认过程只做**一次**，如果用户否认则要求输入更精确的描述

## 嵌入其他Skill

由于 qskill 本身就是顶层 skill，其他更大的 skill 可以直接：

1. 在 prompt 中引用：
   ```
   如需对数学公开问题进行完整分析（文献调研+方法分析+证明框架），使用 qskill。
   触发词：qskill: <问题描述>
   输出：outputs/qs_reports/<slug>_完整分析报告_<date>.json（含三阶段的全部数据）
   ```

2. 读取 `outputs/qs_reports/*.json` 中的 `literature_review`、`method_analysis`、`proof_frameworks` 三字段分别获取各阶段结果。

## MWE

用户输入：
```
qskill: Vizing猜想
```

输出过程：
1. skill1 Step 0：问题已明确，跳过确认
2. skill1：搜索文献 → 保存到 `outputs/literature_reports/VizingConjecture_文献调研报告_2026-07-10.json`
3. skill2：方法分析 → 保存到 `outputs/literature_analysis_reports/VizingConjecture_方法分析报告_2026-07-10.json`
4. skill3：构建框架 → 保存到 `outputs/literature_proof_reports/VizingConjecture_证明框架报告_2026-07-10.json`
5. 组装报告 → 保存到 `outputs/qs_reports/VizingConjecture_完整分析报告_2026-07-10.pdf`
