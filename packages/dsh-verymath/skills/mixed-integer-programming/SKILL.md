---
name: mixed-integer-programming
description: "Models and solves mixed-integer linear programs (MILP), including binary, integer, and continuous decision variables with linear objectives and constraints: knapsack, assignment, siting, covering, scheduling, TSP-style routing. Verified examples in mip-examples-verified.md (PuLP+CBC tested); LP-basics in lp-examples.md. Author: 李爽夕. In DSH check the Python stack first (verymath_python_check)."
metadata:
  author: "李爽夕"
---

<!-- 作者：李爽夕 -->

# 混合整数规划（Mixed-Integer Programming, MIP）求解

## DSH Integration Notes

- 本技能由 `@eduwork/dsh-verymath` 插件提供。示例文件：
  `mip-examples-verified.md`（背包/指派，PuLP+CBC **已实测**，解已人工核对）与
  `lp-examples.md`（连续 LP 基础，恢复自上游历史版本 191a4e3^）。
- 上游原 examples.md 是 SOCP 示例的错版拷贝（CBLIB 头 + cvx.SOC 内容，与 README 宣称的
  8 个 MIP 示例不符）——本插件以实测文件替代；README 中"100 问题 100% 通过率"等基准
  数字无复现脚本背书，**引用时不采信**。
- 求解器默认 PuLP 内置 CBC（开源免许可）；安装前先 `verymath_python_check`，
  `pip install pulp` 需用户批准。PuLP 4.x API 与 2.x 不兼容（LpVariable 不再收 cat 参数），
  示例代码按 2.8 写。

## 适用场景

- **混合整数线性规划**：线性目标、线性约束，部分或全部变量为整数。
- **二进制决策问题**：选址、指派、覆盖、启停、固定费用建模。
- **组合优化建模**：背包、TSP、排产、车辆路径、网络设计等。
- **可线性化问题**：逻辑约束、Big-M、indicator、SOS1/SOS2 等。

**输入**：可以是自然语言/应用题，也可以是矩阵、JSON、已有模型代码或求解器报错。

## Quick Start（先做这个）

按下面清单执行并在回答中保留结构。环境准备必须先于求解。

- [ ] **求解器选择与环境准备**：
  1. 本建模任务先确认问题类型为 MIP/MILP，并明确用户或当前任务已选定的求解器和接口。
  2. 目标需要安装或配置时，将求解器名称、接口、Python 环境及实际报错交给 `../or-solver/SKILL.md`；该 skill 只配置指定目标。
  3. 配置后由本任务继续求解；配置失败时，由本任务决定下一步，必要时走 GitHub 搜索路径。
- [ ] 路径判断：用户给的是自然语言、矩阵/JSON、代码，还是要求从 GitHub 找代码。
- [ ] 符号化：列变量、变量类型、目标、约束和单位。
- [ ] 数值化：给出矩阵、JSON，或直接用求解器 API 建模。
- [ ] 求解并报告：状态、目标值、变量值、MIP gap、求解时间。
- [ ] 验证：检查约束可行性和整数变量取值。

## 执行流程（三条路径）

```mermaid
flowchart LR
  A[Matrix_or_JSON]
  B[Natural_language]
  C[GitHub_search]
  A --> A1[Build_or_solve_mip]
  B --> B1[Restate]
  B1 --> B2[Clarify_or_assume]
  B2 --> B3[Symbolic_model]
  B3 --> B4[Numeric_or_solver_API]
  B4 --> B5[Solve_and_report]
  A1 --> B5
  C --> C1[Search_GitHub_for_MIP_code]
  C1 --> C2[Fetch_and_adapt_code]
  C2 --> C3[Run_and_report]
```

### 路径 A：已有矩阵、JSON 或模型

1. 核对维度、变量类型、上下界、约束方向和目标方向。
2. 优先复用已有建模结构，避免把稀疏模型强行转成稠密矩阵。
3. 使用可用求解器求解，并保存求解器状态和日志要点。

### 路径 B：自然语言 / 应用题

用户未给数字矩阵时，不要先索要 JSON。按下面顺序推进：

| 步骤 | 内容 |
| --- | --- |
| 1. 重述 | 用一两句话复述题意，便于用户确认。 |
| 2. 变量 | 列出变量名称、含义、单位、类型（binary/integer/continuous）。 |
| 3. 模型 | 写出目标函数和约束，并标明 `<=` / `>=` / `=`。 |
| 4. 求解 | 建模求解，报告目标值、变量值、gap 和状态。 |
| 5. 解释 | 用 1-2 句解释业务含义，必要时说明假设。 |

### 路径 C：GitHub 搜索开源代码

当本地无可用求解器，或用户明确要求从 GitHub 找代码时，搜索：

```text
site:github.com mixed integer programming solver python <problem feature>
```

优先选择近期维护、有 README、纯 Python 或主流求解器接口的项目。抓取
README 和关键文件后，适配用户数据并注明来源。

## 输出模板（推荐）

```markdown
### 环境与依赖
- Python 版本：...
- 可用求解器：...
- 选用求解器：...

### 问题重述
...

### 符号化模型
- 决策变量：...
- 目标函数：...
- 约束：...

### 求解结果
- status: ...
- objective: ...
- variables: ...
- mip_gap: ...

### 验证与解释
...
```
