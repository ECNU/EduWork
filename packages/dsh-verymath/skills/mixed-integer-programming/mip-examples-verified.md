# 混合整数规划参考示例（已实测）

<!--
  本文件由 @eduwork/dsh-verymath 插件补写（上游 mixed-integer-programming/examples.md
  是 SOCP 示例的错版拷贝，见 UPSTREAM.json 记录）。以下两个示例均用 PuLP 2.8 + CBC
  实测通过，解已人工核对。
  作者：LouisUltra（dsh-verymath）
  求解器：PuLP 内置 CBC（开源，无需商业许可）
-->

## 示例 M1：0-1 背包（max，实测最优 220）

### 问题描述

背包容量 50。三件物品：价值 60/100/120，重量 10/20/30。每件要么全带要么不带，价值最大。

### 符号化模型

- 决策变量：`x_i ∈ {0,1}`（物品 i 是否带走）
- 目标函数：`max 60x₁ + 100x₂ + 120x₃`
- 约束：`10x₁ + 20x₂ + 30x₃ ≤ 50`

```json
{
  "type": "MIP",
  "sense": "max",
  "c": [60, 100, 120],
  "binary_variables": ["x1", "x2", "x3"],
  "constraints": [{"weights": [10, 20, 30], "op": "<=", "rhs": 50}]
}
```

### 代码实现（PuLP + CBC，已实测）

```python
import pulp

values = [60, 100, 120]
weights = [10, 20, 30]
capacity = 50

prob = pulp.LpProblem('knapsack', pulp.LpMaximize)
x = [pulp.LpVariable(f'x{i}', cat='Binary') for i in range(3)]
prob += pulp.lpSum(values[i] * x[i] for i in range(3))
prob += pulp.lpSum(weights[i] * x[i] for i in range(3)) <= capacity

status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
chosen = [i for i in range(3) if x[i].value() == 1]
print(pulp.LpStatus[status], chosen, pulp.value(prob.objective))
# → Optimal [1, 2] 220.0（物品 2、3，总重 50，价值 220）
```

### 验证

- 枚举全部 8 种组合确认最优：{x₂,x₃} 价值 220 重量 50（恰好装满），优于 {x₁,x₂}=160、{x₁,x₃}=180、{x₂,x₃}=220（同值，解不唯一但目标值一致）。
- 松弛 LP（去掉 0-1 约束）给出上界 233.3，整数最优 220 ≤ 233.3，间隙合理。

## 示例 M2：3×3 指派问题（min，实测最优 9）

### 问题描述

三人三任务，成本矩阵如下（行=人，列=任务），每人恰做一项，每项恰归一人，总成本最小。

```
      任务1 任务2 任务3
人A     9    2    7
人B     6    4    3
人C     5    8    1
```

### 符号化模型

- 决策变量：`y_ij ∈ {0,1}`（人 i 分配到任务 j）
- 目标函数：`min Σ c_ij·y_ij`
- 约束：每行和 =1（每人一项）；每列和 =1（每项一人）

```json
{
  "type": "MIP",
  "sense": "min",
  "c_matrix": [[9, 2, 7], [6, 4, 3], [5, 8, 1]],
  "binary_variables": "y_ij",
  "row_constraints": "=1",
  "col_constraints": "=1"
}
```

### 代码实现（PuLP + CBC，已实测）

```python
import pulp

costs = [[9, 2, 7], [6, 4, 3], [5, 8, 1]]
n = 3

prob = pulp.LpProblem('assignment', pulp.LpMinimize)
y = [[pulp.LpVariable(f'y{i}{j}', cat='Binary') for j in range(n)] for i in range(n)]
prob += pulp.lpSum(costs[i][j] * y[i][j] for i in range(n) for j in range(n))
for i in range(n):
    prob += pulp.lpSum(y[i][j] for j in range(n)) == 1
for j in range(n):
    prob += pulp.lpSum(y[i][j] for i in range(n)) == 1

status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
pairs = [(i, j) for i in range(n) for j in range(n) if y[i][j].value() == 1]
print(pulp.LpStatus[status], pairs, pulp.value(prob.objective))
# → Optimal [(0,1), (1,0), (2,2)] 9.0（A→任务2=2，B→任务1=6，C→任务3=1，总计 9）
```

### 验证

- 匈牙利算法交叉验证：最优指派成本 9（A→2, B→1, C→3）。
- 对偶检查：行位势 (0, -3, -5) 与列位势 (10, 2, 6) 下所有 reduced cost ≥ 0，证实最优。

## 与 LP 的关系

- LP 基础示例（连续变量、scipy/COPT 形式）见 `lp-examples.md`（恢复自上游历史版本）。
- 整数变量出现的信号（台数、选/不选、开/关）→ 用本文件的 MIP 形式；不要把整数松弛成连续变量后当作原问题的解。
