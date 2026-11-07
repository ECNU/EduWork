# 来源与许可声明

本包包含改编自 VeryMath 各仓库的技能内容与脚本，以及本项目原创的实现代码。两类内容适用不同许可，范围见 [LICENSING.md](LICENSING.md)；逐仓库的完整 commit 与改编路径见 [UPSTREAM.json](UPSTREAM.json)。

## 改编自上游的内容（MIT）

以下仓库均为 MIT 许可，其技能内容、Python 脚本与参考文档按原许可收录。逐项改编范围见 `UPSTREAM.json` 的 `adaptedPaths` 与 `adaptationNotes`。

- AI4Math-MathTool：`skills/math-glossary/`（SKILL.md、scripts、references、tests）；`skills/matlab-runner/`（SKILL.md、references、examples，附 DSH MCP 配置说明）
- AI4Math-Paper-Reading：`skills/math-paper-reading/`（agent_router 与 skill_* 模块、references 下的 proof_pattern_taxonomy 与 quality_rubric）；`skills/graph-theory-paper-reading/`；`skills/after-ocr/`（SKILL.md、scripts、references、tests）
- AI4Math-Writing：`skills/paper-writing/`（SKILL.md、六个子技能扁平成 skill_* 模块、templates）；`skills/math-beamer/`（SKILL.md、模板目录与 23 个模板包、references）
- AI4Math-Auto-Research：`skills/discover-math-problems/`、`skills/proof-blueprint-review/`、`skills/open-problem-research-pipeline/`
- AI4Math-Computational-Mathematics：`skills/least-squares/`、`skills/invariant-computation/`
- AI4Math-Optimization：`skills/osqp-solver/`（scripts 逐字节收录）、`skills/mixed-integer-programming/`
- AI4Math-Lean-Agents：`skills/lean-formalization/`（含内嵌 lean-runtime 支撑层）、`skills/lean-setup/`

上游 MIT 授权及其权利人（VeryMath 及各贡献者）不因本包的许可选择而改变。各目录下的 SKILL.md、脚本与文档保留上游原文，改动仅限适配 DSH 的调用方式与目录布局，逐条记录在 `UPSTREAM.json`。

## 未收录代码的上游仓库（GPLv3）

AI4Math-Sagemath-skill 为 GPLv3。本包未收录其任何文件；`verymath_sage_check` 与 `verymath_sage_search` 的检索与打分逻辑依据该技能的公开文档以 TypeScript 重新实现，`skills/` 下不含该仓库内容。SageMath 文档语料（CC BY-SA 3.0）独立于本包分发。

## 本项目原创内容（MulanPSL-2.0）

`src`、`scripts`、`test`、`cordis.patch.yml` 与包内其他非上游文件为本项目原创，按木兰宽松许可证第 2 版授权，全文见 [LICENSE](LICENSE)。这些文件包括：

- `src/core/`：术语库读写与查询、论文结构校验、依赖图引擎、研究工作区闸门、Sage 语料检索、技能注册
- `src/tool/`：14 个模型工具的实现与渲染
- `test/`：合成测试与运行探针
- `scripts/probe-runtime.mjs`：真实 DSH 插件 API 的运行探针
- `package.json`、`cordis.patch.yml`、双语 README、`DEVELOPMENT.md`、本文件与 `LICENSING.md`

## 第三方环境

Python、SageMath、TeX Live、Lean/elan、MATLAB 由用户自行安装，按各自许可使用，不在本包分发范围内。`math-beamer` 的模板只调用本机 TeX Live 的 Beamer 主题，不包含第三方 `.sty`、`.cls` 或字体文件。
