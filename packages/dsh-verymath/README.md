# 数学科研

[English](README_EN.md)

EduWork 的可选插件：把 VeryMath 的数学科研能力接入对话，覆盖论文阅读与定理依赖、双语术语库、数学写作与幻灯片、优化与计算、形式化，以及研究工作流，共 16 个技能与 14 个工具。已在 DSH 0.2.2-rc.1（EduWork 0.4.13 内嵌版本）与 0.2.1-rc.5 上实测；peer 范围覆盖两者及后续 0.2.x。

## 先试两句

启用后，下面两段可以直接复制到对话里跑。产物都写进当前会话工作区。

**① 双语术语库**（需要本机 `python3` + `PyYAML`。`verymath_python_check` 只确认 `python3` 可用；缺 `PyYAML` 时脚本会报 `No module named 'yaml'`，用 `pip install PyYAML` 补上）

```text
从 source.csv 构建一份中英数学术语表，输出 glossary/glossary.json；
然后查「同调」对应的英文。
```

得到 `glossary/glossary.json`（条目有序、`term_id` 唯一、`idx` 连续）和 `同调 → homology` 的查询结果。样例输入见 `docs/examples/source.csv`。

**② 论文定理依赖**（不需要 Python，不需要联网）

```text
帮我读 papers/maynard/fulltext.txt（arXiv 1311.4600）的第 1 节，
把里面的定义提取成结构 JSON 并用工具校验。
```

再追问「画出 Theorem 1.2 的依赖关系，标明每个节点对应的原文位置」就得到依赖图。论文全文仓库不分发，按 `docs/examples/README.md` 里的两条命令自行下载转换。

其余 12 项能力（OCR 后校对、二次规划、混合整数规划、最小二乘、Lean、Sage 文档查询、MATLAB、Beamer 等）的提示词、输入样例与验证情况见[能力示例](docs/capability-examples.md)。

## 安装与使用

1. 提供本插件的预装版本：打开左侧“插件 → EduWork 扩展”，启用“数学科研”。源码试用可按[构建指南](DEVELOPMENT.md)准备插件，再通过插件页从本地目录安装。
2. 直接描述任务即可（上面两段可以直接用）。术语库、论文结构 JSON、依赖图等产物写入当前会话工作区，可继续交给后续任务。
3. 技能方法论与工具的对应关系见[能力示例](docs/capability-examples.md)，每个场景给出可复制提示词、输入样例与验证情况。

## 能力边界

- Python、SageMath、TeX Live、Lean/elan、MATLAB 由用户自行安装，插件只做探测，缺失时返回安装提示，不随包分发。Sage 侧只做文档查询，不执行代码；MATLAB 需用户自备 license，并经 MathWorks 官方 MCP server 配置。
- 论文结构校验只检查依赖完整性、环与断链，不判断数学证明是否正确。
- 依赖图与术语库读写由 TypeScript 确定性计算完成。术语库写入区分「新增译名」（同一英文的另一种译法存为 `en__N` 别名行，保留原有译名）与「纠正译名」（带 `term_id` 指定要改的那一行，`en` 必须一致）。
- Beamer 模板只调用本机 TeX Live 的 Beamer 主题，不随包分发第三方 `.sty`、`.cls` 或字体。
- 当前在 macOS 上验收，Windows 尚未测试。外部二进制的发现按 PATH 与 PATHEXT 解析，不再指向平台固定路径，但未在 Windows 上实测。
- 技能内容改编自 VeryMath 的 MIT 仓库，许可范围见[许可说明](LICENSING.md)与[溯源记录](UPSTREAM.json)。

开发与测试见[构建指南](DEVELOPMENT.md)。
