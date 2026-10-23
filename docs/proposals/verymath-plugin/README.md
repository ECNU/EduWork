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
| 插件名 | `@louisultra/dsh-verymath`（当前发布在作者个人 scope 下；如收录，按 EduWork 的发布约定迁移到官方 scope，作者负责迁移并弃用旧包） |
| 版本 | 0.3.2 |
| 许可 | MIT（包本体）。`UPSTREAM.json` 记录 8 个 VeryMath 上游仓库：7 个 MIT 仓库的内容被改编/收录，另有 1 个 GPLv3 仓库（Sagemath-skill）**未收录任何代码**，仅按接口契约做干净房间重实现；SageMath 文档语料（CC BY-SA 3.0）独立于包分发 |
| DSH 兼容 | peer 依赖 `>=0.2.0-rc.1 <0.3.0-0`；**实测仅覆盖 DSH 0.2.0-rc.2 + EduWork 0.4.3**，rc.1 与后续 0.2.x 未逐版验证 |
| Node | `>=24.18.0`（`package.json` 的 `engines` 要求） |
| 平台 | 仅 macOS（Apple Silicon）实测；**Windows 未测试**（路径与二进制发现逻辑未验证，涉及 TeX / MATLAB / osqp 等外部环境的场景尤其如此） |

## 能力清单

**14 个模型工具**：术语库查询/存词/构建（`verymath_glossary_query/upsert/build`）、Python/Sage/Beamer/OSQP 环境探测（`verymath_python_check`、`verymath_sage_check`、`verymath_beamer_check`、`verymath_osqp_check`）、QP 求解 + 独立 KKT 验证（`verymath_osqp_solve`）、论文结构校验（`verymath_paper_validate`）、论文依赖图引擎（`verymath_paper_graph`）、OCR 错误候选定位（`verymath_ocr_scan`）、Lean 禁用词扫描（`verymath_lean_detect_sorry`，无需 Lean 工具链，需本机 Python 3）、Sage 语料反幻觉查询（`verymath_sage_search`）、研究工作区闸门校验（`verymath_research_gate`）。

**16 个捆绑技能**（经插件技能提供器注册进 DSH 技能目录）：`math-glossary`、`math-paper-reading`、`graph-theory-paper-reading`、`after-ocr`、`paper-writing`、`math-beamer`、`discover-math-problems`、`proof-blueprint-review`、`open-problem-research-pipeline`、`least-squares`、`invariant-computation`、`mixed-integer-programming`、`osqp-solver`、`lean-formalization`、`lean-setup`、`matlab-runner`。

每项能力的场景示例（谁在什么情况下用、可复制提示词、输入样例、预期产物、运行条件与验证情况）见 [`capability-examples.md`](capability-examples.md)。

## 兼容边界

- **不改动 EduWork 公共接口**：插件只通过 DSH 插件 API（工具注册、技能注册、fs 服务）接入；工作区写入走既有沙箱授权，不扩大权限范围。
- **外部环境按需检查**：Python/Sage/TeX/Lean/MATLAB 均为用户自装，插件只探测并给缺失依赖提示，不自动安装、不捆绑重依赖。Sage 只提供**文档查询**，不执行 Sage 代码；语料取自 SageMath 官方 Sphinx 参考手册（10.9.beta9，CC BY-SA 3.0，3196 篇），默认放 `~/.verymath/sagemath-corpus`。MATLAB 需用户自装 MATLAB + license，并经 MathWorks 官方 MCP server 配置，这部分不在插件 API 之内。
- **许可证隔离**：Sagemath-skill 包本身（GPLv3）不收录；查询与打分的契约按公开文档以 TypeScript 干净房间重实现（MIT 包内无 GPL 代码）。需要说明的是，这一边界目前由作者自证：实现只依据该技能公开文档描述的检索/打分行为，未复制其源码；如维护者需要更严格的过程说明，我可以补充。
- **验证边界**：只做结构层验证（依赖完整性、环检测），不验证数学证明的正确性——与上游 skill_base 的能力边界声明一致。

## 验收条件与验证证据

