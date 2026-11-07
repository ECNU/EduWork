---
name: literature-proof-framework
description: 基于 literature-analysis 输出的方法分析报告，为原始数学问题构建多个可行的证明框架/解决方案框架。
---

# 数学证明框架构建技能

## 功能

输入来自 literature-analysis skill 输出的方法分析报告（JSON），本skill自动完成：
1. 解析原始大问题以及 skill2 中提取的各文献方法、技术、思想
2. 对每种方法评估其优势和局限性
3. 将不同方法组合、嫁接、改进，构建**多个可行的证明框架**
4. 每个框架必须满足：有明确的数学逻辑链条、基于现有成果有迹可循、具有可行性

本 skill 输出的是**候选证明框架**，不是证明。每一步都必须指向已核验结果、明确
假设或尚未闭合的 proof obligation。只要存在未闭合义务，状态必须保持
`candidate` 或 `partial`；不得写成“定理已证”。

## 核心原则

- **不直接尝试证明或解决原始问题**，只构建证明/解决方案的框架
- 框架可以有多个，不要求唯一
- 每个框架必须有明确的数学依据，不能凭空创造
- 框架之间可以相互独立，也可以互补
- 明确指出每个框架的优势、劣势、关键难点

## 触发方式

### 方式一：链式调用（接在 literature-analysis 之后）
先执行 skill1 → skill2，将 skill2 输出的 JSON 传递给本skill。

### 方式二：触发词调用
用户输入 `skill3: <来自 skill2 的报告信息>` 手动调用。

## 工作流程

### Step 1：输入解析

#### 场景A：链式输入（来自 literature-analysis）
- 读取 `outputs/literature_analysis_reports/<slug>_方法分析报告_<date>.json`
- 提取：`source_problem`（原始问题）、`method_classification`（方法分类）、`innovation_flow`（演化关系）、`method_timeline`（时间线）、`summary`（综合评述）

#### 场景B：用户手动输入
- 用户通过 `skill3:` 后提供方法分析信息
- 解析后提取同样的关键信息

### Step 2：方法可行性评估

对 skill2 中识别出的每种方法/技术路线，从以下维度进行评估：

| 维度 | 评估内容 |
|------|----------|
| **成熟度** | 该方法在文献中被验证的程度（如：仅在小规模验证/有完整理论/有数值实验） |
| **扩展潜力** | 该方法是否有被推广到一般情况的潜力 |
| **瓶颈** | 该方法当前遇到的核心障碍（如：SDP规模爆炸、组合分析精度极限） |
| **改进方向** | 基于文献中已有工作，可行的改进思路 |
| **组合可能性** | 该方法能否与其他方法融合 |

### Step 3：证明框架构建

基于评估结果，构建多个**候选证明框架**。每个框架必须包含：

```
框架名称：[名称]
核心思路：[一句话概括]
依赖的方法：[来自skill2的哪些方法]
逻辑链条：
  Step 1: ... → 依据：[引用现有结果]
  Step 2: ... → 依据：[引用现有结果]
  ...
关键难点：[这个框架中最难突破的点】
可行性判断：[高/中/低] — [理由]
预测可能结果：[如果能走通，能得到什么结论]
```

#### 常见框架类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **改进型** | 在现有最佳方法上做增量改进 | Steiner加权策略进一步优化 |
| **融合型** | 将两种独立方法结合 | 组合直觉指导SOS构造 |
| **降维型** | 将原问题转化为更简单的问题 | Roman支配数转化思路 |
| **突破型** | 引入全新的方法范式 | 用代数拓扑方法替代组合分析 |
| **分治型** | 将原问题分解为若干子问题分别处理 | 按图类分情况处理 |

### Step 4：框架对比与推荐

将所有构建的框架进行对比：

| 框架 | 可行性 | 预期收益 | 所需工作量 | 风险 |
|------|--------|----------|------------|------|
| ...   | ...    | ...      | ...        | ...  |

给出推荐排序，并说明理由。

### Step 5：输出报告

```json
{
  "source_problem": "原始问题描述",
  "source_analysis": "来源方法分析报告的路径",
  "framework_methodology": "框架构建的方法论说明",
  "frameworks": [
    {
      "name": "框架名称",
      "type": "改进型/融合型/降维型/突破型/分治型",
      "core_idea": "核心思路",
      "depends_on": ["依赖的方法/文献"],
      "logic_chain": [
        {"step": 1, "action": "...", "evidence": "依据的现有结果"},
        {"step": 2, "action": "...", "evidence": "..."}
      ],
      "key_difficulty": "关键难点",
      "feasibility": "高/中/低",
      "feasibility_reason": "理由",
      "predicted_outcome": "如果能走通的预期结论",
      "strengths": ["优势1", "优势2"],
      "weaknesses": ["劣势1", "劣势2"]
    }
  ],
  "framework_comparison": [
    {"framework": "框架A", "feasibility": "...", "expected_gain": "...", "risk": "..."}
  ],
  "recommendation": "推荐排序和理由",
  "summary": "综合评述"
}
```

### Step 6：保存结果（自动持久化）

**主存路径**：`outputs/literature_proof_reports/`

**备用路径**：当前工作目录下的 `outputs/literature_proof_reports/`

**文件命名格式**：
```
<问题英文缩写（CamelCase）>_证明框架报告_<YYYY-MM-DD>.md
<问题英文缩写（CamelCase）>_证明框架报告_<YYYY-MM-DD>.json
```

## 嵌入其他Skill

在另一个skill的SKILL.md或agent prompt中加入：

```markdown
## 外部skill调用

当需要从已有方法分析构建证明框架时，使用 literature-proof-framework skill。

**链式调用流程**：
1. 调用 literature-search（skill1:）→ 文献调研
2. 调用 literature-analysis（skill2:）→ 方法分析
3. 调用 literature-proof-framework（skill3:）→ 证明框架构建

**输入**：outputs/literature_analysis_reports/*.json
**输出**：outputs/literature_proof_reports/*.json（含 frameworks 数组，每个框架有完整逻辑链条）

**消费方式**：读取输出JSON的 frameworks 字段，可作为后续实验设计或写作的输入。
```

## 输出格式（Markdown报告）

```
# [问题名称] — 证明框架报告

## 1. 分析来源
[来自 skill2 的报告路径]

## 2. 方法可行性评估

### 2.1 [方法A]
- 成熟度: ...
- 扩展潜力: ...
- 瓶颈: ...
- 改进方向: ...

### 2.2 [方法B]
- ...

## 3. 证明框架

### 框架一：[名称]（[类型]）
**核心思路**: ...
**依赖的方法**: ...
**逻辑链条**:
  Step 1: ...（依据: ...）
  Step 2: ...（依据: ...）
  ...
**关键难点**: ...
**可行性**: ...

### 框架二：[名称]（[类型]）
...

## 4. 框架对比

| 框架 | 可行性 | 预期收益 | 风险 |
|------|--------|----------|------|
| ...  | ...    | ...      | ...  |

## 5. 推荐
[推荐顺序和理由]

## 6. 参考文献
```
