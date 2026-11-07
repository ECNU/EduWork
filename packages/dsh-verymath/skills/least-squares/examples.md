# 最小二乘参考示例

<!--
  作者：李爽夕
  数据引用：部分示例数据来自 NIST Statistical Reference Datasets (StRD)
  URL: https://itl.nist.gov/div898/strd/nls/nls_main.shtml
  美国政府公共领域数据，可自由使用，需注明来源。
-->

> 模型：deepseek-v4-pro

---

## 示例 1：线性拟合

### 问题描述

对 10 组观测数据 (x, y) 进行一元线性回归 y = a*x + b。

```
x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
y = [1.2, 2.1, 2.9, 4.0, 5.1, 5.8, 7.0, 8.2, 8.9, 10.1]
```

### 代码实现

```python
import numpy as np

x = np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
y = np.array([1.2, 2.1, 2.9, 4.0, 5.1, 5.8, 7.0, 8.2, 8.9, 10.1])

X = np.column_stack([np.ones_like(x), x])
beta, residuals, rank, s = np.linalg.lstsq(X, y, rcond=None)
b, a = beta

y_pred = a * x + b
r2 = 1 - np.sum((y - y_pred)**2) / np.sum((y - np.mean(y))**2)

print(f"y = {a:.3f}x + {b:.3f}, R² = {r2:.4f}")
```

---

## 示例 2：多项式拟合

### 问题描述

11 组数据呈明显二次曲线趋势，用 2 阶多项式 y = c0 + c1*x + c2*x^2 拟合。

```
x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
y = [1.0, 0.8, 1.5, 2.3, 3.8, 5.0, 7.5, 10.1, 13.0, 16.5, 20.2]
```

### 代码实现

```python
import numpy as np

x = np.linspace(0, 10, 11)
y = np.array([1.0, 0.8, 1.5, 2.3, 3.8, 5.0, 7.5, 10.1, 13.0, 16.5, 20.2])

coeffs = np.polyfit(x, y, deg=2)
p = np.poly1d(coeffs)
y_pred = p(x)

r2 = 1 - np.sum((y - y_pred)**2) / np.sum((y - np.mean(y))**2)
print(f"方程: y = {coeffs[0]:.3f}x^2 + {coeffs[1]:.3f}x + {coeffs[2]:.3f}")
print(f"R² = {r2:.4f}")
```

---

## 示例 3：指数衰减拟合

### 问题描述

11 组测量数据呈现指数衰减特征，用模型 y = a*exp(-b*x) + c 拟合。

```
x = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]
y = [5.0, 3.2, 2.1, 1.4, 0.9, 0.6, 0.4, 0.3, 0.2, 0.1, 0.1]
```

### 代码实现

```python
import numpy as np
from scipy.optimize import curve_fit

x = np.array([0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0])
y = np.array([5.0, 3.2, 2.1, 1.4, 0.9, 0.6, 0.4, 0.3, 0.2, 0.1, 0.1])

def exp_decay(x, a, b, c):
    return a * np.exp(-b * x) + c

popt, pcov = curve_fit(exp_decay, x, y, p0=[4, 1, 0])
perr = np.sqrt(np.diag(pcov))

y_pred = exp_decay(x, *popt)
r2 = 1 - np.sum((y - y_pred)**2) / np.sum((y - np.mean(y))**2)

print(f"a = {popt[0]:.3f} ± {perr[0]:.3f}")
print(f"b = {popt[1]:.3f} ± {perr[1]:.3f}")
print(f"c = {popt[2]:.3f} ± {perr[2]:.3f}")
print(f"R² = {r2:.4f}")
```

---

## 示例 4：Ridge 正则化回归

### 问题描述

100 个样本、10 个特征，其中特征 2 与特征 1 高度相关（r~0.8），存在多重共线性。用 Ridge 正则化 (alpha=1.0) 收缩系数，对比 OLS。

### 代码实现

```python
import numpy as np
from sklearn.linear_model import Ridge, LinearRegression
from sklearn.preprocessing import StandardScaler

np.random.seed(42)
n, p = 100, 10
X = np.random.randn(n, p)
X[:, 2] = 0.8 * X[:, 1] + 0.2 * np.random.randn(n)

true_coef = np.array([1.5, -2.0, 0, 0, 3.0, 0, 0, 0.5, 0, 0])
y = X @ true_coef + 0.5 * np.random.randn(n)

scaler = StandardScaler()
Xs = scaler.fit_transform(X)

ols = LinearRegression().fit(Xs, y)
ridge = Ridge(alpha=1.0).fit(Xs, y)

for i in range(p):
    print(f"x{i}: true={true_coef[i]:+.1f}, "
          f"OLS={ols.coef_[i]:+.3f}, Ridge={ridge.coef_[i]:+.3f}")
print(f"OLS系数范数: {np.linalg.norm(ols.coef_):.3f}")
print(f"Ridge系数范数: {np.linalg.norm(ridge.coef_):.3f}")
```

