# VeryMath 能力插件提案

**简体中文** | [English](README_EN.md)

状态：插件已实现，代码按本仓库的 `packages/` 形式提交在 [#301](https://github.com/ECNU/EduWork/pull/301)，Draft 待审。此前已作为独立包 `@louisultra/dsh-verymath` 发布在 npm，收录后按本仓库发布约定迁移到官方 scope 并弃用旧包。本提案说明接入边界与验收证据，收录形式待维护者确认。

## 目标

以可选 DSH 插件的形式，为 EduWork 接入 [VeryMath](https://github.com/orgs/VeryMath/repositories) 的数学学习与研究能力：论文阅读与定理依赖、双语术语库、数学写作与幻灯片、优化与计算、形式化，以及研究工作流。对应 [#152](https://github.com/ECNU/EduWork/issues/152)。

## 接入形态与边界

`packages/dsh-verymath` 独立成包，`lib/` 与 `node_modules/` 不入库，通过 `cordis.patch.yml` 可选挂载，不改变发行版默认装配。插件只通过 DSH 插件 API 接入，工作区写入沿用既有沙箱授权。

通用能力在包内实现，外部环境按需探测：Python、SageMath、TeX Live、Lean/elan、MATLAB 由用户自装，缺失时返回安装提示，不随包分发。Sage 侧只做文档查询，不执行代码。MATLAB 经 MathWorks 官方 MCP server，需要用户自备 license，这部分不在插件 API 范围内。

结构层验证只覆盖依赖完整性、环与断链，不判断数学证明是否正确，这与上游 `skill_base` 的能力边界一致。

## 许可与溯源

包本体按 `MulanPSL-2.0 AND MIT` 声明，表示不同来源代码各自适用不同许可。原创适配代码采用 MulanPSL-2.0；改编自 VeryMath 的技能内容保持 MIT。八个上游仓库中七个为 MIT，另一个 Sagemath-skill 为 GPLv3，本包未收录其任何代码，仅按公开文档以 TypeScript 重新实现查询契约。

`UPSTREAM.json` 记录各仓库的完整 commit，`NOTICE.md` 记录改编范围与逐项改动，`LICENSING.md` 给出路径到许可的映射。Beamer 模板只调用用户本机 TeX Live 的主题，不随包分发第三方样式文件或字体。

## 验收与证据

1. 插件可按官方插件机制安装、启用与卸载；本地用干净 DSH 环境装入 tarball 验证。
2. 任务链路可跑通，产物落到会话工作区并继续处理：论文结构提取、QP 求解、OCR 审校、Beamer 编译、MATLAB 执行均有实跑记录。
3. 脚本与模板随技能保留且可调用：上游 Python 脚本逐字节收录；上游 8 个仓库的 9 套离线测试共 201 项通过。
4. 缺失依赖返回结构化提示而不是崩溃：Python、Sage、Beamer、OSQP 四个探测工具与无需工具链的 Lean 禁用词扫描。
5. 包自身 107 项 vitest 测试与 runtime probe（真实 DSH 插件 API，不调模型）通过。

每项能力的场景示例见 [capability-examples.md](capability-examples.md)，按五点结构整理：使用者与场景、可复制提示词、公开输入样例、预期产物与判断标准、运行条件与验证情况。已覆盖全部 14 项能力。需要外部环境的场景区分两种情形：MATLAB 执行与 Sage 代码执行由用户在本机自行完成，标注为无法在 CI 复现；Sage 文档查询属插件能力，语料可用时无需二进制。

## 收录与待定事项

三条路径供维护者选择：在文档中列出社区插件、作为发行配置中的推荐插件、或按 #301 的形式纳入本仓库并迁移包命名空间。若选第三条，以下需要先定：插件目录位置与包名、`@eduwork` 发布由谁执行、示例文档放包内还是仓库文档树、旧包何时 deprecate、提交历史的并入方式、迁移后以哪份文档为准。

Windows 未测试；外部二进制已按 PATH 与 PATHEXT 解析、不再指向平台固定路径，但仍未在该平台实测。
