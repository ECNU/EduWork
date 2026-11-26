---
name: literature-analysis
description: 对 literature-search skill 输出的文献调研结果进行深度分析，提取各文献的证明方法、技术思想，按数学方法分类，输出结构化分析报告。
---

# 文献方法分析技能

## 功能

输入来自 literature-search skill 的调研结果（JSON 或 MD），或用户手动输入的一组文献，本skill自动完成：
1. 逐篇分析每篇文献使用的**证明方法、技术路线、核心思想**
2. 从数学学术层面进行**方法分类**（如：组合方法、代数方法、概率方法、分析方法等）
3. 绘制**方法演化图谱**（各方法之间的继承、改进、交叉关系）
4. 输出结构化的文献方法分析报告

## 触发方式

### 方式一：链式调用（接在 literature-search 之后）
literature-search 输出保存到 `outputs/literature_reports/` 后，直接调用本skill分析该JSON文件。

### 方式二：触发词调用
用户输入 `skill2: <文献列表>` 即可手动调用。

## 工作流程

### Step 1：输入解析

#### 场景A：消费 literature-search 的 JSON 输出
- 读取 `outputs/literature_reports/<slug>_文献调研报告_<date>.json`
- 提取 `key_papers`、`known_results`、`timeline`、`summary` 等字段

#### 场景B：用户手动输入文献列表
- 用户通过 `skill2:` 后跟若干文献信息（标题、作者、摘要等）
- 解析文献列表，识别每篇文献的核心问题和目标

### Step 2：逐篇方法提取

对每篇文献，提取以下方法信息：

| 维度 | 描述 |
|------|------|
| **问题转化** | 原文如何将问题重新表述或简化 |
| **证明框架** | 整体论证结构（反证法、归纳法、构造法、概率方法等） |
| **核心技术** | 使用的具体数学工具（如：投影分析、SOS/SDP、Gröbner基、随机图论等） |
| **关键引理** | 证明中依赖的核心引理或已知结果 |
| **创新点** | 区别于前人工作的新思想 |
| **适用范围** | 该方法的适用范围和局限性 |

只从论文正文、补充材料或用户提供的可靠方法说明中提取证明方法。标题、摘要和二手
综述不足以支撑详细证明框架；证据不足的字段写为 `not-established`，不得按常识补全。
“创新点”必须区分论文作者的明确主张与本 skill 的比较性推断。

### Step 3：方法分类

将提取的方法按数学学术层面归类：

#### 一级分类（数学分支）
| 类别 | 说明 |
|------|------|
| **组合方法** | 图论、极值组合、投影分析、双计数等 |
| **代数方法** | SOS/SDP、多项式方法、Gröbner基、表示论等 |
| **分析方法** | 函数分析、不等式估计、渐近分析等 |
| **概率方法** | 随机图、概率不等式、Lovász局部引理等 |
| **计算方法** | 半定规划、数值验证、计算机辅助证明等 |

#### 二级分类（技术路线）
在每个一级分类下，按具体技术路线进一步细分。

### Step 4：方法演化图谱

构建各方法之间的演化关系：

```
[原始问题框架]
    ├── 继承/改进 → [方法A_v1] → [方法A_v2] → ...
    ├── 交叉融合 → [方法A+B]
    └── 全新范式 → [方法C]
```

### Step 5：输出报告

输出包含：

```json
{
  "source_problem": "原始问题描述",
  "source_report": "来源报告的路径（场景A）或 用户输入（场景B）",
  "method_classification": {
    "combinatorial": [
      {
        "method_name": "方法名称",
        "papers": ["使用该方法的论文列表"],
        "core_idea": "核心思想描述",
        "evolution": "该方法在时间线上的演变"
      }
    ],
    "algebraic": [...],
    "probabilistic": [...],
    "analytic": [...],
    "computational": [...]
  },
  "innovation_flow": [
    {
      "from": "方法/论文A",
      "to": "方法/论文B",
      "relation": "改进/融合/颠覆",
      "description": "关系描述"
    }
  ],
  "method_timeline": [
    {"year": "...", "method": "...", "paper": "...", "significance": "..."}
  ],
  "summary": "综合评述：主流方法、趋势、空白",
  "cross_references": ["各方法之间的交叉引用关系"]
}
```

### Step 6：保存结果（自动持久化）

每次调用本skill，输出产物必须自动保存到以下位置，**不允许跳过保存步骤**：

**主存路径**（固定）：`outputs/literature_analysis_reports/`

**备用路径**（当主存路径不可写时）：当前工作目录下的 `outputs/literature_analysis_reports/`

**文件命名格式**：
```
<问题英文缩写（CamelCase）>_方法分析报告_<YYYY-MM-DD>.md
<问题英文缩写（CamelCase）>_方法分析报告_<YYYY-MM-DD>.json
```

**保存前的准备工作**：
- 若 `outputs/literature_analysis_reports/` 目录不存在，先用 `mkdir -p` 创建
- JSON 文件必须是合法 JSON（可由其他 skill 直接消费）
- 如果同日期同名文件已存在，添加后缀 `_v2`、`_v3` 以避免覆盖

**输出产物清单**：
| 文件 | 用途 | 消费方 |
|------|------|--------|
| `*.md` | 人类可读的详细方法分析报告 | 直接反馈给用户 |
| `*.json` | 结构化数据（method_classification/innovation_flow等） | 嵌入其他skill / 后续程序化调用 |

## 嵌入其他Skill

其他Skill通过以下方式调用本skill：

1. 在Agent prompt中添加：
   ```
   如需对文献调研结果进行方法分析，请使用 literature-analysis skill。
   调用方式：
   - 链式调用：先执行literature-search，然后读取其JSON输出并传递给literature-analysis
   - 触发词：用户输入 "skill2: <文献信息>" 直接进入方法分析流程
   ```

2. 程序化调用：在 workflow 中组合两个skill：
   ```
   Step 1: 调用 literature-search（输出→outputs/literature_reports/*.json）
   Step 2: 读取该JSON，调用 literature-analysis（输出→outputs/literature_analysis_reports/*.json）
   ```

## 输出格式（Markdown报告）

```
# [问题名称] — 文献方法分析报告

## 1. 分析来源
[来源说明：来自literature-search报告 / 用户手动输入]

## 2. 方法分类总览

### 2.1 [方法大类一：如 组合方法]
- **方法名**: [描述]
  - 代表论文: ...
  - 核心思想: ...
  - 技术路线: ...

### 2.2 [方法大类二]
- ...

## 3. 逐篇方法分析

| 论文 | 方法类别 | 核心技术 | 创新点 | 局限性 |
|------|----------|----------|--------|--------|
| ...   | ...      | ...      | ...    | ...    |

## 4. 方法演化图谱

（文字描述或Mermaid流程图）

## 5. 跨方法关系

- [方法A] 为 [方法B] 提供了 [XX] 基础
- [方法C] 融合了 [方法A] 和 [方法D] 的思想
- ...

## 6. 综合评述

[方法趋势、主流方向、可能的突破点、空白区域]

## 7. 参考文献
```