| 验收条件 | 证据 |
| --- | --- |
| 官方插件机制安装/启用/卸载 | `dsh plugin add/remove` + `--dump-config` 实测（npm tarball 装入干净 DSH_HOME） |
| "任务 → Agent 调用 → 产物落工作区 → 继续处理" | 14 项能力均有实跑记录（真实模型，macOS）：论文结构提取（arXiv 1311.4600）、QP 求解（解与解析 KKT 吻合）、MATLAB 计算、OCR 后校对、Beamer 编译出 PDF 等。实跑中发现 1 个工具缺陷，已在 0.3.2 修复 |
| 脚本/模板随技能且实际可调用 | 上游 **Python 脚本**逐字节收录（diff 验证；SKILL.md、frontmatter 与部分测试按 DSH 约定有适配，逐条见 `UPSTREAM.json`）；上游 **8 个仓库的 9 套**离线测试共 201 个全部通过，部分套件随包携带作回归门；**102 个** vitest 合成测试 + runtime probe（真实 DSH API、无远程模型）全绿 |
| 缺失依赖提示 | 四个环境探测工具（python/sage/beamer/osqp）；Lean 禁用词扫描无需工具链；缺失时给结构化安装提示 |
| 上游溯源 | 包内 `UPSTREAM.json`（8 个上游仓库，均为 40 位 commit 哈希）+ `NOTICE.md` + 接入矩阵文档 |

## 上游适配与差异

技能内容与 Python 脚本改编自 VeryMath 的 7 个 MIT 仓库（commit 级溯源记录在案）；另有 1 个 GPLv3 仓库仅作为接口契约参考，未收录代码。与上游的主要差异：上游部分关键路径依赖模型现场手写 JSON（论文依赖图合并/拓扑、术语库 upsert 不变量），插件用 TypeScript 实现确定性引擎补齐；术语查询带例句与子领域消歧。

## 收录方式（供维护者选择）

1. **文档收录**：README/docs 增加社区插件条目，链接 npm 与仓库（最小改动）。
2. **依赖推荐**：发行配置中作为可选插件推荐（按 DSH 插件机制装 npm 包）。
3. **更深集成**：把源码 vendor 进官方仓库或改 npm scope——如需要，作者愿意配合调整（可保留完整开发历史与署名）。

## 接入准备度

**已对齐仓库约定**

- TypeScript 严格模式全开：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`
- 构建产物与 `dsh-plugins/` 现有插件同形：ESM、`lib/index.js` + `lib/*.d.ts`、`exports` 显式声明
- 源码注释全英文、模块级说明标注上游出处与「未复制上游代码」；无 `TODO`/`FIXME` 残留
- 许可与溯源齐备：MIT + `NOTICE.md` + `UPSTREAM.json`（8 个上游仓库，40 位 commit）
- 测试可复现：102 个 vitest 合成测试 + runtime probe（真实 DSH 插件 API、不调模型），已配置 GitHub Actions（typecheck / build / test / runtime probe）
- 文档中英双语，与公版「README 中文 + README_EN 英文」的习惯一致

**迁移时按对方约定调整**

- npm scope 与发布流程（`@eduwork`）、发布凭据归属
- 插件目录位置与是否需要 vendor 源码；如需 vendor，按仓库当时的 lint/CI 约定补齐检查项（公版当前没有 ESLint/Prettier 规则，本包也保持一致）
- peer 依赖版本区间随 EduWork 采用的 DSH 版本调整

**明确未覆盖**

- Windows 未测试（路径与外部二进制发现逻辑未验证）
- MATLAB、Sage 执行需要用户自备环境；语料与 license 不在包内
- 能力示例目前只有中文版

## 迁移待决事项

若维护者选择收录（第一条路径），以下事项需要先定：

1. 插件在 EduWork 仓库中的位置（`dsh-plugins/` 下新建，或其他约定）
2. `@eduwork` npm 发布由谁执行、作者需要什么权限（协作成员 / token 归属）
3. 示例文档放插件目录内的 `docs/`，还是 EduWork 的文档目录
4. 现有 `LouisUltra/dsh-verymath` 仓库与 `@louisultra/dsh-verymath` 包的处置（归档 + npm deprecate 指向新包为一种选择）
5. 提交历史并入方式（`git subtree` 或维护者偏好的方式），以保留作者署名
6. 迁移后以哪份文档为准（插件仓库 vs EduWork 仓库），避免两份示例漂移

## 维护

作者已表示愿意作为主要维护者把插件贡献到 EduWork 仓库维护（见 PR 讨论），迁移细节（目录位置、`@eduwork` 发布、旧仓库与旧 npm 包处置、提交历史并入方式）待维护者确认；在迁移完成前，issue 与 PR 仍在 https://github.com/LouisUltra/dsh-verymath。上游 VeryMath 演进的适配以 `UPSTREAM.json` 记录的版本为基线。
