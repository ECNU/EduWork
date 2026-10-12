# 变更记录 / Changelog

## 0.1.2

- DSH peer 改为 `>=0.2.0-rc.1 <0.3.0-0`，同一 0.2 API 系列不再逐个枚举 rc；0.3 及其预发布版本仍需适配。
- Cordis / Schemastery 的 peers 改为兼容主版本范围，开发依赖与产物锁继续固定；检索实现不变。
- 验证 rc.1/rc.2 实际工具与 Jobs 行为，并测试版本边界；未来版本的匹配测试不代表其行为已验收。

Use bounded DSH 0.2 API compatibility and compatible Cordis/Schemastery peer ranges. Build locks remain exact; retrieval behavior is unchanged. Runtime checks cover rc.1/rc.2; range tests do not certify unreleased runtime behavior.

## 0.1.1

- 支持 DSH 0.2.0-rc.1 与 rc.2，避免精确 peer 版本声明让官方插件管理器停用文献能力。
- 开发依赖固定到 rc.2；检索、全文、Jobs 和取消行为继续执行原有实现与验证。

Supports DSH 0.2.0-rc.1 and rc.2 without bypassing plugin compatibility checks; development checks use rc.2.

## 0.1.0

- 从 SihanLv/dsh-literature 0.1.2 建立 EduWork 维护分支，保留 MIT 许可、来源与原始文件哈希。
- 合并上游五个包，保留 DBLP、arXiv、BibTeX 和全文功能及原有配置标识。
- 适配 DSH 0.2.0-rc.1 Jobs 的会话归属、结果读取和取消状态。
- 增加独立构建、类型声明、包检查、真实 Jobs 集成检查和 npm 工作流入口。

Forked from SihanLv/dsh-literature 0.1.2 under MIT. Consolidates the original five packages, retains providers and configuration IDs, adapts session ownership/results/cancellation to DSH 0.2 Jobs, and adds package build, declarations, runtime checks and npm workflow integration.
