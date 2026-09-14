# 包发布检查表

**简体中文** | [English](release-checklist.en.md)

源码与发布入口统一在 EduWork；遵循[公共包发布流程](https://github.com/ecnu/EduWork/blob/main/docs/PACKAGES.md)，本包保留独立的 npm 名称和 SemVer。

- 核对变更行为、版本、变更记录、兼容范围和依赖锁。
- 在当前包目录执行 npm ci、npm run check；有行为变化时补对应 Host 或浏览器实测，使用合成测试数据。
- 检查实际 tarball、公开文档、许可证和导出入口，不携带凭据或用户数据。
- 在 packages-release.yml 中选择本包；publish=false 仅产出候选。明确发布时从匹配包版本的 tag 运行，使用 npm environment 与本仓库的 Trusted Publisher。
- 核验 registry 中的实际字节后再更新产品锁。发布 npm 不会发布桌面 Release 或替换客户端。
