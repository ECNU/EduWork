# 兼容性与发布策略

**简体中文** | [English](compatibility.en.md)

运行环境和 DSH 兼容范围以 package.json、依赖锁及对应实测为准，不能把源码测试等同于整包发行验收。

当前源码支持 LiteLLM native contract 1、显式启用的 oidc-llm 0.1 实验模型接入，以及不附带模型资源的标准 OIDC 身份登录。oidc-llm 尚未定稿，默认关闭。

本分支已删除旧 Key Binding 模型流程和 backend: native 账户桥，旧配置会报错。新客户端使用 Token；服务端可保留旧接口兼容已经发布的老客户端。此次破坏性变更尚未发布，发布前需选择合适的新包版本并同步已审查的产品锁，不能覆盖旧 npm 版本。

## 验证要求

包级检查包含类型、构建、共享身份与网关回归、Schema、文档、秘密扫描和打包。真实 OIDC/LiteLLM、桌面加密存储、重启和界面分别验收，报告必须区分实际覆盖。

迁移见[旧方案说明](key-binding-protocol.md)，构建见[开发指南](development.md)。源码、npm 发布、客户端装配和生产部署分别执行。