---

## 示例 5：加权最小二乘

### 问题描述

20 组异方差数据：噪声标准差随 x 线性增大（0.5 到 2.0）。用权重 w=1/方差 进行加权最小二乘拟合 y = a*x + b，对比 OLS。

### 代码实现

```python
import numpy as np

np.random.seed(42)
x = np.linspace(0, 10, 20)
true_a, true_b = 2.0, 1.0
noise_std = 0.5 * (1 + 0.3 * x)
y = true_a * x + true_b + np.random.randn(len(x)) * noise_std

weights = 1.0 / noise_std**2

# 加权最小二乘闭式解
W = np.diag(weights)
X = np.column_stack([np.ones_like(x), x])
beta_wls = np.linalg.inv(X.T @ W @ X) @ X.T @ W @ y
b_wls, a_wls = beta_wls

# 普通最小二乘
beta_ols = np.polyfit(x, y, 1)

y_pred_wls = a_wls * x + b_wls
y_pred_ols = beta_ols[0] * x + beta_ols[1]
r2_wls = 1 - np.sum((y - y_pred_wls)**2) / np.sum((y - np.mean(y))**2)
r2_ols = 1 - np.sum((y - y_pred_ols)**2) / np.sum((y - np.mean(y))**2)

print(f"真实: y = {true_a:.2f}x + {true_b:.2f}")
print(f"OLS:  y = {beta_ols[0]:.3f}x + {beta_ols[1]:.3f}, R²={r2_ols:.4f}")
print(f"WLS:  y = {a_wls:.3f}x + {b_wls:.3f}, R²={r2_wls:.4f}")
```

---

## 示例 6：非线性最小二乘（通用方法）

### 问题描述

用 5 参数复合非线性模型 y = a*sin(b*x + c) + d*exp(-e*x) 拟合 50 组模拟数据。使用 `scipy.optimize.least_squares` 的 Trust Region Reflective 方法，带参数边界约束。

### 代码实现

```python
import numpy as np
from scipy.optimize import least_squares

def model(x, params):
    a, b, c, d, e = params
    return a * np.sin(b * x + c) + d * np.exp(-e * x)

np.random.seed(42)
x = np.linspace(0, 10, 50)
true_params = [2.0, 1.5, 0.5, 1.0, 0.3]
y = model(x, true_params) + 0.2 * np.random.randn(len(x))

def residuals(params, x, y):
    return y - model(x, params)

result = least_squares(
    residuals, [1.0, 1.0, 0.0, 0.5, 0.2],
    args=(x, y),
    bounds=([0, 0, -np.pi, 0, 0], [5, 3, np.pi, 3, 1]),
    method='trf'
)

if result.success:
    y_pred = model(x, result.x)
    r2 = 1 - np.sum((y - y_pred)**2) / np.sum((y - np.mean(y))**2)
    print(f"参数: {result.x}")
    print(f"真实: {true_params}")
    print(f"R² = {r2:.4f}, 迭代次数: {result.nfev}")
```

---

## 示例 7：Lasso 特征选择

### 问题描述

50 个样本、20 个特征，仅 5 个特征对 y 有真实影响（稀疏性）。用 Lasso (L1 正则化) 自动特征选择，识别真正的信号特征。

### 代码实现

```python
import numpy as np
from sklearn.linear_model import Lasso
from sklearn.preprocessing import StandardScaler

np.random.seed(42)
n, p = 50, 20
X = np.random.randn(n, p)
true_coef = np.zeros(p)
true_coef[[0, 3, 7, 11, 15]] = [2.0, -1.5, 1.0, -0.8, 0.5]
y = X @ true_coef + 0.3 * np.random.randn(n)

scaler = StandardScaler()
Xs = scaler.fit_transform(X)

lasso = Lasso(alpha=0.1, max_iter=10000).fit(Xs, y)
selected = np.where(np.abs(lasso.coef_) > 1e-5)[0]
y_pred = lasso.predict(Xs)
r2 = 1 - np.sum((y - y_pred)**2) / np.sum((y - np.mean(y))**2)

print(f"选中特征: {selected}")
print(f"真实非零: {[0, 3, 7, 11, 15]}")
print(f"R² = {r2:.4f}")
```

---

## 示例 8：有理函数拟合 (cubic/cubic) — NIST 高难度级

> **数据来源**：NIST Statistical Reference Datasets (StRD)
> https://itl.nist.gov/div898/strd/nls/nls_main.shtml
> 美国政府公共领域数据。引用：NIST ITL Statistical Engineering Division.

### 问题描述

NIST StRD 级高难度非线性回归。37 组电子迁移率 (y) 与对数密度 (x) 数据，用 7 参数 cubic/cubic 有理函数拟合。该问题的难点：分母可能产生极点、存在局部极小值，常规 `lm` 方法难以收敛。

