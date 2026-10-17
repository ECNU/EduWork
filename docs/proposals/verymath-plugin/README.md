# VeryMath 能力插件提案（dsh-verymath）

> 这是一份提案，不代表 EduWork 已发布的功能或官方支持的配置。对应 [ECNU/EduWork#152](https://github.com/ECNU/EduWork/issues/152)，描述一个已实现的社区插件原型及其接入边界，供维护者评审收录方式。

**简体中文** | [English](README_EN.md)

## 目标

以可选 DSH 插件的形式，为 EduWork 接入 [VeryMath](https://github.com/orgs/VeryMath/repositories) 的数学学习与研究能力：数学论文阅读、双语术语库、写作与优化、计算与形式化、研究工作流。

- 插件已实现并独立发布：[`@louisultra/dsh-verymath`](https://github.com/LouisUltra/dsh-verymath)（npm，MIT）
- 本提案说明兼容边界、验收条件与验证证据；收录方式（文档收录 / 依赖推荐 / 更深集成）由维护者决定

## 接入形态

| 项目 | 内容 |
| --- | --- |
| 插件名 | `@louisultra/dsh-verymath`（npm scope 归属个人；如官方收录后希望改 scope 或 vendor，可协商） |
| 版本 | 0.3.1 |
| 许可 | MIT（包本体）；技能内容与脚本改编自 VeryMath 的 MIT 项目，来源提交见包内 `UPSTREAM.json`；SageMath 语料（CC BY-SA）独立于包分发 |
| DSH 兼容 | 0.2.x（从 0.2.0-rc.1 起），已在 EduWork 0.4.3 上实测装载 |
| 平台 | macOS（Apple Silicon）实测；Windows 预期可用（依赖 PATH 中的 Node 与 Python），尚未实测 |

## 能力清单

**14 个模型工具**：术语库查询/存词/构建（`verymath_glossary_query/upsert/build`）、Python/Sage/Beamer/OSQP 环境探测（`verymath_python_check`、`verymath_sage_check`、`verymath_beamer_check`、`verymath_osqp_check`）、QP 求解 + 独立 KKT 验证（`verymath_osqp_solve`）、论文结构校验（`verymath_paper_validate`）、论文依赖图引擎（`verymath_paper_graph`）、OCR 错误候选定位（`verymath_ocr_scan`）、Lean 禁用词扫描（`verymath_lean_detect_sorry`，无需 Lean 工具链）、Sage 语料反幻觉查询（`verymath_sage_search`）、研究工作区闸门校验（`verymath_research_gate`）。

**16 个捆绑技能**（经插件技能提供器注册进 DSH 技能目录）：`math-glossary`、`math-paper-reading`、`graph-theory-paper-reading`、`after-ocr`、`paper-writing`、`math-beamer`、`discover-math-problems`、`proof-blueprint-review`、`open-problem-research-pipeline`、`least-squares`、`invariant-computation`、`mixed-integer-programming`、`osqp-solver`、`lean-formalization`、`lean-setup`、`matlab-runner`。

## 兼容边界

- **不改动 EduWork 公共接口**：插件只通过 DSH 插件 API（工具注册、技能注册、fs 服务）接入；工作区写入走既有沙箱授权，不扩大权限范围。
- **外部环境按需检查**：Python/Sage/TeX/Lean/MATLAB 均为用户自装，插件只探测并给缺失依赖提示，不自动安装、不捆绑重依赖（Sage 语料独立放置 `~/.verymath/sagemath-corpus`，MATLAB 经 MathWorks 官方 MCP server 配置）。
- **许可证隔离**：Sagemath-skill 包本身（GPLv3）不收录——经评审后采用干净房间方式，以 TypeScript 重新实现查询契约（不含 GPL 代码），语料（CC BY-SA 3.0）独立分发，MIT 包内无 GPL 文件。
- **验证边界**：只做结构层验证（依赖完整性、环检测），不验证数学证明的正确性——与上游 skill_base 的能力边界声明一致。

## 验收条件与验证证据

| 验收条件 | 证据 |
| --- | --- |
| 官方插件机制安装/启用/卸载 | `dsh plugin add/remove` + `--dump-config` 实测（npm tarball 装入干净 DSH_HOME） |
| "任务 → Agent 调用 → 产物落工作区 → 继续处理" | 10+ headless 场景全过（真实模型）：真实论文结构提取（arXiv 1311.4600）、真实 QP 求解（解与解析 KKT 吻合）、真实 MATLAB 计算、真实 OCR、Beamer 现场编译出 PDF |
| 脚本/模板随技能且实际可调用 | 上游脚本逐字节收录（diff 验证）；上游 9 仓库离线测试套件全部通过（201 个），部分随包携带作回归门；100 个 vitest 合成测试 + runtime probe（真实 DSH API、无远程模型）全绿 |
| 缺失依赖提示 | 四个环境探测工具（python/sage/beamer/osqp）；Lean 禁用词扫描无需工具链；缺失时给结构化安装提示 |
| 上游溯源 | 包内 `UPSTREAM.json`（8 个上游仓库 commit 级记录）+ `NOTICE.md` + 接入矩阵文档 |

## 上游适配与差异

技能内容与 Python 脚本改编自 VeryMath 八个 MIT 仓库（commit 级溯源记录在案）。与上游的主要差异：上游部分关键路径依赖模型现场手写 JSON（论文依赖图合并/拓扑、术语库 upsert 不变量），插件用 TypeScript 实现确定性引擎补齐；术语查询带例句与子领域消歧。

## 收录方式（供维护者选择）

1. **文档收录**：README/docs 增加社区插件条目，链接 npm 与仓库（最小改动）。
2. **依赖推荐**：发行配置中作为可选插件推荐（按 DSH 插件机制装 npm 包）。
3. **更深集成**：把源码 vendor 进官方仓库或改 npm scope——如需要，作者愿意配合调整（可保留完整开发历史与署名）。

## 维护

插件由作者独立维护（issue 与 PR 在 https://github.com/LouisUltra/dsh-verymath）；上游 VeryMath 演进的适配以 `UPSTREAM.json` 记录的版本为基线。
