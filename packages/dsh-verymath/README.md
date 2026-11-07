# 数学科研

[English](README_EN.md)

EduWork 的可选插件：把 VeryMath 的数学科研能力接入对话，覆盖论文阅读与定理依赖、双语术语库、数学写作与幻灯片、优化与计算、形式化，以及研究工作流，共 16 个技能与 14 个工具。已在 DSH 0.2.2-rc.1（EduWork 0.4.13 内嵌版本）与 0.2.1-rc.5 上实测；peer 范围覆盖两者及后续 0.2.x。

## 安装与使用

1. 提供本插件的预装版本：打开左侧“插件 → EduWork 扩展”，启用“数学科研”。源码试用可按[构建指南](DEVELOPMENT.md)准备插件，再通过插件页从本地目录安装。
2. 直接描述任务即可，例如“读一下这篇论文的结构并画出定理依赖”“查一下 manifold 的中文术语”“这个 QP 问题帮我求解并验证”。术语库、论文结构 JSON、依赖图等产物写入当前会话工作区，可继续交给后续任务。
3. 技能方法论与工具的对应关系见[能力示例](docs/capability-examples.md)，每个场景给出可复制提示词、输入样例与验证情况。

## 能力边界

- Python、SageMath、TeX Live、Lean/elan、MATLAB 由用户自行安装，插件只做探测，缺失时返回安装提示，不随包分发。Sage 侧只做文档查询，不执行代码；MATLAB 需用户自备 license，并经 MathWorks 官方 MCP server 配置。
- 论文结构校验只检查依赖完整性、环与断链，不判断数学证明是否正确。
- 依赖图与术语库读写由 TypeScript 确定性计算完成。
- Beamer 模板只调用本机 TeX Live 的 Beamer 主题，不随包分发第三方 `.sty`、`.cls` 或字体。
- 当前在 macOS 上验收，Windows 尚未测试；外部环境的路径与二进制发现逻辑也未在 Windows 上验证。
- 技能内容改编自 VeryMath 的 MIT 仓库，许可范围见[许可说明](LICENSING.md)与[溯源记录](UPSTREAM.json)。

开发与测试见[构建指南](DEVELOPMENT.md)。