```
x = [-3.067, -2.981, -2.921, -2.912, -2.840, -2.797, -2.702, -2.699,
     -2.633, -2.481, -2.363, -2.322,
     -1.501, -1.460, -1.274, -1.212, -1.100, -1.046,
     -0.915, -0.714, -0.566, -0.545, -0.400, -0.309,
     -0.109, -0.103,  0.010,  0.119,  0.377,
      0.790,  0.963,  1.006,  1.115,  1.572,  1.841,
      2.047,  2.200]
y = [80.574, 84.248, 87.264, 87.195, 89.076, 89.608, 89.868, 90.101,
     92.405, 95.854, 100.696, 101.060,
     401.672, 390.724, 567.534, 635.316, 733.054, 759.087,
     894.206, 990.785, 1090.109, 1080.914, 1122.643, 1178.351,
     1260.531, 1273.514, 1288.339, 1327.543, 1353.863,
     1414.509, 1425.208, 1421.384, 1442.962, 1464.350, 1468.705,
     1447.894, 1457.628]
```

### 代码实现

```python
import numpy as np
from scipy.optimize import curve_fit

x_data = np.array([...])  # 见上方数据
y_data = np.array([...])

def rational_cubic_cubic(x, b1, b2, b3, b4, b5, b6, b7):
    num = b1 + b2*x + b3*x**2 + b4*x**3
    den = 1 + b5*x + b6*x**2 + b7*x**3
    return num / den

# 多组初值 + 多方法尝试（关键策略）
p0_candidates = [
    [1288.0, 1000.0,  500.0, 1400.0,  0.5, 0.5, 1.0],
    [1300.0, 2000.0, 1000.0, 1500.0,  1.0, 1.0, 1.0],
    [800.0,   100.0,   10.0,  500.0,  0.1, 0.01, 0.01],
    [1000.0,  500.0,  200.0, 1400.0,  0.5, 0.2, 1.0],
    [1500.0, 3000.0, 2000.0,  500.0, -1.0, 0.5, 0.5],
]

best_rss = np.inf
best_result = None

for p0 in p0_candidates:
    for method in ['lm', 'trf']:
        try:
            popt, pcov = curve_fit(rational_cubic_cubic, x_data, y_data,
                                    p0=p0, method=method,
                                    maxfev=200000, ftol=1e-12, xtol=1e-12)
            y_pred = rational_cubic_cubic(x_data, *popt)
            rss = np.sum((y_data - y_pred)**2)
            if rss < best_rss:
                best_rss = rss
                perr = np.sqrt(np.diag(pcov))
                best_result = (popt, perr, y_pred, rss, method, p0)
        except:
            pass

if best_result is None:
    # 全局优化 fallback
    from scipy.optimize import differential_evolution

    def rss_obj(params):
        pred = rational_cubic_cubic(x_data, *params)
        return np.sum((y_data - pred)**2)

    result = differential_evolution(rss_obj, [(-5000, 5000)]*7,
                                     maxiter=5000, polish=True, seed=42)
    popt = result.x
    perr = np.full(7, np.nan)
else:
    popt, perr, y_pred, rss, method, p0 = best_result

n = len(x_data)
r2 = 1 - rss / np.sum((y_data - np.mean(y_data))**2)
print(f"方法: {best_result[4] if best_result else 'differential_evolution'}")
for i in range(7):
    print(f"b{i+1} = {popt[i]:.6E} ± {perr[i]:.6E}")
print(f"R² = {r2:.6f}")
```

---

## 拟合方法选择指南

| 场景 | 推荐方法 | 调用方式 |
|------|----------|----------|
| 一元线性关系 | OLS | `np.linalg.lstsq` |
| 曲线趋势 | 多项式拟合 | `np.polyfit(x, y, deg)` |
| 已知函数形式 | curve_fit | `scipy.optimize.curve_fit` |
| 异方差数据 | 加权最小二乘 | `(X^T W X)^{-1} X^T W y` |
| 多重共线性 | Ridge | `sklearn.linear_model.Ridge` |
| 特征选择 | Lasso | `sklearn.linear_model.Lasso` |
| 有理函数 (cubic/cubic) | curve_fit (trf) + 多初值 | `scipy.optimize.curve_fit` |
| 全局优化困难 | differential_evolution | `scipy.optimize.differential_evolution` |

## 诊断指标速查

| 指标 | 公式 | 含义 |
|------|------|------|
| R² | `1 - SS_res/SS_tot` | 拟合优度，越接近 1 越好 |
| RMSE | `sqrt(mean(res^2))` | 均方根误差，越小越好 |
| 残差平方和 (RSS) | `sum((y - y_pred)^2)` | 模型拟合总的未解释变异 |
| 条件数 | `max(s)/min(s)` | > 100 可能有共线性 |
| Durbin-Watson | `sum(diff(res)^2) / sum(res^2)` | 1.5-2.5 表示残差无自相关 |
| 参数 \|t\| 统计量 | `abs(param) / std_err` | > 2 表示参数显著 |
| 自由度 | `n - p` | 样本数减参数个数 |
