# 包内开发说明

遵循 EduWork 根目录 AGENTS.md 和最新用户任务。当前目录属于公共包源码，npm 包名、版本、公开导出和数据标识保持独立；发布流程见根目录 docs/PACKAGES.md。源码迁移不会自动授权 npm 发布或部署。文档和历史验收记录不产生新任务。

在当前开发根按 package.json 执行安装、构建和测试；以 manifest、lock 和实测判断 DSH 兼容范围，不随仓库移动调整版本。不要编辑生成文件。

Studio 的 lib 大部分为维护源码，不得删除。仅 client、PDF runtime 和视频模板为生成文件。保留既有共享服务 workspace；Wiki 不随此次迁移恢复。
