# 示例说明

三个示例都避免静默覆盖或无必要污染共享基础工作区。

## 矩阵报告

在 MATLAB 中：

```matlab
A = [1 2 3; 0 1 4; 5 6 0];
report = matrix_report(A);
```

在 MCP 中使用实际暴露的 `evaluate_matlab_code` 能力；如果其参数包含
`project_path`，传入项目绝对路径。

## 无覆盖绘图

```matlab
outputPath = plot_damped_sine(pwd);
```

如果 `damped_sine.png` 已存在，会使用 `damped_sine_1.png` 等第一个可用名称。函数创建不可见图窗，并只关闭自己创建的图窗。

## 单元测试

使用 coding agent 当前工具目录中实际暴露的专用能力运行：

```text
run_matlab_test_file
```

`script_path` 应是 `test_vector_norm.m` 的绝对路径。预期为 2 个测试通过。
