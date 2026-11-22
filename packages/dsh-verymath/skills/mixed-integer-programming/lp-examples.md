# 线性规划参考示例

<!-- 作者：李爽夕 -->

> 模型：deepseek-v4-pro

---

## 示例 1：两产品生产（max）

### 问题描述

工厂生产产品 A、B。每单位利润分别为 3 与 5。每单位 A 消耗原料 1、工时 2；每单位 B 消耗原料 2、工时 1。原料总量不超过 100，工时总量不超过 120；产量非负。求利润最大。

### 符号化模型

- 决策变量：`x1`（A 产量）、`x2`（B 产量），均 `>= 0`
- 目标函数：`max 3*x1 + 5*x2`
- 约束：
  - 原料：`x1 + 2*x2 <= 100`
  - 工时：`2*x1 + x2 <= 120`

```json
{
  "sense": "max",
  "c": [3, 5],
  "A_ub": [[1, 2], [2, 1]],
  "b_ub": [100, 120],
  "bounds": [[0, null], [0, null]]
}
```

### 代码实现

```python
from scipy.optimize import linprog

c = [-3, -5]  # linprog 默认最小化，取负
A_ub = [[1, 2], [2, 1]]
b_ub = [100, 120]

result = linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=(0, None), method='highs')
print(f"status: {result.status}, obj: {-result.fun}, x: {result.x}")
```

---

## 示例 2：运输分配（min）

### 问题描述

仓库 W1、W2 向门店 S1、S2 供货。单位运费：W1→S1=4，W1→S2=6；W2→S1=5，W2→S2=3。W1 最多供 80，W2 最多供 70；S1 至少需 60，S2 至少需 50。求最低运费。

### 符号化模型

- 决策变量：`x11, x12, x21, x22 >= 0`
- 目标函数：`min 4*x11 + 6*x12 + 5*x21 + 3*x22`
- 约束：
  - 供给：`x11 + x12 <= 80`，`x21 + x22 <= 70`
  - 需求：`x11 + x21 >= 60`，`x12 + x22 >= 50`

```json
{
  "sense": "min",
  "c": [4, 6, 5, 3],
  "A_ub": [[1, 1, 0, 0], [0, 0, 1, 1], [-1, 0, -1, 0], [0, -1, 0, -1]],
  "b_ub": [80, 70, -60, -50],
  "bounds": [[0, null], [0, null], [0, null], [0, null]]
}
```

### 代码实现

```python
from scipy.optimize import linprog

c = [4, 6, 5, 3]
A_ub = [[1, 1, 0, 0], [0, 0, 1, 1], [-1, 0, -1, 0], [0, -1, 0, -1]]
b_ub = [80, 70, -60, -50]

result = linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=(0, None), method='highs')
print(f"status: {result.status}, obj: {result.fun}, x: {result.x}")
```

---

## 示例 3：配方混合（min）

### 问题描述

配制产品需两种原料 A、B。单位成本 A=9，B=7。指标 P 至少 100（A 每单位提供 3，B 提供 2），指标 Q 至少 80（A 每单位提供 1，B 提供 2）。求最低成本。

### 符号化模型

- 决策变量：`xA, xB >= 0`
- 目标函数：`min 9*xA + 7*xB`
- 约束：
  - 指标 P：`3*xA + 2*xB >= 100`
  - 指标 Q：`xA + 2*xB >= 80`

```json
{
  "sense": "min",
  "c": [9, 7],
  "A_ub": [[-3, -2], [-1, -2]],
  "b_ub": [-100, -80],
  "bounds": [[0, null], [0, null]]
}
```

### 代码实现

```python
from scipy.optimize import linprog

c = [9, 7]
A_ub = [[-3, -2], [-1, -2]]
b_ub = [-100, -80]

result = linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=(0, None), method='highs')
print(f"status: {result.status}, obj: {result.fun}, x: {result.x}")
```

---

## 示例 4：产销计划（max，含上界）

### 问题描述

产品 A、B 的单位利润分别为 8、11。资源 R 最多 120（A 占 2，B 占 3），资源 T 最多 90（A 占 1，B 占 1）。市场上限：A<=30，B<=25。求最大利润。

### 符号化模型

- 决策变量：`xA, xB`
- 目标函数：`max 8*xA + 11*xB`
- 约束：
  - 资源 R：`2*xA + 3*xB <= 120`
  - 资源 T：`xA + xB <= 90`
- 边界：`0 <= xA <= 30`，`0 <= xB <= 25`

```json
{
  "sense": "max",
  "c": [8, 11],
  "A_ub": [[2, 3], [1, 1]],
  "b_ub": [120, 90],
  "bounds": [[0, 30], [0, 25]]
}
```

### 代码实现

```python
from scipy.optimize import linprog

c = [-8, -11]
A_ub = [[2, 3], [1, 1]]
b_ub = [120, 90]
bounds = [(0, 30), (0, 25)]

result = linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=bounds, method='highs')
print(f"status: {result.status}, obj: {-result.fun}, x: {result.x}")
```

---

## 示例 5：最大化 c^T x（不等式约束）

### 问题描述

最大化 `x1 + 2x2 + 3x3`，受两个不等式约束和变量非负限制。

### 符号化模型

- 决策变量：`x1, x2, x3 >= 0`
- 目标函数：`max x1 + 2*x2 + 3*x3`
- 约束：
  - `x1 + 2*x3 <= 10`
  - `x2 + x3 <= 7`

```json
{
  "sense": "max",
  "c": [1, 2, 3],
  "A_ub": [[1, 0, 2], [0, 1, 1]],
  "b_ub": [10, 7],
  "bounds": [[0, null], [0, null], [0, null]]
}
```

### 代码实现

```python
from scipy.optimize import linprog

c = [-1, -2, -3]
A_ub = [[1, 0, 2], [0, 1, 1]]
b_ub = [10, 7]

result = linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=(0, None), method='highs')
print(f"status: {result.status}, obj: {-result.fun}, x: {result.x}")
```

---

## 示例 6：最小化 c^T x（等式约束）

### 问题描述

最小化 `5x1 + 8x2 + 2x3 + 4x4 + 7x5`，受四个等式约束和变量非负限制。

### 符号化模型

- 决策变量：`x1, x2, x3, x4, x5 >= 0`
- 目标函数：`min 5*x1 + 8*x2 + 2*x3 + 4*x4 + 7*x5`
- 约束：
  - `x1 + 2*x3 + x4 + 3*x5 = 200`
  - `x2 + x3 + 2*x4 + x5 = 150`
  - `3*x1 + 2*x2 + x4 = 250`
  - `x1 + x2 + x3 + x4 + x5 = 100`

```json
{
  "sense": "min",
  "c": [5, 8, 2, 4, 7],
  "A_eq": [
    [1, 0, 2, 1, 3],
    [0, 1, 1, 2, 1],
    [3, 2, 0, 1, 0],
    [1, 1, 1, 1, 1]
  ],
  "b_eq": [200, 150, 250, 100],
  "bounds": [[0, null], [0, null], [0, null], [0, null], [0, null]]
}
```

### 代码实现

```python
from scipy.optimize import linprog

c = [5, 8, 2, 4, 7]
A_eq = [[1, 0, 2, 1, 3],
        [0, 1, 1, 2, 1],
        [3, 2, 0, 1, 0],
        [1, 1, 1, 1, 1]]
b_eq = [200, 150, 250, 100]

result = linprog(c, A_eq=A_eq, b_eq=b_eq, bounds=(0, None), method='highs')
print(f"status: {result.status}, message: {result.message}")
```
